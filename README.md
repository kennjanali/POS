# POS@034

Offline-first point of sale for small Philippine restaurants, sold and installed one store at
a time on an Android tablet with a Bluetooth receipt printer.

**Status: Phase 1 of the rework is done** (see [REWORK-PLAN.md](REWORK-PLAN.md)). The app
runs in a browser today; the Android app shell, licensing and BIR features come in later
phases. [TECH-STACK.md](TECH-STACK.md) lists what it is built with.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run check      # typecheck + lint + tax, auth, demo and safeguard checks
npm run build      # static export to ./out
```

No backend. All data lives on the device (IndexedDB).

## What it does now

- **Setup wizard on first launch.** No account ships with the app. The wizard asks for the
  business name, address, TIN, BIR branch code and VAT status, creates the owner's
  superadmin account and 6-digit PIN, and shows a **recovery code** once. A sample
  carinderia menu is optional.
- **Recovery code.** "Forgot PIN?" on the lock screen resets a superadmin's PIN with it.
  Stored only as a PBKDF2 hash; a new one can be issued from Settings.
- **Staff PINs and roles.** Superadmin, waiter and purchaser, one permission matrix
  (`src/lib/permissions.ts`). Every order records who opened, served, took payment and voided.
- **Senior/PWD discounts per RA 9994 / RA 10754 / RR 7-2010**, integer centavos throughout.
- **Void, never delete.** Per-branch gapless invoice numbers, totals frozen at close,
  training mode that can be turned off but never back on.
- **Backups.** A daily file saves itself at 23:59 (or on next launch), plus monthly archives.
  Each backup carries the install's ID and the app version.
- **Technology fee.** The Dashboard shows 2% of this month's net sales.
- **One install = one branch.** Extra branches only in training mode.
- **Tablet-sized.** Every control is at least 40 px, and it works in landscape and portrait.

## Layout

```
src/
  app/            routes: POS, orders, inventory, dashboard, settings
  components/     auth (wizard, lock screen, recovery), layout, pos, settings, ui
  lib/            brand, crypto, permissions, tax, money, types, idb, backup, archive
  store/          usePos (all business data), useAuth (session only)
scripts/          verify-*.mjs checks run by `npm run check`
```

The previous KRAMGEN v7 README and AUDIT are in git history at commit `226e22c`.
