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
| **Negative menu price** | Only the item name was validated. A price of −₱50 made a menu item that *subtracted* from a bill; stacking it brought any sale to ₱0.00, which then closed with no tender and filed as a normal completed sale — not a void, so nothing in the day's review pointed at it. Gross profit went negative. Price and cost are now refused below zero, on both create and edit. |
| **Demo data could give two branches one BIR code** | `loadDemoData` merged demo branches by id only. On an install that already had its own branch, the demo set added a second branch carrying a branch code already in use — the exact thing the Add branch form refuses, because the code prefixes the invoice number. Two sales then took the same invoice number. Demo branches are now added only when both id and code are free, and a branch that cannot be added takes its orders and stock with it. |
| **Change due after a late discount** | Applying a discount after cash was taken left the green "Change due" line showing the amount worked out against the *old* total, beside the red block saying the tender was over. Completion was already blocked, but a cashier reading the green line handed back the wrong money. It is hidden while the tender is over-recorded. |

All covered by `npm run verify:safeguards` — 92 checks, part of `npm run check`.

### Getting in

Every install ships with one superadmin, **PIN 000000**, shown on the lock
screen of a new device. There is no server to reset a forgotten PIN against,
so a till that could lock its owner out permanently was not acceptable.

That PIN is also an open door on a device handling cash, so a red bar sits on
every screen until it is changed, and 000000 cannot be set again afterwards —
by anyone, for any account. Change it in Settings → Users on day one.

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
choice, not a defect. Roughly 20 lines to change if you ever want it.
(The topbar wording was corrected earlier: the offline badge now says the sale
is saved on the device and warns against reloading. Nothing claims to sync.)

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

**~~3. No backup between archives.~~ FIXED.** The day's backup saves itself —
no button, no reminder to dismiss. `kramgen-backup-YYYY-MM-DD.json` is written
at **23:59**, or on the next launch if the till was already switched off, and
only when there are sales not already saved.

It runs on a one-minute tick rather than a timer set for midnight: a tablet
that suspends overnight never fires a long timer. It also runs behind the lock
screen, because closing time is exactly when the till is locked.

**Point Chrome's download folder at OneDrive or Google Drive** (Settings →
Downloads → Location). That is what gets the copy off the device; without it
the files sit in Downloads on the machine that could be lost.

**4. Roles are not a security boundary.** Anyone with browser devtools on the
till can edit stored data and make themselves superadmin. Inherent to a
device-only app; worth knowing if staff handle the tablet unsupervised.

**5. One tab at a time.** Two tabs each hold their own copy and overwrite each
other silently. Nothing enforces this yet.

**~~6. Dependencies — the critical one.~~ FIXED.** Bumped to Next 15.5.26
(inside the existing `^15.5.23` range, so it is a lockfile move, not a
migration). The critical Windows RCE that affected `next dev` on your machine
is gone. Build and all 227 checks pass on it.

Three **high** advisories remain, in `postcss` and `sharp` underneath Next's
build tooling. npm cannot clear them without `--force`, which moves to Next 16
— a major upgrade, not a patch. They are not reachable in the deployed app:
static export, no server, no image optimization. Recommend staying put and
re-checking when Next 16 is worth the migration on its own merits.

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

1. Confirm the BIR receipt fields (MIN, POS serial, PTU) with your accredited
   supplier — item 7. It is the only open item that can stop you trading.
2. Service worker, only if you want the app to open without signal.
