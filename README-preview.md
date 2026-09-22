# KRAMGEN POS v7

Offline-first point of sale for Philippine carinderias and small restaurants.
A rewrite of the v6 single-file HTML build onto Next.js 15, correcting the
statutory discount computation and replacing the client-side data model with
one that survives contact with a second terminal.

```bash
npm install
npm run dev        # http://localhost:3000
```

No backend is required to run it. The app is fully functional offline against
IndexedDB; Supabase is optional and additive.

---

## Why the rewrite

The v6 build worked, but four things in it were going to hurt:

**It overcharged senior citizens and PWDs.** The bill applied a 20% discount
and then added 12% VAT on top. Under RA 9994 and RA 10754 those customers are
VAT-*exempt*, and RR 7-2010 fixes the order of operations: strip the VAT
first, then take 20% off the VAT-exclusive amount. On a ₱500 bill v6 charged
₱448.00 against a correct ₱357.14 — ₱90.86 per transaction, in an area with
active enforcement.

**VAT was force-enabled and could not be switched off.** `dbLoad()` set
`DB.settings.tax = true` unconditionally. A carinderia under ₱3M annual gross
is a percentage-tax filer, not a VAT filer, and charging VAT without
registration is its own compliance problem.

**Completed sales could be deleted.** `removeTable()` spliced the order out of
the array. A deleted sale and a sale that never happened look identical at
audit.

**The whole database was re-serialized to localStorage on every action.**
O(total data) per write, a 5–10 MB ceiling, and `catch(e){ console.warn() }`
— so it failed silently somewhere around 3,000 orders and the owner found out
at closing.

---

## What changed

| Area | v6 | v7 |
|---|---|---|
| Senior / PWD | 20% off, then +12% VAT | VAT stripped first, 20% on the exclusive amount, ID number recorded, shared-bill split per RR 7-2010 |
| VAT | forced on, unswitchable | `vatRegistered` and `pricesIncludeVat` toggles; defaults to **non-VAT** |
| Payment | one `payMethod` string | `tenders` 1:N — split tender, cash change, e-wallet reference numbers |
| Cancelling | hard delete | void with mandatory reason; stock returned, row retained |
| Money | JS floats | integer centavos behind a branded `Centavos` type |
| Storage | whole-DB localStorage, silent failure | IndexedDB per-record; failures surface in the topbar |
| Overselling | `Math.max(0, …)` | negative stock recorded and flagged as variance |
| Order numbers | localStorage counter | per-branch gapless sequence, offline block allocation |
| Audit log | capped at 150, O(n) unshift | append-only, 2000 retained, syncs to server |
| Markup | string concat, `esc()` missing `'` | React; the injection class is gone |

The visual identity is unchanged — same warm ground (`#f0ede9`), near-black
rail (`#080808`), single orange accent (`#ff5c1a`).

---

## Verifying the tax engine

The discount logic is the part most worth not trusting on faith.

```bash
npm run verify:tax
```

Checks the engine against published worked examples: ₱500 senior → ₱357.14,
₱800 PWD → ₱571.43, ₱500 senior at a non-VAT business → ₱400.00, a ₱2,000
shared bill with 1 of 4 diners eligible → ₱1,857.14, and a custom discount
staying VATable. It also prints the v6 result alongside for contrast.

```bash
npm run check      # typecheck + lint + tax verification
```

---

## Architecture

```
Browser (static bundle on Cloudflare Pages)
  UI  ->  IndexedDB          source of truth for the open shift
            |
            +-> outbox       append-only event log, batched flush
                  |
                  v
Supabase (PostgREST + RLS)
  order_events -> orders -> daily rollups -> object storage archive
```

Three decisions carry most of the weight:

**Static export, no server functions.** `output: 'export'` produces a plain
static bundle. The browser talks to PostgREST directly and RLS is the entire
authorization boundary. Nothing is metered per request, and the deploy target
is Cloudflare Pages rather than Vercel — Vercel's Hobby plan prohibits
commercial use, which a POS taking real money violates on day one.

**Local-first.** In Bacolod the connection drops mid-service. A POS that stops
taking orders when the internet dies is worse than a notebook. Reads never hit
the network for data already held locally, which is also what keeps the app
inside a 5 GB/month egress budget.

**Append-only events, not row updates.** Clients emit immutable events keyed
by client-generated UUIDv7, so a retried flush is `ON CONFLICT DO NOTHING`
rather than a duplicate sale, two terminals never clobber each other, and the
BIR audit trail falls out for free.

---

## Fitting 1M transactions in 500 MB

Supabase's free tier gives 500 MB. A textbook normalized schema hits that wall
at roughly 350,000 orders — 1M orders plus 3.5M line rows runs ~875 MB with
naive types, ~460 MB even with tight ones, and that's before products, stock,
audit, WAL, and bloat.

A closed order's line items never change again, so they stop being rows:

| | Rows | Size |
|---|---|---|
| `orders` hot (≤90 days), normalized | 90,000 | 14 MB |
| `order_lines` hot only | 315,000 | 28 MB |
| `orders` closed, lines as compressed `jsonb` | 910,000 | 125 MB |
| `daily_product_sales` rollup, kept forever | 40,000 | 4 MB |
| `daily_sales` rollup | 5,000 | <1 MB |
| products / stock / branches / audit | — | ~15 MB |
| **Total** | | **~190 MB** |

Normalize hot, denormalize cold, aggregate always. You give up SQL-level
`GROUP BY product` over history and gain rollups that answer the same
questions in single-digit milliseconds instead of scanning 3.5M rows on a
shared CPU with 500 MB of RAM.

---

## Supabase setup

Optional. Apply in order:

```
supabase/001_schema.sql     tables, gapless invoice sequence, tenancy
supabase/002_rls.sql        row-level security, immutability, explicit grants
supabase/003_rollups.sql    daily rollups, Z-reading hash chain, 90-day fold
```

Then `cp .env.example .env.local` and fill in the project URL and anon key.

Two things to know about `002_rls.sql`. It's written multi-tenant from day one
because retrofitting tenancy onto a live POS is miserable. And it issues
explicit `grant` statements: Supabase projects created after 2026-05-30 need
these for PostgREST access, and existing free projects are affected from
2026-10-30 — without them the Data API returns nothing regardless of policies.

`org_id` is read from `app_metadata`, which is server-controlled. Never
`user_metadata`, which the user can write.

---

## Migrating v6 data

Export from the old build (Settings → Export Database), then:

```bash
node scripts/migrate-v6.mjs kramgen-db-2026-08-24.json > v7-snapshot.json
```

Restore the result via Settings → Restore.

The script reports how many senior/PWD sales were billed with the v6 formula
and the aggregate overcharge, but does **not** rewrite those totals. The
receipts were issued at the amount charged and the record should say so;
correcting them afterwards is an accounting decision, not a migration one.

Open orders in a v6 export are stale by definition and come across as voided
rather than resurrected as live tables.

---

## BIR compliance

Registered under RMC 5-2021, the Permit to Use is gone — you register the
system and the RDO issues an Acknowledgement Certificate within three working
days. What the software has to provide:

| Requirement | Where it lives |
|---|---|
| Non-resettable accumulating total | `daily_sales`, server-side, no delete policy |
| Gapless sequential invoice number | per-branch sequence + `claim_invoice_block()` |
| Daily Z-reading | `z_read()`, scheduled via pg_cron |
| Tamper evidence | each Z-read hashes the previous day's hash; `verify_z_chain()` |
| No training mode once registered | `settings.trainingMode`, off at go-live |
| SC/PWD handling | ID number, VAT-exempt classification, RR 7-2010 shared bills |
| Ten-year retention | five years hard copy, five electronic (RR 17-2013 / RR 5-2014) |

E-invoicing (EIS) transmission is not built. For covered taxpayers the
deadline is 31 December 2026 under RR 26-2025. A single carinderia is likely
below the threshold today, but the `orders` projection is shaped so it can
serialize to the EIS schema without a migration.

None of this blocks running the app. It matters the moment you sell it to
someone else — at which point compliance is the whole moat, and these schema
decisions are painful to retrofit and nearly free to have built in.

---

## Project layout

```
src/
  app/                    routes: POS, orders, inventory, dashboard, settings
  components/
    layout/               rail, topbar, shell context, new-order dialog
    pos/                  menu grid, order panel, checkout, receipt
    ui/                   Button, Modal, Field, Toggle, Toast, Empty
  lib/
    money.ts              integer centavos, branded type
    tax.ts                RA 9994 / RA 10754 / RR 7-2010 engine
    types.ts              domain model
    idb.ts                IndexedDB adapter
    format.ts             the only place centavos become decimals
  store/usePos.ts         zustand store, all mutations
supabase/                 three migrations
scripts/
  verify-tax.mjs          tax engine checks
  migrate-v6.mjs          v6 export converter
```

---

## Known gaps

- **No automatic backup.** Supabase free has none. Settings → Download backup
  is manual and should be done daily until a nightly `pg_dump` to object
  storage is wired up. This is the highest-value thing left undone.
- **Sync engine not built.** The schema and event model are in place; the
  outbox flush is not. The app is single-terminal until that lands.
- **Thermal printing is browser print.** ESC/POS over WebUSB works in Chrome
  and Edge but not Safari or iOS, which constrains terminal hardware.
- **Three high-severity advisories** remain in Next's bundled `postcss` and
  `sharp`. Both are build-time only and `sharp` never executes here since
  images are unoptimized. Clearing them requires Next 16.

## Open questions

1. Is the business VAT-registered? Changes the entire tax path; the default is
   currently off.
2. Are menu prices VAT-inclusive? Assumed yes.
3. One business or a product sold to others? If the latter, the compliance
   work moves from "later" to "the whole thing".
