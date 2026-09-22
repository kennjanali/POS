-- ═══════════════════════════════════════════════════════════════════════
-- Row-level security.
--
-- The browser holds only the anon key and talks to PostgREST directly, so
-- RLS is the entire authorization boundary. Written multi-tenant from day
-- one: retrofitting tenancy onto a live POS is miserable.
-- ═══════════════════════════════════════════════════════════════════════

alter table orgs                enable row level security;
alter table users               enable row level security;
alter table branches            enable row level security;
alter table products            enable row level security;
alter table order_events        enable row level security;
alter table orders              enable row level security;
alter table order_lines         enable row level security;
alter table tenders             enable row level security;
alter table stock               enable row level security;
alter table stock_moves         enable row level security;
alter table daily_sales         enable row level security;
alter table daily_product_sales enable row level security;
alter table audit_log           enable row level security;

-- ── Tables carrying org_id directly ────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'branches','products','order_events','orders','stock_moves','audit_log'
  ] loop
    execute format($f$
      drop policy if exists tenant_rw on %I;
      create policy tenant_rw on %I
        for all to authenticated
        using (org_id = current_org_id())
        with check (org_id = current_org_id());
    $f$, t, t);
  end loop;
end $$;

-- ── Users ──────────────────────────────────────────────────────────────
-- The role matrix, expressed where it can actually be enforced. The client
-- copy in src/lib/permissions.ts keeps people on task; this is the boundary.
--
-- Every signed-in terminal reads the user list — sign-in has to work offline,
-- so the browser needs the salted hashes. Only a superadmin may write one.

create policy users_read on users
  for select to authenticated
  using (org_id = current_org_id());

create policy users_write on users
  for insert to authenticated
  with check (org_id = current_org_id() and current_user_role() = 'superadmin');

create policy users_update on users
  for update to authenticated
  using (org_id = current_org_id() and current_user_role() = 'superadmin')
  with check (org_id = current_org_id() and current_user_role() = 'superadmin');

-- Deactivate, never delete. The audit trail points at these rows.
create policy users_no_delete on users
  as restrictive for delete to authenticated
  using (false);

create policy own_org on orgs
  for select to authenticated
  using (id = current_org_id());

-- ── Tables reached through a parent ────────────────────────────────────

create policy tenant_rw on order_lines
  for all to authenticated
  using (exists (
    select 1 from orders o
    where o.id = order_lines.order_id and o.org_id = current_org_id()))
  with check (exists (
    select 1 from orders o
    where o.id = order_lines.order_id and o.org_id = current_org_id()));

create policy tenant_rw on tenders
  for all to authenticated
  using (exists (
    select 1 from orders o
    where o.id = tenders.order_id and o.org_id = current_org_id()))
  with check (exists (
    select 1 from orders o
    where o.id = tenders.order_id and o.org_id = current_org_id()));

do $$
declare t text;
begin
  foreach t in array array['stock','daily_sales','daily_product_sales'] loop
    execute format($f$
      drop policy if exists tenant_rw on %I;
      create policy tenant_rw on %I
        for all to authenticated
        using (exists (
          select 1 from branches b
          where b.id = %I.branch_id and b.org_id = current_org_id()))
        with check (exists (
          select 1 from branches b
          where b.id = %I.branch_id and b.org_id = current_org_id()));
    $f$, t, t, t, t);
  end loop;
end $$;

-- ── Role limits ────────────────────────────────────────────────────────
-- Restrictive policies stack on top of the tenant policies above: a write has
-- to satisfy both. Waiters ring up sales; they do not void them, edit the menu
-- or read the day's numbers.

create policy void_needs_admin on orders
  as restrictive for update to authenticated
  with check (status <> 'voided' or current_user_role() = 'superadmin');

create policy menu_edits_by_role on products
  as restrictive for all to authenticated
  using (true)
  with check (current_user_role() in ('superadmin', 'purchaser'));

-- Serving and voiding move stock as a side effect of a sale, so those reasons
-- stay open to everyone. A counted, restocked or written-off quantity is an
-- inventory decision.
create policy manual_stock_by_role on stock_moves
  as restrictive for insert to authenticated
  with check (
    reason in ('sale', 'void')
    or current_user_role() in ('superadmin', 'purchaser')
  );

do $$
declare t text;
begin
  foreach t in array array['daily_sales','daily_product_sales'] loop
    execute format($f$
      drop policy if exists reports_not_for_waiters on %I;
      create policy reports_not_for_waiters on %I
        as restrictive for all to authenticated
        using (current_user_role() <> 'waiter')
        with check (current_user_role() <> 'waiter');
    $f$, t, t);
  end loop;
end $$;

-- ── Immutability ───────────────────────────────────────────────────────
-- A closed order may not be edited or deleted by anyone holding the anon
-- key. Corrections go through a void, which leaves the original on the
-- record. v6's removeTable() deleted completed sales outright — a deleted
-- sale and a sale that never happened look identical at audit.

create policy no_edit_closed on orders
  as restrictive for update to authenticated
  using (status = 'open');

create policy no_delete on orders
  as restrictive for delete to authenticated
  using (false);

-- The event log is append-only: insert, read, never mutate.
create policy events_append_only_update on order_events
  as restrictive for update to authenticated using (false);
create policy events_append_only_delete on order_events
  as restrictive for delete to authenticated using (false);
create policy audit_append_only_update on audit_log
  as restrictive for update to authenticated using (false);
create policy audit_append_only_delete on audit_log
  as restrictive for delete to authenticated using (false);

-- ── Explicit grants ────────────────────────────────────────────────────
-- Projects created after 2026-05-30 must grant PostgREST access explicitly;
-- existing free projects are affected from 2026-10-30. Without these the
-- Data API returns nothing regardless of what the policies say.

grant usage on schema public to authenticated;
grant select, insert, update on
  users, branches, products, orders, order_lines, tenders,
  stock, stock_moves, daily_sales, daily_product_sales
  to authenticated;
grant select, insert on order_events, audit_log to authenticated;
grant select on orgs to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function claim_invoice_block(smallint, int) to authenticated;
grant execute on function current_user_role() to authenticated;
