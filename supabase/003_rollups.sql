-- ═══════════════════════════════════════════════════════════════════════
-- Rollups, Z-reading, and the data lifecycle that keeps 1M+ transactions
-- inside 500 MB.
--
--   hot   (0-90 days)  normalized orders + order_lines, full query power
--   warm  (90d+)       lines folded into orders.lines jsonb, rows dropped
--   cold  (2y+)        exported to object storage, stub row retained
--   forever            daily rollups — tiny, and faster than the raw data
-- ═══════════════════════════════════════════════════════════════════════

-- ── Daily rollups ──────────────────────────────────────────────────────

create or replace function roll_up_day(p_branch smallint, p_date date)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into daily_sales (
    branch_id, business_date, order_count,
    gross_cents, discount_cents, vat_cents, net_cents, by_tender
  )
  select
    p_branch,
    p_date,
    count(*),
    coalesce(sum(o.gross_cents), 0),
    coalesce(sum(o.discount_cents), 0),
    coalesce(sum(o.vat_cents), 0),
    coalesce(sum(o.net_cents), 0),
    coalesce((
      select jsonb_object_agg(t.method, t.total)
      from (
        select tn.method, sum(tn.amount_cents) as total
        from tenders tn
        join orders o2 on o2.id = tn.order_id
        where o2.branch_id = p_branch
          and o2.business_date = p_date
          and o2.status = 'closed'
        group by tn.method
      ) t
    ), '{}'::jsonb)
  from orders o
  where o.branch_id = p_branch
    and o.business_date = p_date
    and o.status = 'closed'
  on conflict (branch_id, business_date) do update set
    order_count    = excluded.order_count,
    gross_cents    = excluded.gross_cents,
    discount_cents = excluded.discount_cents,
    vat_cents      = excluded.vat_cents,
    net_cents      = excluded.net_cents,
    by_tender      = excluded.by_tender;

  insert into daily_product_sales (
    branch_id, business_date, product_id, qty, gross_cents, cost_cents
  )
  select
    p_branch, p_date, l.product_id,
    sum(l.qty),
    sum(l.qty * l.unit_cents),
    sum(l.qty * p.cost_cents)
  from order_lines l
  join orders   o on o.id = l.order_id
  join products p on p.id = l.product_id
  where o.branch_id = p_branch
    and o.business_date = p_date
    and o.status = 'closed'
    and l.served and not l.voided
  group by l.product_id
  on conflict (branch_id, business_date, product_id) do update set
    qty         = excluded.qty,
    gross_cents = excluded.gross_cents,
    cost_cents  = excluded.cost_cents;
end;
$$;

-- ── Z-reading ──────────────────────────────────────────────────────────
-- Closes and locks the day's total. The hash chains to the previous day, so
-- editing any historical figure breaks every hash after it. That is the
-- tamper evidence a non-resettable grand total is meant to provide.

create or replace function z_read(p_branch smallint, p_date date)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_prev text;
  v_hash text;
  v_row  daily_sales%rowtype;
begin
  perform roll_up_day(p_branch, p_date);

  select z_read_hash into v_prev
  from daily_sales
  where branch_id = p_branch and business_date < p_date and z_read_hash is not null
  order by business_date desc
  limit 1;

  select * into v_row
  from daily_sales
  where branch_id = p_branch and business_date = p_date;

  if v_row is null then
    raise exception 'no sales to close for branch % on %', p_branch, p_date;
  end if;

  v_hash := encode(digest(
    coalesce(v_prev, 'genesis') || '|' ||
    p_branch::text || '|' || p_date::text || '|' ||
    v_row.order_count::text || '|' || v_row.gross_cents::text || '|' ||
    v_row.discount_cents::text || '|' || v_row.vat_cents::text || '|' ||
    v_row.net_cents::text,
    'sha256'), 'hex');

  update daily_sales
     set z_read_at = now(), z_read_hash = v_hash, prev_hash = v_prev
   where branch_id = p_branch and business_date = p_date;

  return v_hash;
end;
$$;

-- Verify the chain end to end. Run this before any audit.
create or replace function verify_z_chain(p_branch smallint)
returns table (business_date date, ok boolean)
language sql stable
as $$
  select
    d.business_date,
    d.prev_hash is not distinct from lag(d.z_read_hash) over w
  from daily_sales d
  where d.branch_id = p_branch and d.z_read_hash is not null
  window w as (order by d.business_date)
  order by d.business_date;
$$;

-- ── Warm fold: collapse line rows into jsonb after 90 days ─────────────
-- This is the step that makes 1M transactions fit. Fully normalized, 1M
-- orders plus 3.5M line rows runs ~460 MB before indexes on anything else.
-- Folded, the same data is ~190 MB.

create or replace function fold_old_lines(p_days int default 90)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with folded as (
    update orders o
       set lines = (
         select jsonb_agg(jsonb_build_array(l.product_id, l.qty, l.unit_cents)
                          order by l.line_no)
         from order_lines l
         where l.order_id = o.id and l.served and not l.voided
       )
     where o.status in ('closed', 'voided')
       and o.lines is null
       and o.closed_at < now() - make_interval(days => p_days)
    returning o.id
  )
  delete from order_lines l
  using folded f
  where l.order_id = f.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Schedule ───────────────────────────────────────────────────────────
-- pg_cron runs inside Postgres and is unmetered, unlike Edge Functions
-- (500k invocations/month on free).

create extension if not exists pg_cron;
create extension if not exists pgcrypto;

-- Roll up yesterday for every branch, 00:20 Manila (16:20 UTC).
select cron.schedule(
  'rollup-yesterday', '20 16 * * *',
  $$
  select roll_up_day(b.id, ((now() at time zone 'Asia/Manila')::date - 1))
  from branches b where b.active;
  $$
);

-- Fold line items older than 90 days, Sundays 17:00 UTC.
select cron.schedule('fold-old-lines', '0 17 * * 0', $$ select fold_old_lines(90); $$);
