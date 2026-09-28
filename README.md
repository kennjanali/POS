# POS-034

Offline point of sale for small Philippine shops — restaurants, hardware and retail stores,
auto parts and service shops, car washes — by kennali.com. It runs on an Android tablet with a
Bluetooth receipt printer. One tablet is one shop.

**Status:** the app side of the redesign (Plan A) is built. The kennali.com platform (Plan B) and
the updates pipeline (Plan C) come next. The design is in
[docs/superpowers/specs/2026-09-27-pos-034-design.md](docs/superpowers/specs/2026-09-27-pos-034-design.md),
the plan in [docs/superpowers/plans/2026-09-27-pos-034-app.md](docs/superpowers/plans/2026-09-27-pos-034-app.md),
and progress in [docs/build-progress.html](docs/build-progress.html).
[TECH-STACK.md](TECH-STACK.md) lists what it is built with.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run check        # typecheck, lint, tests (Vitest), auth and safeguard checks
npm run build        # static export to ./out
npm run android:apk  # build, sync and assemble the Android release APK
```

No backend is needed to sell. All data lives on the device (SQLite on Android, IndexedDB in the
browser).

## What it does now

- **Presets by shop type.** Setup asks four things: the kind of shop, its name, the owner and
  their PIN, and what is on the shelf (a sample catalog, a spreadsheet, or nothing). The shop type
  sets feature switches — open tickets (tables, jobs or a queue), a serve step, services, quotes,
  vehicle plates, selling by the metre or kilo — and the owner can change any of them later under
  Settings → More options. A "Finish setting up" checklist on Today covers the rest: printer,
  address, VAT, license and staff.
- **Owner and Staff.** Staff sell, take payment, make and convert quotes, apply promo codes and
  see today's sales. Inventory, prices, owner discounts, cancelling sales or quotes, reports,
  settings and users are the owner's. Every decision goes through one permission matrix
  (`src/lib/permissions.ts`), and the store re-checks it, not just the screen.
- **Inventory.** Products and services with SKU, category and unit; add stock, count, damage,
  quick-add from the sell screen, per-item stock history and a low-stock list. Spreadsheet (CSV)
  import and export, with a preview of every row before anything is written.
- **No negative stock.** Open tickets hold what is on them, and nothing can be sold that is not on
  the shelf. Quantities are whole thousandths, so 2.5 m of wire is exact.
- **Easy payment.** Exact cash, GCash, or Other / split. Every sale is paid in full — no credit.
  Numbers are issued at payment, gapless per branch, and a sale is cancelled, never deleted.
- **Promo codes and owner discounts.** One discount per sale: an owner-made code (for example
  `GRAND10`) that anyone can enter, or an owner discount in % or ₱. A code is locked once a sale
  has used it.
- **Quotations.** Save a cart as a quote, print or share it, and convert it to a sale later at the
  quoted prices.
- **Today, This month and Today's summary.** Today shows the day's sales, discounts, money by
  method and expected cash. Today's summary runs by itself at 23:59 and is kept in a hash chain,
  so an edited day shows as tampered with.
- **VAT is automatic.** One owner setting. Prices always include VAT; a VAT-registered shop sees it
  on every slip and report, and others see none.
- **Practice mode and demo businesses.** A new install starts in practice mode: slips are marked
  `*** PRACTICE MODE ***`, and four demo businesses (Restaurant, Hardware Store, Auto Parts &
  Service, Car Wash) can be loaded. Going live needs a license, clears the practice data, and
  cannot be undone.
- **Saves that cannot half-happen.** Every change is written as one batch — the sale, its stock
  movements and its log entries together — and a failed save is retried with the next one.
- **Backups.** A backup saves itself each night, and a licensed tablet also keeps an encrypted
  copy in the cloud that only the recovery code opens.
- **Tablet-sized.** Big targets, landscape and portrait, and a one-line tip the first time each
  main screen opens.

## Layout

```
src/
  app/            routes: Today (/), sell, quotes, orders (Sales), inventory, month, settings
  components/     auth (wizard, lock screen, recovery), dashboard (Today's summary), inventory,
                  layout, orders, pos, quotes, settings, today, ui
  lib/            pure rules: tax, money, qty, presets, catalogs, promo, quotes, csv, closes, demo, ...
  store/          usePos (all business data and rules), useAuth (session only)
scripts/          verify-auth.mjs and verify-safeguards.mjs, run by `npm run check`
license-server/   activation, heartbeat and cloud backup (Cloudflare Worker)
```

The previous KRAMGEN v7 README and AUDIT are in git history at commit `226e22c`.
