-- ═══════════════════════════════════════════════════════════════════════
-- KRAMGEN POS — Supabase schema
--
-- Sized to fit 1M+ transactions inside the 500 MB free-tier ceiling:
--   * integer centavos, never numeric or float
--   * smallint foreign keys to products and branches
--   * closed orders keep their line items as compressed jsonb, not rows
--   * permanent daily rollups answer every reporting question
--
-- Apply with: supabase db push, or paste into the SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Tenancy ────────────────────────────────────────────────────────────

create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Read the caller's org from the JWT. app_metadata is server-controlled;
-- user_metadata is user-writable and must never be trusted for tenancy.
create or replace function current_org_id()
returns uuid
language sql stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid
$$;

-- ── Users ──────────────────────────────────────────────────────────────
-- Mirrors the client model so the two do not diverge before the sync engine
-- lands. Today authorization is client-side and these rows are a projection;
-- when Supabase Auth is wired up, `id` becomes `auth.users.id`, `role` is
-- copied into app_metadata (server-controlled, never user_metadata), and the
-- pin_* columns fall away in favour of a real credential.
--
-- The six digits never reach the server. Only the PBKDF2 salt, hash and
-- iteration count do — the same record the browser holds, so a terminal can
-- still authenticate while the connection is down.
--
-- One PIN per person is a uniqueness rule that cannot be expressed here: two
-- identical PINs under different salts produce different hashes. It is
-- enforced when a PIN is set. See src/lib/permissions.ts and usePos.addUser.

create type user_role as enum ('superadmin', 'waiter', 'purchaser');

create table if not exists users (
  id              uuid primary key,
  org_id          uuid not null references orgs(id) on delete cascade,
  name            text not null,
  role            user_role not null default 'waiter',
  -- Deactivated, never deleted: orders, stock moves and audit rows point here.
  active          boolean not null default true,
  pin_hash        text not null,
  pin_salt        text not null,
  pin_iterations  integer not null,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
);
create index if not exists users_org_idx on users (org_id) where active;

-- Read the caller's role from the JWT, the same way tenancy is read. The
-- client-side matrix in src/lib/permissions.ts is the UI's copy of this.
create or replace function current_user_role()
returns text
language sql stable
as $$
  select auth.jwt() -> 'app_metadata' ->> 'role'
$$;

-- ── Reference data ─────────────────────────────────────────────────────

create table if not exists branches (
  id           smallserial primary key,
  org_id       uuid not null references orgs(id) on delete cascade,
  name         text not null,
  address      text,
  tin          text,
  branch_code  text not null,
  color        text not null default '#ff5c1a',
  active       boolean not null default true,
  unique (org_id, branch_code)
);

create table if not exists products (
  id           smallserial primary key,
  org_id       uuid not null references orgs(id) on delete cascade,
  name         text not null,
  unit         text not null default 'pc',
  price_cents  integer not null check (price_cents >= 0),
  cost_cents   integer not null check (cost_cents >= 0),
  vat_exempt   boolean not null default false,
  active       boolean not null default true
);
create index if not exists products_org_idx on products (org_id) where active;

-- ── Gapless per-branch invoice numbers ─────────────────────────────────
-- BIR requires a sequential, non-resettable number. A client-side counter in
-- localStorage (what v6 used) is resettable by clearing browser data and
-- collides across terminals.

create table if not exists invoice_counters (
  branch_id  smallint primary key references branches(id) on delete cascade,
  last_no    bigint not null default 0
);

-- Offline terminals claim a block of numbers up front and burn through them
-- locally. Unused numbers at end of day are recorded as voided so the
-- sequence stays gapless and auditable.
create or replace function claim_invoice_block(p_branch smallint, p_size int)
returns table (first_no bigint, last_no bigint)
language plpgsql security definer
set search_path = public
as $$
declare
  v_start bigint;
begin
  if not exists (
    select 1 from branches b
    where b.id = p_branch and b.org_id = current_org_id()
  ) then
    raise exception 'branch not in caller org';
  end if;

  insert into invoice_counters (branch_id, last_no)
    values (p_branch, 0)
    on conflict (branch_id) do nothing;

  update invoice_counters c
     set last_no = c.last_no + p_size
   where c.branch_id = p_branch
  returning c.last_no - p_size into v_start;

  return query select v_start + 1, v_start + p_size;
end;
$$;

-- ── Event log (hot, 30-day retention) ──────────────────────────────────
-- Append-only. Clients emit immutable events with a client-generated UUIDv7
-- primary key, so a retried flush is an ON CONFLICT DO NOTHING rather than a
-- duplicate sale, and two terminals never clobber each other's writes.

create table if not exists order_events (
  id           uuid primary key,
  org_id       uuid not null references orgs(id) on delete cascade,
  branch_id    smallint not null references branches(id),
  order_id     uuid not null,
  seq          smallint not null,
  kind         text not null,
  payload      jsonb not null,
  device_id    uuid not null,
  occurred_at  timestamptz not null,   -- client clock
  received_at  timestamptz not null default now()  -- server clock
);
create index if not exists order_events_sync_idx
  on order_events (org_id, received_at);

-- ── Orders (projection) ────────────────────────────────────────────────

create type order_status as enum ('open', 'closed', 'voided');
create type discount_kind as enum ('none', 'senior', 'pwd', 'custom');

create table if not exists orders (
  id                 uuid primary key,
  org_id             uuid not null references orgs(id) on delete cascade,
  branch_id          smallint not null references branches(id),
  invoice_no         text not null,
  label              varchar(24) not null,
  order_type         smallint not null,
  status             order_status not null default 'open',
  opened_at          timestamptz not null,
  closed_at          timestamptz,
  business_date      date generated always as
                       ((coalesce(closed_at, opened_at) at time zone 'Asia/Manila')::date)
                       stored,

  gross_cents        integer not null default 0,
  vatable_cents      integer not null default 0,
  vat_exempt_cents   integer not null default 0,
  vat_cents          integer not null default 0,
  discount_cents     integer not null default 0,
  net_cents          integer not null default 0,

  discount_kind      discount_kind not null default 'none',
  -- RA 9994 / RA 10754 require the ID number on record for a statutory discount.
  discount_id_no     text,
  discount_id_name   text,

  -- Populated when the order closes; order_lines rows are dropped after 90
  -- days. Shape: [[product_id, qty, unit_cents], ...]
  lines              jsonb,

  voided_reason      text,
  voided_at          timestamptz,

  -- Who did what. Null on rows migrated from before accounts existed.
  opened_by          uuid references users(id),
  served_by          uuid references users(id),
  paid_by            uuid references users(id),
  voided_by          uuid references users(id),

  unique (branch_id, invoice_no),
  -- A statutory discount without an ID on file is not defensible at audit.
  constraint statutory_needs_id check (
    discount_kind not in ('senior', 'pwd')
    or status <> 'closed'
    or discount_id_no is not null
  )
);

create index if not exists orders_report_idx
  on orders (org_id, branch_id, business_date desc)
  where status = 'closed';

-- ── Order lines (hot only) ─────────────────────────────────────────────

create table if not exists order_lines (
  order_id    uuid not null references orders(id) on delete cascade,
  line_no     smallint not null,
  product_id  smallint not null references products(id),
  qty         smallint not null check (qty > 0),
  unit_cents  integer not null check (unit_cents >= 0),
  served      boolean not null default false,
  voided      boolean not null default false,
  void_reason text,
  primary key (order_id, line_no)
);

-- ── Tenders ────────────────────────────────────────────────────────────
-- 1:N, so a bill can be settled with cash plus GCash. v6 stored a single
-- payMethod string and could not represent a split tender at all.

create table if not exists tenders (
  id              uuid primary key,
  order_id        uuid not null references orders(id) on delete cascade,
  method          text not null check (
                    method in ('cash','gcash','maya','card','bank','other')),
  amount_cents    integer not null check (amount_cents > 0),
  tendered_cents  integer,   -- cash only
  change_cents    integer,   -- cash only
  ref_no          text,      -- GCash / Maya / card reference
  taken_at        timestamptz not null default now()
);
create index if not exists tenders_order_idx on tenders (order_id);

-- ── Stock ──────────────────────────────────────────────────────────────

create table if not exists stock (
  branch_id   smallint not null references branches(id) on delete cascade,
  product_id  smallint not null references products(id) on delete cascade,
  on_hand     integer not null default 0,   -- may go negative; that's a signal
  reorder_at  integer not null default 10,
  primary key (branch_id, product_id)
);

create table if not exists stock_moves (
  id          uuid primary key,
  org_id      uuid not null references orgs(id) on delete cascade,
  branch_id   smallint not null references branches(id),
  product_id  smallint not null references products(id),
  delta       integer not null,
  reason      text not null check (
                reason in ('sale','void','restock','spoilage','count','opening')),
  ref_order   uuid,
  note        text,
  actor_user_id uuid references users(id),
  at          timestamptz not null default now()
);
create index if not exists stock_moves_idx on stock_moves (branch_id, at desc);

-- ── Permanent rollups ──────────────────────────────────────────────────
-- These never expire and stay tiny. They answer every dashboard question
-- without scanning millions of line rows on a 500 MB shared-CPU instance.

create table if not exists daily_sales (
  branch_id      smallint not null references branches(id) on delete cascade,
  business_date  date not null,
  order_count    integer not null default 0,
  gross_cents    bigint not null default 0,
  discount_cents bigint not null default 0,
  vat_cents      bigint not null default 0,
  net_cents      bigint not null default 0,
  by_tender      jsonb not null default '{}'::jsonb,
  z_read_at      timestamptz,
  -- Tamper evidence: each day's hash includes the previous day's hash.
  z_read_hash    text,
  prev_hash      text,
  primary key (branch_id, business_date)
);

create table if not exists daily_product_sales (
  branch_id      smallint not null references branches(id) on delete cascade,
  business_date  date not null,
  product_id     smallint not null references products(id),
  qty            integer not null default 0,
  gross_cents    bigint not null default 0,
  cost_cents     bigint not null default 0,
  primary key (branch_id, business_date, product_id)
);

-- ── Audit ──────────────────────────────────────────────────────────────

create table if not exists audit_log (
  id         uuid primary key,
  org_id     uuid not null references orgs(id) on delete cascade,
  branch_id  smallint references branches(id),
  actor_user_id uuid references users(id),
  kind       text not null,
  message    text not null,
  at         timestamptz not null default now()
);
create index if not exists audit_log_idx on audit_log (org_id, at desc);
