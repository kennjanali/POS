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
IndexedDB. There is no server and nothing to sign up for.

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
| Access | one screen, everyone saw everything | three roles behind a six-digit PIN, with who-did-what on every sale |

The visual identity is unchanged — same warm ground (`#f0ede9`), near-black
rail (`#080808`), single orange accent (`#ff5c1a`).

---

## Accounts and access

Sign-in is a six-digit PIN on a numeric keypad. There are no usernames, which
means the PIN *is* the identity and no two people can hold the same one —
duplicates are caught when a PIN is set, not when someone tries to use it.

PINs are hashed with PBKDF2-HMAC-SHA256 through `crypto.subtle`, with a random
16-byte salt per person and the iteration count stored alongside so it can be
raised later without invalidating anyone. The digits themselves are never
written down: not to IndexedDB, not to the session, not to a log line.

Three roles:

| | Sees | Can |
|---|---|---|
| **Superadmin** | everything | everything, plus Settings → Users |
| **Waiter** | POS and order history | open orders, add items, serve, take payment, check what they rang up |
| **Purchaser** | Inventory only | adjust stock, edit menu items |

The matrix lives in one module, `src/lib/permissions.ts`, and every decision —
nav links, route guards, disabled buttons — goes through `can(user, 'order.void')`.
Nothing else in the codebase tests a role directly. Scattered `role === 'waiter'`
checks are how an access model quietly stops agreeing with itself.

The session is held in memory and mirrored to `sessionStorage`: close the tab
and you are signed out. The **Lock** button in the topbar does the same on
purpose, without disturbing what is on the floor. The failed-attempt counter is
the one thing kept in `localStorage` — five wrong PINs locks the keypad for
thirty seconds, and a lockout you can clear by pressing F5 is not a lockout.

A fresh install has no users and ships **no default PIN**. It asks for the
first superadmin before anything else loads. Nobody is ever deleted, only
deactivated, because orders and audit rows point at them — and the last active
superadmin can be neither deactivated nor demoted.

Every order records who opened it, who served it, who took the money and who
voided it; stock moves and audit entries carry the actor too. Orders history
shows served-by and paid-by; the activity log names the person on each line.

**This is UI-level access control, not a security boundary.** The app is a
static export: there is no server and no middleware, the guards run in the
browser, and anyone determined enough can reach the data in IndexedDB with
devtools. What it does is keep three people on the job each was given. The
app has no server, so this is the only boundary there is; anyone with
devtools on the till can work around it. Sales carry actor columns either way, so
the server model is already shaped for it.

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

The access model and the PIN hashing are checked the same way — the permission
matrix is asserted role by role, so widening one has to disagree with the test
out loud:

```bash
npm run verify:auth
```

```bash
npm run check      # typecheck + lint + tax, auth and demo verification
```

---

## Architecture

```
Browser (static bundle on Cloudflare)
  UI  ->  zustand (in memory)
            |
            +-> IndexedDB  kv          settings, menu, staff, stock  (~3 KB)
            +-> IndexedDB  orders      one record per sale
            +-> IndexedDB  stockMoves  one record per movement
                  |
                  v
            JSON backup files -> OneDrive / Google Drive
```

There is no server and no account to sign up for. Everything runs on the
device; the only thing that leaves it is a backup file you save yourself.

Three decisions carry most of the weight:

**Static export, no server functions.** `output: 'export'` produces a plain
static bundle. Nothing is metered per request, and the deploy target is
Cloudflare rather than Vercel — Vercel's Hobby plan prohibits commercial use,
which a POS taking real money violates on day one.

**Sales are rows, not part of a blob.** Settings, menu, staff and stock are
small and rarely change, so they persist as one small JSON blob. Sales are
neither, so they get their own IndexedDB stores written one record at a time.
A tap costs the same whether the device holds a week or a decade of trading;
putting them in the blob cost 182 ms per tap after a year. Reads stay in
memory, so every screen that filters or sums sales is plain synchronous code.

**Frozen totals, append-only history.** An order's totals are computed once at
close and stored, so changing the menu or the tax settings later never rewrites
a receipt. Sales are voided, never deleted; products and staff are deactivated,
never removed. Line items carry their own name and cost so history stays
readable after a rename or a re-price.

---

## Backups

Every sale is written to the device the moment it happens, so nothing is lost
to a closed tab, a flat battery or a reload. The device itself is the risk.

A bar appears on every screen when the day's sales are not in a backup yet,
naming how many are at risk. One click saves
`kramgen-backup-YYYY-MM-DD.json`; the bar clears and returns the next day.
Settings → Monthly archive additionally saves a whole finished month as one
file, with its totals precomputed so opening it answers "how did we do" without
a rescan.

**Keep the files in a OneDrive or Google Drive folder.** That is the entire
disaster-recovery story: the copy leaves the building by itself.

Measured, about 1.67 KB per sale:

| Volume | Per day | Per year on the device |
|---|---|---|
| 40 orders/day | ~67 KB | ~24 MB |
| 100 orders/day | ~167 KB | ~59 MB |

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
    auth/                 keypad, lock screen, first-run setup, route gate
    layout/               rail, topbar, backup bar, shell, new-order dialog
    pos/                  menu grid, order panel, checkout, receipt
    settings/             branches, users, monthly archive
    ui/                   Button, Modal, Field, Toggle, Toast, Empty
  lib/
    permissions.ts        the role matrix — can(user, 'order.void')
    crypto.ts             PBKDF2 PIN hashing, the only place digits appear
    money.ts              integer centavos, branded type
    tax.ts                RA 9994 / RA 10754 / RR 7-2010 engine
    types.ts              domain model
    idb.ts                IndexedDB — the settings blob and the row stores
    archive.ts            monthly archive: build, summarise, verify
    backup.ts             daily backup file
    format.ts             the only place centavos become decimals
  store/usePos.ts         zustand store, all mutations
  store/useAuth.ts        session and lockout — never touches IndexedDB
scripts/
  verify-tax.mjs          tax engine checks
  verify-auth.mjs         role matrix and PIN hashing
  verify-demo.mjs         demo generator invariants
  verify-safeguards.mjs   the safeguards that protect the books (61 checks)
  migrate-v6.mjs          v6 export converter
```

---

## Known gaps

- **Needs internet to load the page.** All the data is local, but the app
  itself is fetched over the network, so a refresh with no signal shows a
  blank page. A service worker would fix it; most POS needs internet anyway,
  so this is recorded as a choice rather than a defect.
- **One tab at a time.** Two tabs on one machine each hold their own copy of
  the state and overwrite each other — the second tab's sales win and the
  first tab's are lost, silently. Nothing in the app enforces this yet.
- **One device.** Sales live on the device that took them. Two tills would
  each keep their own books and would issue colliding invoice numbers, so a
  second terminal needs a server first.
- **Roles are not a security boundary.** Anyone with browser devtools on the
  till can edit stored data and make themselves superadmin. Inherent to an
  app with no server.
- **Orders history shows the 200 most recent matches.** Rendering a whole
  month cost over a second of blocked main thread per keystroke in the search
  box. The date and search filters reach the rest, and the row count under the
  table always says how many are held back.
- **Thermal printing is browser print.** ESC/POS over WebUSB works in Chrome
  and Edge but not Safari or iOS, which constrains terminal hardware.
- **Four advisories** (1 critical, 3 high) remain in Next's build tooling.
  None is reachable in the deployed app — static export, no server, no image
  optimization — but the critical one affects `next dev` on Windows.
  Currently on 15.5.23; a 15.5.26 backport exists and is worth testing.

## Open questions

1. Is the business VAT-registered? Changes the entire tax path; the default is
   currently off.
2. Are menu prices VAT-inclusive? Assumed yes.
3. One business or a product sold to others? If the latter, the compliance
   work moves from "later" to "the whole thing".
