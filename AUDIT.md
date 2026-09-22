# KRAMGEN POS — status

Last updated 2026-09-23.

**What this is:** one POS system on one device. Staff sign in with a six-digit
PIN and do their job. Every sale is saved to the device instantly and stays
searchable. A daily backup file is the second copy.

Three roles:

| Role | Can |
|---|---|
| **Superadmin** | Everything, plus users and settings |
| **Waiter** | Open orders, add items, serve, take payment, read order history |
| **Purchaser** | Inventory only — stock counts and menu items |

---

## Fixed

| | |
|---|---|
| **Clear all sales data** | Was unguarded: it wiped the audit trail and restarted invoice numbers at 1. Now training-mode only, keeps the invoice sequence, and logs what it removed. |
| **Training mode** | Was a free toggle, so the demo-data lock was not a lock. Now a one-way door — off is permanent, confirmed, and logged. A restored backup can't reopen it. |
| **Payment vs bill** | Applying a discount after payment left an over-recorded tender (₱500 GCash booked against a ₱357 sale; cash change computed against the old total). The till now checks what it actually keeps — money in, less change out — and refuses to close until it matches. |
| **Dashboard voided count** | Ignored the date range; "Today" showed every void ever. Now filtered. |
| **Gross profit** | Used the product's *current* cost, so re-pricing the menu rewrote past margins. Cost is now frozen on the line at the moment of sale. |
| **Restore** | Accepted almost any file. Now validates version and shape before replacing anything, and logs the restore. |

All covered by `npm run verify:safeguards` — 61 checks, part of `npm run check`.

---

## Monthly archive — your backup

Settings → **Monthly archive**.

1. A finished month appears in the list with its sale count and net.
2. **Save file** downloads `kramgen-2026-09.json`.
3. **Open a saved month** reads it back and shows the totals — net, gross
   profit, tender breakdown, best sellers, best day.
4. Removing a month from the device is optional and rarely needed. If you
   do, the file must be opened and verified first.

Keeping a month costs nothing in speed, so the archive exists to get a copy
of your sales *off the device*, not to keep the app fast. Removal is there if
you want it — and before anything is deleted the file is checked against the
device, every sale and every total. One sale short and it refuses.

Never removed: open orders (an unpaid table from last month is still a table),
and loose stock adjustments like counts and restocks, because on-hand is a
running balance.

**Keep the files in a OneDrive or Google Drive folder.** That gives you an
off-device copy automatically, which is the whole disaster-recovery story.

Measured file sizes — about 1.67 KB per sale:

| Volume | Per month | Per year |
|---|---|---|
| 40 orders/day | ~2 MB | ~24 MB |
| 100 orders/day | ~5 MB | ~59 MB |

---

## Still open

**1. Needs internet to load the page.** No service worker. All the data is on
the device, but the app itself is fetched over the network, so a refresh with
no signal shows a blank page. Most POS needs internet anyway — recorded as a
choice, not a defect. Roughly 20 lines to change if you ever want it. The
topbar's "sales sync when the connection returns" message is wrong either way
and should go.

**~~2. Saving gets slower as the month fills.~~ FIXED.** Sales no longer sit
in the settings blob. They have their own IndexedDB stores, written one record
at a time, so a tap costs the same whether the device holds a week or a decade.

| | Per tap |
|---|---|
| Before — rewrite everything | 182 ms at one year |
| Now — write the changed row | 0.005 ms |

Verified in a real browser: an existing install of 3,738 orders migrated out of
the blob automatically on first load, leaving the blob at 3.5 KB. Reads are
unchanged and still instant — filtering a full year takes 2.6 ms — because
orders stay in memory. **A year of sales stays on the device and searchable.**

**~~3. No backup between archives.~~ FIXED.** A warning bar now appears on
every screen whenever the day's sales are not in a backup yet, naming how many
are at risk. One click saves `kramgen-backup-YYYY-MM-DD.json` and the bar
clears; it returns the next day. Keep the file in a OneDrive or Google Drive
folder and the copy leaves the device by itself.

**4. Roles are not a security boundary.** Anyone with browser devtools on the
till can edit stored data and make themselves superadmin. Inherent to a
device-only app; worth knowing if staff handle the tablet unsupervised.

**5. One tab at a time.** Two tabs each hold their own copy and overwrite each
other silently. Nothing enforces this yet.

**6. Dependencies.** `npm audit` reports 1 critical + 3 high, all in Next's
build tooling. Not reachable in the deployed app (static export, no server, no
image optimization), but the Windows RCE affects `next dev` on your machine.
Currently on 15.5.23; a 15.5.26 backport exists — worth testing.

**7. Receipt is missing BIR-accredited POS fields** — no MIN, POS serial, or
PTU number. Confirm the required set with your accredited supplier.

---

## What's solid

- **The tax engine.** RR 7-2010 order of operations is correct — VAT stripped
  first, 20% on the VAT-exclusive base, shared-bill proration handled.
- **Integer centavos everywhere**, branded so a raw number can't leak in.
- **Void, never delete.** Soft-deleted products and users, denormalised line
  names, per-branch gapless invoice numbers.
- **PIN hashing** — PBKDF2-HMAC-SHA256, 210k iterations, per-user salt,
  constant-time compare. Digits never stored.
- **Failed writes surface** to the topbar instead of being swallowed.
- **Negative stock recorded** rather than clamped to zero.

---

## Suggested order

1. Next 15.5.26 bump (dev-machine risk only).
2. Drop the misleading "sync" wording from the topbar.
3. Service worker, only if you want the app to open without signal.
