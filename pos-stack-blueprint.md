# POS Stack Blueprint
## Next.js + Supabase for a 1-person POS that scales to 1M+ transactions at $0

**Subject:** KRAMGEN POS v6 → production architecture
**Context:** Carinderia / small-restaurant POS, Bacolod City PH, manual tender capture, multi-branch
**Date:** August 2026

---

## 0. Verdict up front

**1M+ transactions on $0 is achievable, but not with a naive schema.** A textbook normalized design blows past Supabase's 500 MB free-tier ceiling at roughly 350,000 orders. With a deliberate data-lifecycle design it fits in ~200 MB with room to spare. The whole blueprint below hangs off that one number.

Two things will break "$0" before storage does, and neither is obvious:

1. **Vercel Hobby forbids commercial use.** <cite index="12-1">Vercel's Hobby plan is free with no time limit and includes 100 GB of Fast Data Transfer, 1 million function invocations, and 1 million edge requests per month — but the catch isn't a hidden fee, it's scope: Hobby is restricted to personal, non-commercial projects.</cite> <cite index="14-1">The Hobby plan explicitly prohibits commercial use in Vercel's terms of service; if you're building anything that generates revenue, even indirectly, you need a Pro account.</cite> A POS running a real carinderia's sales is commercial the day it takes its first peso. **Recommendation: Cloudflare Pages, not Vercel.** No commercial restriction, <cite index="22-1">requests to static assets are free and unlimited on both free and paid plans — a request is only counted when it invokes Functions.</cite>

2. **The 7-day inactivity pause.** <cite index="5-1">Free tier projects that receive no API requests for one week are paused automatically; your data is retained, but the project goes offline until you manually resume it.</cite> A daily-use POS never trips this. A *staging* project or a seasonal branch will. Budget a GitHub Actions keep-alive cron for any non-daily project.

---

## 1. The binding constraint: storage math

<cite index="10-1">Supabase Free allows two active projects, with 500 MB of database per project, 50,000 monthly active users, 5 GB of uncached egress plus 5 GB of cached egress, 1 GB of storage, 2 million Realtime messages, and 500,000 Edge Function invocations.</cite> <cite index="5-1">Compute is a shared CPU with 500 MB RAM, there are no daily backups and no SLA.</cite>

Postgres charges you more per row than you expect: 24 bytes of tuple header, a 4-byte line pointer, type alignment padding, and index entries that are often bigger than the data they point to.

### Naive schema (what most people build)

| Table | Rows | Bytes/row | Heap | Indexes | Total |
|---|---|---|---|---|---|
| `orders` (uuid PK, text status, numeric money, timestamptz ×2) | 1,000,000 | ~190 | 190 MB | ~70 MB | 260 MB |
| `order_items` (uuid PK, uuid FK, numeric) | 3,500,000 | ~110 | 385 MB | ~230 MB | 615 MB |
| **Total** | | | | | **~875 MB** |

Dead on arrival. You hit 500 MB at ~350K orders and Supabase flips the project read-only.

### Tight schema (integer centavos, smallint FKs, bigint PK)

| Table | Rows | Bytes/row | Heap | Indexes | Total |
|---|---|---|---|---|---|
| `orders` | 1,000,000 | ~92 | 92 MB | ~60 MB | 152 MB |
| `order_lines` (composite PK) | 3,500,000 | ~56 | 196 MB | ~112 MB | 308 MB |
| **Total** | | | | | **~460 MB** |

Technically fits — at 99% capacity, with zero headroom for products, stock, audit log, WAL, table bloat, or the ~20 MB of Postgres system catalogs. Not shippable.

### The design that actually works

A **closed order's line items never change again.** They are immutable the moment payment completes. So stop storing them as rows.

| Table | Rows | Notes | Total |
|---|---|---|---|
| `orders` (hot, ≤90 days) | ~90,000 | fully normalized | 14 MB |
| `order_lines` (hot only) | ~315,000 | normalized, queryable | 28 MB |
| `orders` (closed, lines as compressed `jsonb`) | 910,000 | `[[prod_id,qty,cents],...]` ≈ 30 B TOAST-compressed | 125 MB |
| `daily_product_sales` rollup | ~40,000 | branch × date × product, kept forever | 4 MB |
| `daily_sales` rollup | ~5,000 | branch × date × tender totals | <1 MB |
| products / stock / branches / audit | — | | ~15 MB |
| **Total for 1M+ transactions** | | | **~190 MB** |

**~310 MB of headroom.** That's the blueprint.

The principle: **normalize hot, denormalize cold, aggregate always.** You lose SQL-level `GROUP BY product` over history — and you don't care, because the rollup table answers every one of those questions in single-digit milliseconds instead of scanning 3.5M rows on a shared-CPU instance with 500 MB of RAM.

### Reality check on "1M"

One carinderia doing 200 orders/day takes 13 years to reach 1M. Five branches at 200/day each get there in ~2.7 years. So 1M is a *lifetime* figure, not a monthly one — which means the 5 GB/month egress ceiling is not the constraint people assume it is, **provided the client isn't re-fetching history it already has.** That's what Section 3 is about.

---

## 2. Stack selection

| Layer | Choice | Why | Free ceiling |
|---|---|---|---|
| Hosting | **Cloudflare Pages** (static export) | No commercial-use clause. <cite index="22-1">Static asset requests are free and unlimited.</cite> | Unlimited static requests |
| Framework | **Next.js 15, `output: 'export'`** | Ship a static bundle. Zero server functions = zero invocation cost. | — |
| Database | **Supabase Postgres** | Real SQL, RLS, PostgREST, Realtime | 500 MB |
| Auth | **Supabase Auth** | <cite index="10-1">50,000 monthly active users</cite> — you need ~5 | 50K MAU |
| Local store | **IndexedDB** (Dexie) | Offline-first, unbounded vs localStorage's 5–10 MB | Device disk |
| Cold archive | **Cloudflare R2** | 10 GB free, S3-compatible, zero egress fees | 10 GB |
| Cron / rollups | **pg_cron** in Postgres, or GitHub Actions | Free | — |
| Receipts | Browser print → ESC/POS via WebUSB or Web Serial | No print server | — |

**Do not use Next.js API routes or Server Actions.** They'd force you onto a platform that charges for invocations, and you don't need them: the browser talks to PostgREST directly with the anon key, and RLS is your authorization layer. This is the single decision that keeps hosting genuinely free and infinitely scalable.

If you later need server-side logic (BIR EIS transmission, scheduled Z-reading), use **Supabase Edge Functions** — <cite index="6-1">500,000 edge function invocations</cite> on free, which is ~16,000/day.

### On Realtime

<cite index="6-1">The free tier provides 200 concurrent realtime connections and 2 million realtime messages per month with a 256 KB max message size.</cite> With 3–5 terminals per branch you'll never approach 200 connections. But **do not broadcast full row payloads** — broadcast an invalidation signal (`{table, id}`) and let the client decide whether it cares. A chatty Realtime setup is the most common way small apps burn 2M messages.

---

## 3. Architecture: local-first, append-only sync

Your v6 instinct — client-side DB as source of truth — is correct and you should keep it. In Bacolod, the internet will drop mid-service. A POS that stops taking orders when the connection dies is worse than a notebook and a calculator.

```
┌──────────────────────────────────────────────┐
│  Terminal (Cloudflare Pages, static bundle)  │
│                                              │
│  UI ──► IndexedDB (source of truth for the   │
│          open shift)                         │
│           │                                  │
│           ├─► outbox: append-only event log  │
│           │                                  │
│           └─► reads: NEVER hit the network   │
│               for data already local         │
└───────────────┬──────────────────────────────┘
                │  batched flush, exponential backoff
                ▼
┌──────────────────────────────────────────────┐
│  Supabase (PostgREST + RLS)                  │
│                                              │
│  order_events (append-only, immutable)       │
│           │                                  │
│           ▼  trigger / pg_cron                │
│  orders ─► daily rollups ─► R2 archive       │
└──────────────────────────────────────────────┘
```

### Why append-only events, not row updates

Your current `_completePay` mutates an order in place. Under multi-device sync that's a last-write-wins race: two terminals both marking Table 3 paid, one silently clobbering the other.

Instead, the client emits immutable events:

```
ORDER_OPENED    { order_id, branch_id, label, type, at }
ITEM_ADDED      { order_id, product_id, qty, unit_cents, at }
ITEM_SERVED     { order_id, line_no, at }
ITEM_VOIDED     { order_id, line_no, reason, at }
DISCOUNT_SET    { order_id, kind, pct, id_no, at }
TENDER_TAKEN    { order_id, method, amount_cents, ref_no, at }
ORDER_CLOSED    { order_id, at }
ORDER_VOIDED    { order_id, reason, authorized_by, at }
```

Three things fall out of this for free:

- **Conflict resolution is trivial.** Events are commutative or ordered by `(order_id, seq)`. Nothing overwrites anything.
- **Retry is safe.** Give each event a client-generated UUIDv7 as its PK; a duplicate flush is an `ON CONFLICT DO NOTHING`. UUIDv7 is time-ordered, so it also gives you good B-tree locality — unlike UUIDv4, which fragments the index.
- **You get the BIR audit trail for free.** More on that in §7.

The `orders` table becomes a materialized projection maintained by a trigger. Events stay hot for 30 days, then get pruned once the projection is confirmed and archived.

### Egress discipline

5 GB/month sounds like a lot until a dashboard does `select *` on every render. Rules:

- Client fetches history **once**, by cursor, into IndexedDB. Subsequent loads sync deltas only (`where updated_at > last_sync`).
- Never `select *`. Column-select everything. An order row with `lines` jsonb excluded is ~80 bytes over the wire vs ~600 with.
- Dashboard reads hit `daily_sales` / `daily_product_sales`, never `orders`. A year of dashboard data is ~5 KB.
- Set `Cache-Control` on the static bundle; Cloudflare serves it from edge cache, and it never touches Supabase.

At 1,000 orders/day with 2 KB of sync traffic each, that's 60 MB/month. You have 5 GB.

---

## 4. Schema

```sql
-- ═══ REFERENCE ═══════════════════════════════════════════

create table branches (
  id          smallserial primary key,
  org_id      uuid not null references orgs(id),
  name        text not null,
  address     text,
  tin         text,                    -- BIR: per-branch TIN + branch code
  branch_code text,
  color       text default '#ff5c1a',
  active      boolean default true
);

create table products (
  id         smallserial primary key,
  org_id     uuid not null references orgs(id),
  name       text not null,
  unit       text,
  price_cents  integer not null,       -- integer centavos. never float.
  cost_cents   integer not null,
  vat_exempt   boolean default false,  -- rice/agri items may be exempt
  active     boolean default true
);

-- ═══ EVENTS (hot, 30-day retention) ══════════════════════

create table order_events (
  id         uuid primary key,         -- UUIDv7, client-generated
  org_id     uuid not null,
  branch_id  smallint not null,
  order_id   bigint not null,
  seq        smallint not null,
  kind       smallint not null,
  payload    jsonb not null,
  device_id  uuid not null,
  occurred_at timestamptz not null,    -- client clock
  received_at timestamptz default now()-- server clock; both matter for audit
);
create index on order_events (org_id, received_at);

-- ═══ ORDERS (projection) ═════════════════════════════════

create table orders (
  id            bigint primary key,    -- from per-branch gapless sequence
  org_id        uuid not null,
  branch_id     smallint not null,
  invoice_no    text not null,         -- BIR sequential, e.g. BR001-0000001
  label         varchar(24),           -- 'Table 3', 'Walk-in'
  order_type    smallint not null,     -- dine-in/takeout/grab/panda
  status        smallint not null,     -- 0 open, 1 closed, 2 voided
  opened_at     timestamptz not null,
  closed_at     timestamptz,

  gross_cents   integer not null default 0,  -- pre-discount, pre-VAT-split
  vatable_cents integer not null default 0,
  vat_exempt_cents integer not null default 0,
  vat_cents     integer not null default 0,
  disc_kind     smallint default 0,    -- 0 none, 1 senior, 2 pwd, 3 custom
  disc_cents    integer not null default 0,
  disc_id_no    text,                  -- BIR requires SC/PWD ID on record
  net_cents     integer not null,

  lines         jsonb,                 -- populated on close; null while open
  voided_reason text,
  voided_by     uuid,

  unique (branch_id, invoice_no)
);
create index on orders (org_id, branch_id, closed_at desc)
  where status = 1;

-- ═══ LINES (hot only; folded into orders.lines after 90d) ═

create table order_lines (
  order_id   bigint not null references orders(id),
  line_no    smallint not null,
  product_id smallint not null,
  qty        smallint not null,
  unit_cents integer not null,
  served     boolean default false,
  primary key (order_id, line_no)
);

-- ═══ TENDERS (your payment buttons, done right) ══════════

create table tenders (
  id            uuid primary key,
  order_id      bigint not null references orders(id),
  method        smallint not null,     -- cash/gcash/maya/card/bank/other
  amount_cents  integer not null,
  tendered_cents integer,              -- cash only
  change_cents  integer,               -- cash only
  ref_no        text,                  -- GCash/Maya/card reference
  taken_at      timestamptz not null
);
create index on tenders (order_id);

-- ═══ ROLLUPS (kept forever, tiny) ════════════════════════

create table daily_sales (
  branch_id   smallint,
  business_date date,
  order_count integer,
  gross_cents bigint,
  disc_cents  bigint,
  vat_cents   bigint,
  net_cents   bigint,
  by_tender   jsonb,                   -- {"cash":45000,"gcash":12000,...}
  z_read_at   timestamptz,
  z_read_hash text,                    -- tamper-evidence chain
  primary key (branch_id, business_date)
);

create table daily_product_sales (
  branch_id     smallint,
  business_date date,
  product_id    smallint,
  qty           integer,
  gross_cents   bigint,
  cost_cents    bigint,
  primary key (branch_id, business_date, product_id)
);

-- ═══ STOCK ═══════════════════════════════════════════════

create table stock (
  branch_id  smallint,
  product_id smallint,
  on_hand    integer not null,
  reorder_at integer default 10,
  primary key (branch_id, product_id)
);

create table stock_moves (             -- never mutate stock directly
  id         uuid primary key,
  branch_id  smallint, product_id smallint,
  delta      integer not null,
  reason     smallint not null,        -- sale/void/restock/spoilage/count
  ref_order  bigint,
  at         timestamptz default now()
);
```

### Row-level security

Single-tenant today, but write it multi-tenant from day one — retrofitting RLS onto a live POS is miserable.

```sql
alter table orders enable row level security;

create policy tenant_isolation on orders
  for all
  using  (org_id = (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid)
  with check (org_id = (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid);

-- closed orders are immutable: no UPDATE, no DELETE, ever
create policy no_edit_closed on orders
  for update using (status = 0);
```

`org_id` goes in `app_metadata` (server-controlled), never `user_metadata` (user-writable).

**One heads-up on timing:** <cite index="3-1">Supabase is rolling out a change to how tables are exposed through the Data API — new projects created after May 30, 2026 must add explicit Postgres grants for PostgREST access, and existing free projects are affected from October 30, 2026.</cite> Since you'd be creating a new project, plan for explicit `grant select, insert on ... to authenticated` statements in your migrations.

---

## 5. Payment methods — your manual-button model

You said tender is "in a click of a button, since it's mostly done manually." **That's the right call and you should defend it.** Concretely:

- No payment gateway means **no PCI-DSS scope**, which is the single largest compliance cost you're avoiding.
- No merchant discount rate. GCash/Maya QR-to-merchant settles direct to the owner's wallet; the POS just records that it happened.
- No gateway subscription, no per-transaction fee. This is what keeps "$0" honest.

But the current model — `order.payMethod = 'Cash'`, one string — will hurt you at reconciliation time. Three upgrades:

**1. Split tender.** Real carinderia scenario: ₱350 bill, customer pays ₱200 cash + ₱150 GCash. Your current schema can't represent this at all. Hence the `tenders` table being 1:N. The UI change is small — after picking a method, capture an amount that defaults to the remaining balance; if it's less, the modal stays open for the next tender.

**2. Cash tendered / change due.** Cashiers do this math in their head and get it wrong. `tendered_cents` and `change_cents` on the tender row, big change display on screen. This is also the #1 requested feature in every POS I've seen ship without it.

**3. Reference numbers for e-wallets.** GCash and Maya both give a 13-digit reference. Capture it. At end of day the owner reconciles the POS's GCash total against the GCash app's transaction list — without ref numbers that reconciliation is manual and error-prone, and it's exactly where staff theft hides.

The Z-reading breakdown by tender type falls straight out of `daily_sales.by_tender`, and BIR wants that breakdown anyway.

---

## 6. Findings from the v6 audit

These are real, ordered by severity. Several need fixing before this touches a paying customer.

### 6.1 The Senior/PWD discount computation is legally wrong — CRITICAL

Current code in `_billModal`:

```js
if(dtype==='senior'||dtype==='pwd') disc = sub*0.20;
const afterD = sub - disc;
const taxAmt = afterD * taxRate/100;   // ← charges VAT to a VAT-exempt customer
const total  = afterD + taxAmt;
```

Under RA 9994 and RA 10754, seniors and PWDs get 20% off **and** VAT exemption, and the order of operations is fixed: <cite index="35-1">Step 1: remove VAT → price ÷ 1.12 = VAT-exclusive price. Step 2: apply 20% discount → VAT-exclusive price × 20%. Step 3: final amount → VAT-exclusive price − discount. The PWD/Senior Citizen does NOT pay VAT AND gets 20% off the VAT-exclusive amount.</cite> <cite index="37-1">The total billing amount used in the computation of the 20% discount is the amount exclusive of VAT.</cite>

Worked example on a ₱500 VAT-inclusive bill:

| | Amount |
|---|---|
| Your code (₱500 − 20%, then +12% VAT) | **₱448.00** |
| Correct (₱500 ÷ 1.12 = ₱446.43, − 20%) | **₱357.14** |
| **Overcharge per senior transaction** | **₱90.86** |

<cite index="35-1">If you just take 20% off the total: ₱500 × 20% = ₱100 discount → pay ₱400. But that's not the correct computation.</cite> Your code is worse than even that shortcut because it adds VAT back on top. <cite index="38-1">Establishments denying or shortchanging senior and PWD discounts have drawn congressional investigation</cite> — this is enforcement-active territory, not a rounding quibble.

Also required and currently missing: **record the SC/PWD ID number and name per transaction.** <cite index="35-1">Maintain a logbook with the PWD/SC ID number, name, date, original amount, discounted amount, and establishment signatory; issue a separate receipt for the discounted portion; and report the sale as a VAT-exempt transaction, removed from the output VAT computation.</cite> Hence `disc_id_no` in the schema above.

One upside worth telling the owner: <cite index="35-1">under RA 9994 and RA 10754 the full cost of the discount can be deducted from gross income for income tax purposes — the deductible amount is the original VAT-exclusive price × 20%, so the discount doesn't come purely from the owner's pocket.</cite> Your rollup tables should surface this figure at year-end.

### 6.2 VAT is force-enabled and can't be turned off — HIGH

```js
DB.settings.tax = true;   // in dbLoad(), unconditional
if (!DB.settings.taxRate || DB.settings.taxRate <= 0) DB.settings.taxRate = 12;
```

A carinderia grossing under ₱3M/year is almost certainly **non-VAT registered** and pays 3% percentage tax instead. Charging 12% VAT with no VAT registration is a compliance problem in the other direction, and the code makes it impossible to disable. Also: your product prices are treated as VAT-*exclusive* (you add 12% on top), but a ₱89 Chicken Paa on a carinderia menu board is VAT-*inclusive*. Add a `prices_include_vat` setting and a `vat_registered` setting, and make both actually respected.

### 6.3 Client-side order sequence — HIGH

`dbNextId()` increments `DB.seq` in localStorage. Two terminals produce duplicate `ORD-00042`. Worse, BIR requires the opposite of what this does: <cite index="25-1">the machine must maintain a non-resettable accumulating total of at least 10 digits including decimal points, and the total must not be resettable by the user.</cite> A localStorage integer is resettable by clearing browser data.

Move to a per-branch Postgres sequence. Offline terminals pre-allocate a block of 100 numbers on connect and burn through them locally — gapless within the block, and unclaimed numbers at end-of-day get logged as voided so the sequence stays auditable.

### 6.4 Deleting orders instead of voiding — HIGH

`removeTable()` does `DB.orders = DB.orders.filter(o => o.id !== orderId)` — a hard delete, available even for completed orders. A deleted completed sale is indistinguishable from a sale that never happened, which is the exact pattern BIR audits look for. **Never delete. Void with reason + authorizing user, keep the row, exclude from totals.** The `no_edit_closed` RLS policy above enforces this at the database level so a compromised client can't do it either.

### 6.5 Money as floating point — MEDIUM

`price * qty` accumulated in JS floats, with `Math.round(x*100)/100` sprinkled in a few places and absent in others. Classic `0.1 + 0.2` territory: over 1M transactions, the dashboard total and the sum of receipts will not agree, and you'll spend a weekend finding out why. **Integer centavos end to end.** Format only at the render boundary.

### 6.6 Whole-DB serialization on every write — MEDIUM

```js
function dbSave() { localStorage.setItem(STORE, JSON.stringify(DB)); }
```

Called after every order action. This is O(total data) per write and localStorage caps at 5–10 MB — you'd hit the wall around 3,000–5,000 orders, and `catch(e) { console.warn(...) }` means it fails **silently**. The owner loses a day of sales and finds out at closing. IndexedDB with per-record writes, plus a visible "sync failed" indicator, not a console warning.

### 6.7 Overselling is silently swallowed — MEDIUM

```js
DB.stock[bid][pid] = Math.max(0, dbStock(bid, pid) - qty);
```

`Math.max(0, ...)` means selling 5 when 3 are in stock records the sale, zeroes the stock, and loses the 2-unit discrepancy. Either block the sale or record the negative and flag it. Silently absorbing it makes inventory variance untraceable — which, again, is where shrinkage hides.

### 6.8 `esc()` doesn't escape single quotes — MEDIUM

```js
function esc(s){ return String(s||'').replace(/&/g,'&amp;')
  .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
```

No `'` handling, and the codebase builds handlers by string concatenation: `onclick="POS._billModal(\''+orderId+'\')"`. A table named `Mom's Table` breaks the handler; a maliciously named one executes. Moving to React eliminates this whole class of bug — which is a genuine argument for the rewrite beyond just "Next.js is nice."

### 6.9 Audit log truncated at 150 entries — LOW but compliance-relevant

`DB.log.unshift(...)` with `if (DB.log.length > 150) DB.log.length = 150`. Also O(n) on every write. This is audit-trail data; it belongs in an append-only server table with indefinite retention, not a capped client array.

### 6.10 `uid()` collision risk — LOW

`Date.now().toString(36) + Math.random().toString(36).slice(2,6)` gives ~1.7M possible suffixes per millisecond. Fine at current scale, sloppy at 1M. UUIDv7 gives you uniqueness *and* index locality.

---

## 7. Philippine compliance layer

This is the part that turns a nice app into a sellable product, and it's substantially changed recently — most guides online are out of date.

**The Permit to Use is gone.** <cite index="28-1">RMC 5-2021 removed the Permit to Use for CRM/POS machines and Computerized Accounting Systems. You now register the system and the BIR issues an Acknowledgement Certificate within three working days of receiving the complete documentary requirements. Any POS still marketed around a PTU is working from an obsolete rule.</cite> (Note: you'll find 2026-dated articles still describing a "digital PTU" via eAccReg — treat the RMC 5-2021/RMO 9-2021 framing as authoritative and confirm with the RDO.)

**Technical requirements the software must meet:** <cite index="25-1">a non-resettable accumulating total of at least 10 digits including decimal points that the user cannot reset; tamper-proof operation, where the machine cannot be switched to training mode or no-sale transaction mode once registered; a daily Z Reading that closes and locks the day's sales total; and non-volatile memory or backup so sales data survives power loss or restart.</cite>

Map those onto the schema:

| BIR requirement | Implementation |
|---|---|
| Non-resettable grand total | `daily_sales` sum, server-side, no delete policy |
| Gapless sequential invoice no. | Per-branch Postgres sequence + offline block allocation |
| Z-reading (daily close) | pg_cron nightly, writes `z_read_at` + `z_read_hash` |
| Tamper evidence | Hash chain: each Z-read hashes the prior day's hash |
| Non-volatile | Postgres + R2 archive; the local IndexedDB is the *cache*, not the record |
| No training mode post-registration | Feature-flag it off at build for registered deployments |
| SC/PWD handling | `disc_kind`, `disc_id_no`, VAT-exempt sale classification |

**Retention:** <cite index="28-1">Under RR 17-2013 as amended by RR 5-2014, the first five years must be retained in hard copy and the remaining five may be kept electronically, provided the storage can index, retrieve, reproduce, and protect the records from alteration.</cite> Ten years total. Your R2 cold archive isn't just a storage optimization — it's the legally required half of that. Write it with checksums and immutable object versioning.

**E-invoicing is coming.** <cite index="28-1">For covered taxpayers the compliance deadline is 31 December 2026, set by RR 26-2025 which extended the timeline under RR 11-2025. An invoice generated by a CAS, CBA, POS, or other software is not treated as an "electronic invoice" unless the system can actually transmit the required data to the BIR in the structured format.</cite> A single carinderia is likely below the covered-taxpayer threshold today — but if you're building this to sell to multiple businesses, EIS transmission is a Supabase Edge Function you'll need within the year. Design the `orders` projection so it can serialize to the EIS schema without a migration.

**Reasonable scoping:** most single-location carinderias run on BIR-registered manual receipt booklets and don't register a POS at all. Nothing above blocks v1. But the *moment* this becomes a product you sell to others, compliance is the entire moat — and the schema decisions that make it possible (immutable orders, gapless sequences, hash-chained Z-reads) are painful to retrofit and nearly free to build in now.

---

## 8. Migration path

Don't rewrite blind. The v6 data model is close enough to map directly.

**Phase 0 — Freeze and characterize (1 day)**
Take a `DataIO.exportDB()` snapshot as the migration fixture. Write a converter script (v6 JSON → the SQL schema above). Every later phase gets validated against this fixture.

**Phase 1 — Fix the money bugs in v6 (2 days)**
Do these *in the existing HTML file*, before touching Next.js. §6.1 (SC/PWD), §6.2 (VAT toggle), §6.5 (centavos). Zero reason for the owner to keep overcharging seniors for the six weeks the rewrite takes.

**Phase 2 — Backend first, no UI (3 days)**
Supabase project, schema, RLS, sequences, rollup triggers, pg_cron. Load the Phase 0 fixture. Verify: dashboard queries against rollups return the same numbers the v6 client computed from raw orders. If they don't match, the schema is wrong and you find out before any UI exists.

**Phase 3 — Next.js shell + local-first core (1 week)**
Static export, Dexie, outbox, sync engine. Port the POS screen only — order open, add item, serve, tender, close. Run it **alongside** the v6 file on the same data for a week. This is the highest-risk phase; the sync engine is where local-first projects die.

**Phase 4 — Port remaining screens (1 week)**
Orders history, Inventory, Dashboard, Settings, Receipt. These are mostly reads and translate almost mechanically from your existing render functions.

**Phase 5 — Lifecycle jobs (2 days)**
90-day fold of `order_lines` into `orders.lines`. Monthly NDJSON.gz archive to R2. Restore-from-archive path — and *test the restore*, because an untested backup is a rumor.

**Phase 6 — Compliance hardening (as needed)**
Z-reading, hash chain, void workflow, SC/PWD logbook export.

---

## 9. When $0 actually breaks

Know your ceilings before you hit them, because <cite index="5-1">crossing a limit like egress triggers Supabase's Fair Use Policy: every service stops serving requests and returns a 402 until you upgrade or the billing period resets — and the usage meters can take up to an hour to catch up.</cite> Your POS goes down mid-lunch-rush and the dashboard tells you everything is fine.

| Ceiling | Free limit | You break it at | Escape |
|---|---|---|---|
| DB storage | 500 MB | ~2.5M transactions with this design | Archive more aggressively to R2 (free) |
| Egress | 5 GB/mo | ~2.5M sync round-trips/mo | Tighten column selection; more IndexedDB caching |
| Realtime msgs | 2M/mo | ~65K/day of invalidations | Batch invalidations; poll instead of push |
| Edge functions | 500K/mo | 16K/day | Move logic to pg_cron (free, unmetered) |
| Concurrent RT conns | 200 | 200 terminals | Not your problem for years |
| MAU | 50K | 50K staff logins | Not your problem, ever |
| Backups | **none** | Day one | **Solve this now, not later** |

**The backup gap is the one that should worry you.** <cite index="10-1">Free projects do not include downloadable backups or point-in-time recovery, so you need a separate data-protection plan.</cite> A POS with no backup is a business-ending liability. Nightly `pg_dump` via GitHub Actions → Cloudflare R2, encrypted, 30 daily + 12 monthly retained. Roughly 40 lines of YAML, and it's the highest-value thing on this entire list. Set it up in Phase 2, not Phase 5.

Realistically: **Supabase Pro at $25/month is the exit ramp**, and it buys daily backups, PITR, and no inactivity pause. Frame $0 as the *validation* tier — it takes you from zero to a proven, running business with real transaction history, and by the time you outgrow it, $25/month is trivially affordable against the revenue it's tracking. That's a better pitch than pretending $0 lasts forever.

---

## 10. Open questions for you

1. **Is the carinderia VAT-registered?** This changes the entire tax path and I'd rather not guess. Under ₱3M gross → almost certainly non-VAT, 3% percentage tax.
2. **Are menu prices VAT-inclusive?** Affects whether §6.2 is a settings change or a data migration.
3. **Multi-tenant product, or one business?** If you plan to sell this to other carinderias, the compliance work in §7 moves from "later" to "the whole product," and I'd sequence Phase 6 much earlier.
4. **Thermal printer model?** ESC/POS over WebUSB works in Chrome/Edge but not Safari or iOS — that constrains your terminal hardware choice more than anything else in this document.
