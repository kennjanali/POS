# PROJECT BRIEF — Offline-First Restaurant POS

Instructions for AI agents who assess, design, build or optimize this product.
The brief is stack-agnostic on purpose: it describes **goals, behaviour, rules and quality bars**,
not tools. Choose any stack that meets every requirement, and justify the choice against §9.

---

## 0. How to use this brief

1. Read everything before proposing changes. §4 (invariants) must never break.
2. Anything under **Fixed** is decided. Anything under **Open** is yours to improve. Challenge it
   with evidence (trade-offs, cost, risk), not preference.
3. Every requirement has an acceptance check. A feature isn't done until its check passes.
4. Prefer the simplest design that satisfies the brief. No speculative features, no abstractions
   with a single use, no configurability nobody asked for.
5. When a requirement is ambiguous, state your assumption explicitly before you build on it.

---

## 1. Product

**What:** A point-of-sale and sales tracker for small restaurants. It runs on one tablet at the
counter with a wireless receipt printer, and it keeps working with no internet.

**Business model:** Sold and installed one store at a time. One-time license, optional yearly
maintenance (updates + support), plus a small percentage fee on monthly net sales, billed by the
vendor.

**Not:** A government-certified tax receipt machine. Printouts are order slips, clearly marked
"not an official receipt". Never market it as tax-authority accredited.

### Users

| User | Where | Needs |
|---|---|---|
| **Owner** | Store tablet | Full control: sales, voids, reports, staff, settings, backups |
| **Waiter / cashier** | Store tablet | Fast order taking, serving, payment. No voids, no reports |
| **Purchaser** | Store tablet | Inventory, stock adjustments, product edits only |
| **Vendor (product owner)** | Vendor dashboard | Every install's license, health, backup status and fees. **Never** sales detail |
| **Prospect / customer** | Public website | Learn, try a demo, register, get the license key and the app download |

### Target conditions
- A small, price-sensitive restaurant with patchy internet, a lunch rush and non-technical staff.
- A consumer-grade 10–11" tablet, used mostly in landscape. Touch only, no mouse, an on-screen
  keyboard.
- One vendor gives support. Low operating cost per customer is a requirement, not a nice-to-have.

---

## 2. System shape (Fixed)

Three parts:

1. **Store app.** Runs on the tablet with its own local database. It is fully functional offline.
   One install is one store, one branch and one terminal.
2. **Vendor server.** Licensing, heartbeat intake, encrypted backup storage, the vendor dashboard
   and the public website. The store app must never depend on it being reachable to sell.
3. **Public demo.** The same store app in a browser, always in training mode and watermarked.

**Data isolation comes from physical separation.** Each store's data lives on its own device. No
shared multi-tenant sales database, no staff accounts in the cloud.

**Future-proofing (don't build it, don't prevent it):** records use globally unique IDs, sales are
append-only, every record can be traced to an install ID, and the backup format is versioned.
That is all a later optional cloud-sync or multi-terminal add-on should need.

---

## 3. Functional requirements

### 3.1 First run and access
- **No default credentials ship with the product.** First launch opens a setup wizard: business
  name and address, tax (VAT) registration status, whether prices include VAT, an optional sample
  menu, owner name + 6-digit PIN (entered twice), printer pairing + test print.
- The wizard shows a **recovery code once**. It resets an owner PIN, and it is also the only key
  to the encrypted cloud backups. The wizard must make clear that losing the code means losing
  access to the cloud backups.
- Staff sign in with a personal 6-digit PIN. Repeated failures cause a timed lockout.
- The app auto-locks after a few minutes away (screen off, app switched).
- **One permission matrix** decides every access check: menu, route, button and data action.
  Hiding a link is not access control. A blocked page must never render, not even for one frame.
- Staff are deactivated, never deleted. The last owner can't be removed or demoted.

### 3.2 Selling
- Open orders side by side, each with a label and a type (dine-in, takeout, delivery platforms).
- Each order gets a **gapless, sequential order number**.
- Lines are added and then **served**. Serving deducts stock. Overselling is allowed and shows as a
  negative balance. It is never hidden.
- **Split payments:** cash (amount tendered + change), e-wallets, card, bank, other. Non-cash
  payments carry a reference number for end-of-day matching.
- An order can only be closed when at least one line is served and **the money taken equals the
  bill exactly**. If the bill changed after payment was entered, the payment must be entered again.
- At close, all totals are **frozen**: gross, taxable, tax-exempt, tax, discount, net, and the
  cost of each line. Later changes to settings or prices never rewrite a past sale.

### 3.3 Discounts and tax
- Statutory senior / disabled-person discount (Philippine rules): tax is removed first, then 20%
  off the tax-exclusive price. On a shared bill it applies only to eligible diners' share. The ID
  number and name are recorded.
- Custom percentage discounts are separate from statutory ones and get no tax exemption.
- **All money is integer minor units (centavos). Never floating point.**
- Worked example that must hold: a ₱500.00 VAT-inclusive bill, one senior diner, is due
  **₱357.14**.

### 3.4 Corrections and audit
- **Void, never delete.** A void keeps the record plus the reason, who did it and when. Stock for
  served lines comes back automatically.
- Every order records who opened it, served it, took payment and voided it. Every significant
  action goes into an audit log.

### 3.5 Inventory
- Stock per product, adjusted by sale, void, restock, spoilage, count or opening balance. Every
  change is a movement with a reason, an actor and a reference.
- Low-stock threshold and an optional stock display on the menu.

### 3.6 Reports
- Dashboard: today's and this month's net, best sellers, gross profit (using frozen cost),
  totals by payment method, the fee accrued this month.
- Order history with filters, for waiters read-only.

### 3.7 Daily close
- An end-of-day summary that runs automatically at a set time, or on the next launch if the
  device was off, plus a manual, printable close.
- Each close covers the window from the previous close up to now. **Every sale belongs to
  exactly one close.**
- A void of a sale from an earlier day is carried into the current close as a correction. The old
  close is never edited.
- The running total only goes up. **Each close is hash-chained to the previous one**, so an
  edited, dropped or reordered day can be detected.

### 3.8 Training mode
- Unlicensed installs run in training mode: watermarked slips, demo data and reset allowed.
- Going live requires a valid license and is **one-way**. A live install can never return to
  training mode. Training sales are never billed.

### 3.9 Licensing
- The license key is exchanged online, once, for a **digitally signed license** bound to this
  install and this device. One active device per license. A reinstall on the same device is
  allowed. Moving to another device needs the vendor to release the old one.
- **The license is verified offline on every launch.** The app never phones home just to open.
- A forged license, or one copied from another device, is rejected, and the app falls back to
  training mode.
- **An expired or missing license never blocks access to existing data.** Sign-in, history,
  reports, closes and backups always work. An expired maintenance period only stops updates.
- The goal is to keep honest customers honest, tie support to a record and gate updates. Heavy
  anti-piracy measures are out of scope.

### 3.10 Backups and recovery
Three layers:
1. **A local daily backup file** saved automatically. It survives an app uninstall. Failure is
   shown on screen.
2. **An encrypted cloud backup**, nightly when online, with missed nights caught up later. It is
   encrypted **on the device** with a key derived from the recovery code. **The vendor must be
   unable to read it.**
3. **Manual export / import**, plus monthly archives.
- **Device replacement:** install → activate → recovery code → choose a backup → everything is
  restored.
- Every backup carries the install ID, the app version and a format version.

### 3.11 Heartbeat and fee reporting
- Licensed installs only, and only when online. It sends app version, device model, last backup
  time, an error flag, and every daily close not yet confirmed by the server.
- The server confirms up to a close number. An offline week catches up in one successful beat.
- **Allowed off the device:** one net total per day (with its close number and hash, for gap
  checks) and device health. **Never:** line items, receipts, menu, staff names, credentials,
  discount IDs.
- Fee = a percentage of monthly net sales (after discounts, excluding voids). Diners never see it.
  A close reported twice (for example after a device swap) is billed once.
- Non-payment only triggers warnings. Nothing is restricted.

### 3.12 Printing
- Wireless thermal receipt printer, 58 mm and 80 mm layouts. Pair it in setup, reconnect
  automatically, show printer status, reprint the last slip.
- The browser demo falls back to the system print dialog.

### 3.13 Vendor server
- **Device API:** activate, heartbeat, upload a backup, list and download backups.
- **Vendor dashboard** (password or access-gated): one row per install showing license status,
  version, last seen, backup freshness, fees by month and payments. Actions: create, approve,
  release, revoke, extend, record a payment, add notes. Flag broken close chains and reporting
  gaps.
- **Public website:** landing page, demo link, registration (approved by the vendor), customer
  login to get the license key, fee due and app download, and password reset.
- Backup retention sized to keep cost near zero (for example recent days plus month-ends).

---

## 4. Invariants (never break these)

1. A closed sale is never lost: not by a crash, a force-kill, a power cut or a reboot.
2. A sale is never deleted. Corrections are voids with a reason and an actor.
3. Order numbers are gapless and never reused.
4. Totals are frozen at close and never recomputed from current settings.
5. Money is integer centavos everywhere.
6. Every sale falls into exactly one daily close. Closes are never rewritten.
7. A failed save is always visible to the user. No silent write failures.
8. Selling never requires the internet.
9. A license problem never blocks access to existing data.
10. Sales detail never leaves the device in readable form.
11. Training mode can't be re-entered once live.
12. Identifiers that decide data location or update identity (app ID, storage keys, app origin,
    signing key) are **frozen after the first customer install**. Changing them strands the
    customer's data.

---

## 5. Non-functional requirements

| Area | Bar |
|---|---|
| **Offline** | 100% of selling, reporting, closing and local backup work with no network |
| **Durability** | Each sale is written on its own. Write cost doesn't grow with history (a year of sales ≈ tens of MB) |
| **Performance** | Tap-to-feedback under 100 ms on a mid-range tablet; the app opens to the lock screen in under 3 s |
| **Touch UX** | Targets ≥ 44 px, no hover-only controls, usable with the on-screen keyboard open, no accidental text selection or long-press menus on the POS screen, landscape first, portrait usable |
| **Device behaviour** | Screen stays awake while signed in; the back button never exits the app from the main screen; kiosk / screen pinning supported |
| **Security** | Hashed and salted PINs with a slow hash; lockout; signed licenses; backups encrypted on the device; no debug tools in release builds; secrets only on the server |
| **Privacy** | Data minimisation per §3.11. Comply with the Philippine Data Privacy Act (RA 10173); the EULA states exactly what is sent and why |
| **Cost** | Near-zero per-customer server cost; runs on free or low tiers at launch |
| **Updates** | Never mid-shift: apply only with no open orders or after the close, back up first, roll back automatically if the new version fails to start. Separate beta and stable channels |
| **Accessibility** | Readable contrast in a bright shop, clear error text, no colour-only status |
| **Maintainability** | Business rules in one core, separate from the UI. Platform-specific code (storage, printer, files, device ID) behind small interfaces so the web demo and the tablet app share every screen |

---

## 6. Data model (conceptual)

- **Settings:** business profile, tax profile, receipt footer, stock display, training flag,
  paired printer.
- **Branch** (one per install for now): name, address, order-number prefix.
- **User:** name, role, active flag, PIN credential, timestamps.
- **Product:** name, unit, price, cost, tax-exempt flag, active flag.
- **Order:** number, type, label, status (open / closed / voided), lines, payments, discount data,
  frozen totals, actor fields, void data.
- **Stock movement:** product, delta, reason, reference, actor, time.
- **Daily close:** number, date, window, counts, totals by payment method, running net, previous
  hash, hash.
- **Audit entry:** time, kind, message, actor.
- **License** (signed, stored on the device): licensee, install ID, device hash, plan, dates.
- **Snapshot** (backup): all of the above plus a format version, install ID and app version.

Server side: licenses, activations, heartbeats, reported closes, payments, customer accounts and
sessions, encrypted backup blobs.

---

## 7. Quality gates

A change is done only when:

1. The checks cover and pass: tax maths (including the ₱357.14 case), auth and lockout, the
   permission matrix, void and stock return, gapless numbering, close windows and chain-tamper
   detection, license forgery and device binding, backup encrypt → decrypt and wrong-code
   rejection, heartbeat catch-up and no double billing.
2. **Migration test:** a backup from the previous version loads into the new build with every
   order, total, number sequence and user intact.
3. **Device tests:** opens in airplane mode; kill the app mid-sale 20 times and no closed sale is
   lost; reboot and the data is intact; update over the top and the data is intact; the printer
   reconnects after being turned off and on.
4. **End-to-end on a tablet-size screen:** wizard → sell → pay → slip → lock → forgot PIN →
   recovery → new PIN; a new device restored from the cloud backup.
5. Server: a tampered license is rejected; a second device is refused; the stored backup is
   unreadable ciphertext; a doctored close chain is flagged.

---

## 8. Scope

**In (v1):** everything in §3.
**Not yet, only when customers pay for it:** waiter handhelds sending orders to a counter
device, multi-branch rollup, an owner phone dashboard, optional cloud sync, a desktop build,
all-in-one POS terminals with built-in printers, app store distribution, a payment gateway for
fees, offline QR activation, menu CSV import, a support-bundle export.
**Never:** claims of tax-authority accreditation, vendor access to readable sales data, shipped
default credentials.

---

## 9. Open for optimization — what agents should assess

Rank findings by impact on §4 first, then cost, then user experience.

1. **Stack fit:** is the chosen app shell / storage / server stack the best fit for offline
   durability, printing, updates and near-zero cost? Propose alternatives only with a migration
   path that keeps §4.12.
2. **Durability under failure:** power loss mid-write, full storage, corrupted files, clock
   changes (the close window depends on time).
3. **Touch UX speed:** taps per sale, rush-hour ergonomics, one-handed use, error recovery.
4. **Security review:** PIN storage, license verification, backup key handling, server auth,
   rate limiting, abuse of the public endpoints.
5. **Privacy:** confirm nothing beyond §3.11 leaves the device, including logs and crash reports.
6. **Tamper evidence:** how hard is it to under-report sales for the fee, and can it be hardened
   without new infrastructure?
7. **Update safety:** atomic update, rollback, the "never mid-shift" rule, keeping the signing key
   safe.
8. **Onboarding time:** how fast can a non-technical owner be selling? Wizard, menu entry,
   printer pairing.
9. **Operating cost at 10 / 100 / 1,000 stores:** backup storage, requests, retention.
10. **Code health:** keeping the business core separate from the UI, test coverage of the
    invariants, dead code, bundle size.

**Deliverable format for assessments:** for each finding give the evidence, the risk (which
invariant or requirement it touches), the fix, the effort, and how to verify it.
