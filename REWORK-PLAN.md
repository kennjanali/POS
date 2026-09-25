# REWORK PLAN — from "my POS" to a sellable, per-business install

Status: **planning only, nothing implemented.** Written 2026-09-25 against commit `226e22c`.
Target changed to **Android tablets** on 2026-09-25 (was Windows PC).

**Product name: POS@034.** KRAMGEN is no longer the product — it is **customer #1**, the pilot
install used to practise the whole sell → install → activate → support loop. The `@` is fine in
display text, but it can't go in identifiers, file names, domains or storage keys, so those
use a slug (proposed: `pos034`).

**Target device: an ordinary Android tablet + a Bluetooth thermal receipt printer.** One
tablet = one install = one store.

---

## 0. TL;DR

1. **Keep the architecture you already have: one local database per install.** The app is
   already single-tenant by construction (local storage, no server). You do not need tenant
   IDs, a shared cloud DB, or a user-account backend. What you are missing is the *product
   shell* around it: an Android app, licensing, updates and printing.
2. **Wrap the existing static export in a Capacitor 8 Android app.** Same React code, running
   inside a native Android app with SQLite storage, Bluetooth receipt printing, and its own
   data sandbox — no browser profile to clear, opens with no internet.
3. **Keep the users system. Restructure it slightly.** Local staff PINs per store are the right
   model. Change: replace the shipped `000000` owner with the first-run wizard (already written,
   currently unreachable), add an owner recovery code, and keep *licensing* separate from *users*.
4. **License with an Ed25519-signed license file** issued by a small Cloudflare Worker you
   already have the account for. Verify offline on every launch. Unlicensed = training mode.
5. **Tablets get dropped and stolen — backups go off the device automatically.** Encrypted
   daily backup to your Cloudflare storage, locked with the owner's recovery code so you can't
   read it. New tablet → activate → recovery code → sales are back.
6. **Stack ([TECH-STACK.md](TECH-STACK.md)): don't rewrite.** Keep React + TypeScript + Next
   static export + zustand; add Capacitor (Android), SQLite, and Cloudflare Workers + D1.
7. **A sales tracker, not a BIR machine (§10).** POS@034 keeps accurate sales, inventory and
   staff records and prints order slips marked "not an official receipt". BIR invoicing and
   registration stay with the business owner.

---

## 1. What exists today (verified in the code)

| Area | Current state | File |
|---|---|---|
| Stack | Next.js 15 static export (`output: 'export'`), React 19, zustand, Tailwind 4 | `next.config.ts`, `package.json` |
| Data | IndexedDB `kramgen`: one small settings blob + row stores for orders / stockMoves | `src/lib/idb.ts` |
| Deploy | Static bundle on Cloudflare Workers assets — **one public URL for everyone** | `wrangler.jsonc` |
| Users | 3 roles (superadmin / waiter / purchaser), 6-digit PIN, PBKDF2 210k, per-user salt | `src/lib/crypto.ts`, `src/lib/permissions.ts` |
| First run | Every install seeded with superadmin `Owner`, PIN `000000`, red nag bar until changed | `src/lib/seed.ts`, `DefaultPinBar.tsx` |
| Session | Memory + sessionStorage; lockout counter in localStorage | `src/store/useAuth.ts` |
| Tax | RA 9994 / RA 10754 / RR 7-2010 engine, integer centavos | `src/lib/tax.ts`, `src/lib/money.ts` |
| Safety | Void-never-delete, per-branch gapless invoice no., frozen totals, training mode one-way door | `src/store/usePos.ts` |
| Backups | Auto daily JSON download at 23:59, monthly archive | `src/lib/backup.ts`, `src/lib/archive.ts` |
| Printing | Browser print dialog | `src/components/pos/Receipt.tsx` |
| Checks | `npm run check` = typecheck + lint + tax/auth/demo/safeguards scripts | `scripts/` |

The foundations (money, tax, audit trail, void rules, PIN hashing) are solid and carry over
unchanged. The rework is mostly *around* the app, not inside it — except the screen layout,
which was built for a desktop browser and needs a tablet pass (6.9).

---

## 2. Findings that shape the plan

1. **The "users" system is not a multi-tenant problem.** Each install has its own local
   database, so users, orders, and settings are already isolated per business. Adding
   `business_id` columns would be solving a problem you don't have.

2. **The hosted URL is the actual problem for selling.** Today anyone who opens the Cloudflare
   URL gets the full product free, forever, with no license check. And each customer's books
   sit in their browser profile: clearing site data, switching profiles, or resetting the
   device deletes everything except the last backup file.

3. **`FirstRunSetup.tsx` is dead code.** `AuthGate` shows it only when `users.length === 0`, but
   the seed always inserts `DEFAULT_SUPERADMIN`, so it never shows. Its own doc comment ("ships
   no default PIN") contradicts `seed.ts`. It is the right component for a sold product (§5).

4. **The old README's BIR table described code that no longer exists.** It listed `daily_sales`,
   `claim_invoice_block()`, `z_read()`, pg_cron and `verify_z_chain()`. Those were Supabase
   server features from the initial commit; there is no Supabase code in `src/` or `scripts/`
   now. Today there is **no Z-reading, no X-reading, no non-resettable grand total, and no
   e-journal**. The old AUDIT.md item 7 (MIN / serial / PTU missing from the receipt) was also
   still open. Both files were retired on 2026-09-25; read them in git history at `226e22c`.

5. **Shop-specific data is baked in.** `DEFAULT_SETTINGS` (business name `KRAMGEN`, a Bacolod
   address), `DEFAULT_BRANCH`, and a 12-item carinderia menu ship to every install. "KRAMGEN"
   appears in 9 source files.

6. **Some names can never change after the first customer install:** the storage keys
   (`kramgen` in `idb.ts`, `kramgen-pos-v7` in `usePos.ts:1154` — renamed to `pos034` in
   Phase 1), the Android **application ID**, the Capacitor **scheme + hostname** (§8), and the
   **APK signing key**. Changing any of them either hides the customer's data or makes the app
   impossible to update without uninstalling (which deletes the data).

7. **Multi-branch inside one install doesn't match the install model.** A second branch is a
   second tablet with its own database. For v1: one install = one branch = one terminal.

8. **The UI assumes a desktop browser.** Sidebar rail, hover states, a print dialog, a mouse.
   A 10–11" landscape tablet needs larger touch targets, no hover-only controls, and screens
   that survive the on-screen keyboard covering half the display.

---

## 3. Architecture decision

### Options

| | A. Local DB per install (tablet app) | B. Shared cloud DB (SaaS) | C. Local-first + optional cloud sync |
|---|---|---|---|
| Works with no internet | Yes, fully | No (or needs a sync layer anyway) | Yes |
| Monthly cost to you per customer | ~₱0 (plus a few MB of backup storage) | DB + hosting, grows with customers | Only for customers who buy sync |
| Data ownership / Data Privacy Act exposure | Customer's tablet; you hold only encrypted backups you can't read | You are the processor for every customer's data | Only for sync customers |
| Multi-terminal / multi-branch reporting | No | Yes | Yes (paid add-on) |
| Owner checks sales from phone | No | Yes | Yes (add-on) |
| Hardware loss | Restore from encrypted cloud backup | Nothing lost | Nothing lost if synced |
| Tenant isolation work | None | `business_id` on every row + RLS, the whole codebase | Server side only |
| Rework size from today | Small | Large rewrite | A, then add a server later |
| Fits PH carinderia market (patchy internet, one-time purchase preference) | Best | Poor | Good |

### Recommendation: **A now, designed so C can be added later**

- Ship A. It matches the existing code, the target market, and a one-person support load.
- Don't foreclose C: keep sales as append-only rows with UUIDs (already true), stamp every row
  with an `installId` (new, see §6), and keep the `DataSnapshot` export format stable. That is
  all a future sync server needs.
- Do **not** build a cloud DB or tenant model now.

### App shell: Capacitor vs Tauri 2 (mobile)

| | Capacitor 8 (decided) | Tauri 2 on Android |
|---|---|---|
| Android maturity | Years in production (Ionic ecosystem) | Mobile support is new |
| Bluetooth ESC/POS printing | Ready plugins (e.g. `capacitor-thermal-printer`), or `bluetooth-le` + an encoder | Write native code yourself |
| SQLite | `@capacitor-community/sqlite` (v8, SQLCipher encryption available) | Plugin available |
| Web-layer live updates | `@capgo/capacitor-updater`, open source, self-hostable | None equivalent |
| Next.js static export | Supported (`webDir: "out"`) | Supported |
| Native language when needed | Kotlin/Java | Rust + Kotlin |

Windows PC support moves to "later, if a customer asks" — the same web code can go into
Tauri or Electron then.

---

## 3a. Tech stack

See **[TECH-STACK.md](TECH-STACK.md)**: every layer marked Keep / Rework / Remove / Add,
plus the target repo layout and a change log.

---

## 4. What the Android app fixes from the current "Known gaps"

| Old README / AUDIT gap | After Capacitor |
|---|---|
| Needs internet to load the page | Fixed — web assets bundled inside the APK |
| One tab at a time, silent overwrite | Fixed — one app, one WebView |
| Data wiped by clearing browser data | Fixed — data lives in the app's private sandbox (SQLite file) |
| Backups land in Downloads | Replaced — encrypted automatic cloud backup + local file (§8.7) |
| Roles not a security boundary | Improved — no devtools on a release build, sandboxed storage. Still not a hard boundary on a rooted tablet. Say so in the EULA |
| Browser print only | Replaced — Bluetooth ESC/POS printing (required on a tablet) |
| One device | Unchanged — deliberate for v1 |

New risk the tablet adds: **uninstalling the app deletes its data**, and tablets are lost,
dropped and stolen more than PCs. That is why off-device backup is part of Phase 2/3, not an
extra.

---

## 5. Users and authentication — decision

**Keep local users per install. Restructure four things.**

### Keep
- 6-digit PIN, PBKDF2, per-user salt, lockout, `can()` matrix, deactivate-never-delete,
  last-superadmin protection, actor stamping on every record. All correct for this model.
- The PIN keypad is already the right UI for a touch screen.

### Change

1. **Drop the shipped `000000` owner; use the first-run wizard.** A product you sell should not
   ship every customer the same published credential. Revive `FirstRunSetup.tsx` and extend it
   into a setup wizard:
   1. Business name, address
   2. VAT-registered yes/no, prices include VAT yes/no (drives the Senior/PWD maths)
   3. Sample menu yes/no
   4. Owner name + PIN (entered twice)
   5. Pair the Bluetooth printer + test print
   6. **Recovery code** shown once — print it on the receipt printer and keep it safe (see 2)
   - Code changes: empty `users` in initial state, remove `DEFAULT_SUPERADMIN`,
     `DEFAULT_PIN_CREDENTIAL`, `hasDefaultPin`, `DefaultPinBar`, and the "000000 can never be
     set again" rule (it only exists because of the shipped PIN).
   - Update `scripts/verify-auth.mjs` / `verify-safeguards.mjs` accordingly.

2. **Owner recovery code.** Today a forgotten owner PIN on a single-superadmin install is
   unrecoverable — the only reason `000000` exists. Replace with: at setup, generate a random
   12-character recovery code, store only its PBKDF2 hash, and add "Forgot PIN?" on the lock
   screen → enter recovery code → set a new PIN for a superadmin → audit entry. The same code
   also unlocks the encrypted cloud backup (§8.7), so it does double duty: **lose the code and
   the cloud backups can't be opened** — the wizard has to make that clear. Backup plan: vendor
   support reset via a signed one-time token bound to the install ID (Phase 3, optional).

3. **Separate "licensee" from "users".** The business that bought the license (name, TIN,
   license ID, plan) lives in the license file (§7), not in `users` and not in editable
   settings. Staff users stay purely local and are never sent anywhere.

4. **Role labels.** Restaurants only at launch, so `waiter` stays. Optional: show `superadmin`
   as "Owner" in `ROLE_LABELS` (label only — stored role keys unchanged, no migration).
   Consider a `manager` role (void + reports, no user management) if pilot customers ask.

### Not needed
- No email/password accounts, no OAuth, no server-side users, no `business_id`.

---

## 6. Productizing the codebase (before any packaging)

| # | Change | Where | Verify |
|---|---|---|---|
| 6.1 | Product name **POS@034** in one constant (`src/lib/brand.ts`): display name `POS@034`, slug `pos034`, support contact, backup-file prefix (`pos034-backup-YYYY-MM-DD.json`). Replace the 9 hard-coded `KRAMGEN` usages; "KRAMGEN" survives only as customer #1's business name, entered in the setup wizard. | `src/lib/*`, components | `grep -ri kramgen src` returns nothing |
| 6.2 | **Storage keys.** Rename `kramgen` → `pos034` and `kramgen-pos-v7` → `pos034-v7` now. No data copy needed — KRAMGEN has practice data only and starts fresh. Frozen from then on. | `idb.ts`, `usePos.ts` | Fresh install uses only the `pos034` keys |
| 6.3 | Neutral defaults: empty business name/address, empty menu, one branch created by the wizard. Keep the carinderia menu as an optional "Start from a template" choice. Demo data only in training mode (already enforced). | `seed.ts`, `FirstRunSetup.tsx` | Fresh install opens to the wizard, not to your shop |
| 6.4 | First-run wizard + recovery code (§5). | `auth/`, `usePos.ts`, `crypto.ts` | New verify cases in `verify-auth.mjs` |
| 6.5 | One install = one branch: hide Add Branch in `BranchManager` (keep editing the one branch). Keep the data model so sync (Option C) can use it later. | `BranchManager.tsx` | Can't create a 2nd branch outside training mode |
| 6.6 | Add `installId` (UUIDv7 generated once at first run) and `appVersion` to settings, every backup file, and the audit log header. | `types.ts`, `backup.ts`, `archive.ts` | Backup JSON contains both |
| 6.7 | Schema versioning: make `DataSnapshot.version` and the persist `version` the single migration point; migration test loads a v7 backup into the new build. | `usePos.ts`, `scripts/` | New `verify:migrate` script in `npm run check` |
| 6.8 | Grow the new `README.md` as features land. Describe only what the code actually does. | `README.md` | — |
| 6.9 | **Tablet layout pass.** Design for 10–11" landscape (1280×800 / 1920×1200) first, portrait usable. Touch targets ≥ 44 px, no hover-only controls, sidebar collapses to icons, modals and forms stay usable with the on-screen keyboard open, no text selection / long-press menus on the POS floor. | `components/layout`, `components/pos`, `globals.css` | Playwright at tablet viewports; hands-on test on a real tablet |
| 6.10 | **Platform seams.** Put storage, printing, backup, device ID and file export behind one small interface each (`src/platform/*`) with a web implementation (demo) and an Android implementation. Components never call Capacitor directly. | `src/platform/` | Web demo and Android build share every component |

---

## 7. Licensing and activation

### Model (decided)
- **One-time license per install + optional yearly maintenance** (updates + support).
- **Plus a 2% technology fee on net sales**, owed by the store to you, billed monthly:
  - Base = net sales (after senior/PWD and custom discounts); voided sales excluded. Same base
    as the current Dashboard tile.
  - Diners never see it — it is not on the receipt and not part of the sale.
  - Counted across the whole install, per calendar month (Asia/Manila business date).
  - The tablet sends **one number per day** (that day's net sales, from the Z-reading) in the
    heartbeat (§7a). You invoice monthly from My Customers.
  - Paid by **manual GCash / bank transfer**; you mark invoices paid by hand in My Customers.
    Payment gateway (PayMongo/Xendit) deferred.
  - **Non-payment or no reporting = warnings only.** Owner sees a Dashboard banner; nothing is
    restricted. Consequence to accept: the fee is collected on trust and relationship —
    the software gives you visibility, not leverage.
  - Code change (Phase 1): `TECH_FEE_RATE` 0.03 → 0.02 and the Dashboard headline from
    calendar-year-to-date to **current month** ([dashboard/page.tsx:20](src/app/dashboard/page.tsx#L20));
    update the fee check in `verify-safeguards.mjs` to match.
  - **Tampering:** the fee base comes from data on the store's own tablet, so it can't be made
    tamper-proof offline. What makes it hard to fake: the daily close (§10, Phase 3) — a
    running total that only goes up, each day chained to the previous one. The daily totals you
    receive must add up to its movement, and a gap or rewind shows in My Customers.
- **Never block access to existing data.** An expired or missing license must still allow
  sign-in, viewing orders, reports, daily closes and backups. What it restricts:
  - **No license / trial:** app runs in training mode (already exists: watermark, demo data
    allowed). Training mode can only be turned off when a valid license is present.
  - **Maintenance expired:** app keeps working; the updater refuses newer versions.

### License file
JSON payload + Ed25519 signature, e.g.:
```json
{
  "licenseId": "LIC-2026-0042",
  "licensee": { "businessName": "…", "city": "…" },
  "installId": "0199…",               // from 6.6
  "device": "sha256(ANDROID_ID + appId)",
  "plan": "standard",
  "issuedAt": "2026-10-01",
  "updatesUntil": "2027-10-01",
  "maxVersion": null
}
```
- **Device ID:** Android's `ANDROID_ID` (via `@capacitor/device` `getId()`). Since Android 8 it
  is unique per app-signing key and device, survives app reinstall, and changes on factory
  reset — which is exactly when re-activation should happen.
- Private key: only on the licensing server (Cloudflare Worker secret). Public key: bundled in
  the app.
- Verification in the app with an audited library (`@noble/curves` Ed25519). A decompiled APK
  can be patched either way; the license exists to keep honest customers honest, tie support
  to a record, and gate updates — not to stop crackers.
- Stored in the app's private storage **and** embedded in every backup so restoring onto a
  replacement tablet prompts for re-activation instead of silently failing.

### Activation flow
1. Customer (or you, on-site) enters license key `XXXX-XXXX-XXXX-XXXX`.
2. App sends `{ key, installId, device }` to `https://license.<yourdomain>/activate`.
3. Worker checks key in D1, checks activation count (e.g. 1 active tablet, 2 transfers/year),
   returns signed license file.
4. **Offline fallback:** app shows an activation code as a QR code; you scan it with your phone
   on the admin page and show back a QR response that the tablet camera reads (or type a short
   code).

### Server (build, don't buy — you already have Cloudflare)
- One Worker + one D1 database: tables `licenses`, `activations`, `events`.
- Endpoints: `POST /activate`, `POST /deactivate` (tablet transfer), `GET /update-check`
  (returns latest version only if `updatesUntil` covers it), admin page behind a password (or Cloudflare Access).
- Few hundred lines. Keygen.sh / Cryptolens do the same for a monthly fee.

### Don't
- Don't phone home on every launch — shops lose internet; offline verification is the point.
- Don't obfuscate heavily or fight crackers.

---

## 7a. Vendor dashboard — "My Customers" (your super admin)

**Two different "super admins" — don't mix them:**

| | Store owner (`superadmin` role, exists today) | **You, the vendor** (new) |
|---|---|---|
| Lives in | Each customer's POS@034 tablet | The licensing Worker's admin web app |
| Sees | That one store's sales, staff, menu | Every install: license, version, health, fee totals |
| Signs in with | 6-digit PIN on the tablet | Your dashboard password (or Cloudflare Access) |
| Can see sales detail | Yes, their own | **No** — one daily total for the fee, nothing else |

The vendor dashboard is part of the licensing server (§7), not the POS app.

### Layout (design reference: WPMU DEV Hub "My Sites")
Card on a dark background, title **My Customers**, filter tabs, one row per install:

```
My Customers
[All 12] [Updates 4] [Licenses] [Backups] [Fees] [Offline]      [Search…]  [+ New license]
──────────────────────────────────────────────────────────────────────────────────────────
 (K) KRAMGEN · Bacolod        v1.2.0  1⬇   ● Licensed    ☁ Today     ₱1,240 due   ✓   ⋯
 (M) Mang Inasal Rd · Iloilo  v1.3.0       ● Licensed    ☁ 3d ago    ₱0           !   ⋯
 (A) Aling Nena · Cebu        v1.1.4  2⬇   ● Expires 14d ☁ Today     ₱860 due     ✓   ⋯
```

| Column / icon | Meaning | Green / amber / red |
|---|---|---|
| Avatar | First letter of business name, colored per customer | — |
| Name | Business name + city (from license) | — |
| Version + `n ⬇` | Installed version; updates behind | 0 behind / 1–2 / 3+ |
| License | Status + maintenance expiry | active / expires ≤30 days / expired or revoked |
| Backup | Last successful cloud backup | today / 2–3 days / older |
| Fees | This month's accrued 2% + unpaid balance | paid / due / overdue or gaps |
| Health | Last seen (heartbeat) + error count + printer status | seen ≤24 h / ≤7 d / older or errors |
| `⋯` menu | Detail, reissue license, deactivate tablet, revoke, extend maintenance, mark paid, notes | — |

**Tabs:** All · Updates · Licenses · Backups · Fees · Offline (not seen 7+ days). Row click →
detail page: license history, activations/tablets, version history, heartbeat log, per-day net
totals, invoices + payments (GCash/bank ref no.), gap warnings, support notes.

### Where the data comes from
- **Activation** (§7) creates the row: licenseId, business name, city, installId, device hash.
- **Heartbeat:** the tablet sends a small ping at launch and once a day *when online* (fails
  silently offline, retried next time):
  ```json
  { "installId": "…", "licenseId": "…", "appVersion": "1.2.0",
    "lastBackupAt": "2026-10-03T23:59:02+08:00", "lastZReadAt": "…",
    "errorCount24h": 0, "printerOk": true,
    "os": "Android 14", "model": "Samsung SM-X210",
    "dailyNet": [ { "date": "2026-10-03", "netCents": 1843550,
                    "zNo": 212, "grandTotalCents": 912345600, "zHash": "…" } ] }
  ```
  `dailyNet` carries every day not yet acknowledged by the server, so a tablet that was offline
  for a week catches up in one ping.
- **Sent for billing:** one net-sales total per day, plus the Z number, grand total and Z hash
  so the totals can be checked for gaps. **Never sent in readable form:** line items, receipts,
  menu, staff names, PIN hashes, SC/PWD IDs. The heartbeat has **no off switch** because it
  carries billing data — the EULA states exactly what it sends and why.
- Treat daily revenue as business-confidential: HTTPS only, admin behind a password or Access.

### Build notes
- Same Worker + D1 as licensing; tables `heartbeats`, `daily_net`, `invoices`, `payments`,
  `notes`. UI: server-rendered admin served by the Worker, behind a password or Access.
- Endpoints: `POST /heartbeat`, `POST /backup` (encrypted blob → Workers KV), `GET /admin/customers`,
  `GET /admin/customers/:id`, admin actions.
- Build it in Phase 3 alongside licensing — KRAMGEN is the first row.

---

## 8. Android packaging (Capacitor 8)

| Step | Action | Notes |
|---|---|---|
| 8.1 | Add Capacitor: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`; `capacitor.config.ts` with `webDir: "out"`; `npx cap add android` → `android/` folder | Next config stays `output: 'export'` |
| 8.2 | **Application ID** `ph.<you>.pos034` — **frozen forever** | Decides the data sandbox and update identity |
| 8.3 | Keep `server.androidScheme: "https"` and `hostname: "localhost"` (the defaults) — **frozen forever**. The origin decides where WebView storage lives, and `https://localhost` is a secure context, which `crypto.ts` needs for PIN hashing | Never point `hostname` at a real domain |
| 8.4 | Storage: `@capacitor-community/sqlite` as the Android implementation of the storage seam (6.10). WAL mode. Web demo keeps IndexedDB | No IndexedDB→SQLite migration: KRAMGEN starts fresh |
| 8.5 | Printing: Bluetooth ESC/POS via `capacitor-thermal-printer` (or `@capacitor-community/bluetooth-le` + an ESC/POS encoder). Receipt layout for 58 mm (32 chars) and 80 mm (48 chars). Pair in the setup wizard, reconnect automatically, show printer status in the topbar, reprint last receipt. Android 12+ `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` permissions | Test with the exact printer models you'll recommend |
| 8.6 | Tablet behaviour: landscape lock, keep screen awake while signed in, immersive full-screen, handle app pause/resume (lock the till on resume after N minutes). Recommend Android **screen pinning** so staff can't leave the app | `@capacitor/app`, `@capacitor/screen-orientation`, a keep-awake plugin |
| 8.7 | **Backups (three layers):** (1) daily `VACUUM INTO` copy inside the app sandbox; (2) **automatic encrypted cloud backup** — daily, when online, JSON snapshot encrypted on the tablet with a key derived from the recovery code (AES-GCM via Web Crypto), uploaded to R2 through the Worker; you store ciphertext you cannot read; keep last 30 days + month-ends; (3) manual "Export backup" to a user-picked location or the Share sheet (Google Drive, USB, email) | Restore on a new tablet: install → activate → enter recovery code → pick a backup |
| 8.8 | Device ID via `@capacitor/device`; app version via `@capacitor/app` | For license + heartbeat |
| 8.9 | **APK signing key** (Android keystore) — mandatory, free. **Back it up in two offline places.** Losing it means you can never ship an update to installed tablets; customers would have to uninstall (deleting local data) and reinstall | Replaces Windows code signing entirely |
| 8.10 | **Android developer verification.** Google now requires apps on certified devices to come from registered developers — Brazil, Indonesia, Singapore, Thailand from 30 Sep 2026, **globally in 2027**. Register in the Android Developer Console (a limited-distribution account fits word-of-mouth sales) before it reaches the Philippines, or your sideloaded APK stops installing | Check status each quarter |
| 8.11 | Minimum Android version: **Android 10+** (test matrix stays small); keep "Android System WebView" updating via Play Store | — |

---

## 9. Updates and releases

Two layers:

1. **Web-layer live updates** (most releases: screens, logic, reports, discount-rule changes):
   `@capgo/capacitor-updater`, **self-hosted**. The bundle zip + checksum sits in R2 and is
   served through the license Worker, so maintenance entitlement is enforced. Automatic
   rollback if a new bundle fails to start.
2. **Native APK updates** (only when Capacitor, plugins or Android permissions change): the app
   downloads the signed APK from R2 and hands it to Android's installer (`REQUEST_INSTALL_PACKAGES`),
   or you install it on-site. Same signing key (8.9) every time, or the update is rejected.

Rules:
- **Never update mid-shift.** Check at launch; apply only when there are no open orders, or at
  close after the daily close. Take a backup first.
- Channels: `stable` for customers, `beta` for KRAMGEN (customer #1 runs every release for a
  week first).
- CI: GitHub Actions on tag `v*`: `npm ci` → `npm run check` → `next build` → `cap sync` →
  Gradle `assembleRelease` → sign (keystore from GitHub secrets) → upload APK + web bundle +
  manifest to R2.
- Migration test in CI: previous release + fixture data → upgrade → all orders, totals, invoice
  sequences and users intact.
- Google Play Store: not for now. Revisit when customers want to self-install; check Google's
  payments policy against the license + 2% fee model first.

---

## 10. Scope: a sales tracker, not a BIR machine (decided 2026-09-25)

POS@034 keeps **accurate sales, inventory and staff records**. It is **not** a BIR-registered
POS and does not issue receipts or invoices. BIR invoicing stays with the business owner — for
example the booklet sales invoices many small restaurants already use.

What that means in the product:
- The printout is an **order slip**, always marked *"This is not an official receipt or
  invoice"*. No TIN, no BIR branch code, no MIN or AC number anywhere.
- No BIR supplier enrolment (eACCReg), no machine registration at installs, no BIR reports.
  The former Phase 4 is dropped.
- **Kept, because accurate data needs them:** void-never-delete, gapless order numbers, who did
  what on every sale, totals frozen at payment, backups — and the Senior/PWD discount rules
  (RA 9994 / RA 10754 / RR 7-2010), which bind every restaurant regardless of its POS.
- **A daily close** (Phase 3): an end-of-day summary with a running total that only goes up and
  each day chained to the previous one. It serves the owner's own end-of-day count and is what
  the daily fee totals are checked against — not a BIR Z-reading.
- Marketing must never say "BIR-ready" or "BIR-accredited".

If customers later ask for a BIR-registered POS, the old plan (git history, `REWORK-PLAN.md` at
commit `11eb687`, §10) lists what it would take.

---

## 11. Install kit and support

- **Install checklist** (you, on-site): unbox tablet → update Android → install APK → setup
  wizard → pair printer + test print → activate license → print recovery code → load menu
  (template or CSV import) → add staff → turn on screen pinning → train staff in training mode
  → turn off training mode after the AC is issued.
- **Menu CSV import** — setting up 80 items by hand on a tablet is where installs stall.
- **Support bundle:** Settings → "Export support file" = app version, installId, license ID,
  tablet model, last 500 audit entries, error log. **Never** PIN hashes, never SC/PWD IDs.
- **Remote support:** AnyDesk or RustDesk for Android. If you ever view customer data, you
  become a personal information processor under the Data Privacy Act (RA 10173) — put a
  data-processing clause in the EULA (it also covers the encrypted backups you store).
- **Hardware recommendation sheet** (test before recommending any model):
  - Tablet: 10–11", Android 10+, 4 GB RAM, 64 GB storage (e.g. Samsung Galaxy Tab A-series,
    Lenovo Tab M-series). Avoid no-name tablets — WebView updates and Bluetooth quality vary.
  - Printer: 58 mm (or 80 mm) Bluetooth ESC/POS thermal printer. Test 2–3 common models and
    list only those.
  - Tablet stand/enclosure, charger kept plugged in, optional cash drawer on a printer with a
    drawer port.
- **Tablet replacement:** new tablet → install → deactivate old tablet in My Customers →
  activate → recovery code → restore latest cloud backup.

---

## 12. Roadmap — ordered steps

Each phase ends with a verifiable check. Don't start a phase until the previous one passes.

### Phase 0 — Decisions (done, except the tax practitioner)
- [x] Product name: **POS@034**, slug `pos034`, application ID `ph.<you>.pos034`
- [x] Pricing: one-time + yearly maintenance + 2% monthly fee on net sales — §7
- [x] Target: **Android tablet + Bluetooth printer**
- [x] Market: restaurants only
- [ ] Buy the test hardware: one recommended tablet + 2–3 Bluetooth printers
- [ ] Talk to a tax practitioner about supplier enrolment and tablet registration — §10

### Phase 1 — Productize the web app — **done 2026-09-25** (branch `phase-1-productize`)
- [x] 6.1–6.8 (brand constant, neutral defaults, wizard, recovery code, one branch, installId, migrations, README)
- [x] 6.9 tablet layout pass (every control ≥ 40 px, measured on every screen at 1280×800; portrait checked)
- [x] Technology fee: 3% → 2%, Dashboard headline = current month (§7)
- [ ] 6.10 platform seams — **moved to the start of Phase 2.** Each seam would have one implementation
  until the Android one exists; drawing the interface when the second implementation arrives
  gets it right the first time instead of guessing now.
- Verified: `npm run check` passes; in a browser at tablet size: wizard → sell → pay → receipt,
  lock → forgot PIN → recovery code → new PIN, old PIN refused. **Still to do by hand:** the same
  run on a real tablet's Chrome.
- Differences from the plan: the recovery code is not rotated automatically after use (it can be
  reissued from Settings). TIN and BIR branch code were later removed entirely (§10).

### Phase 2 — Android app — **built and emulator-tested 2026-09-25** (branch `phase-2-android`)
Verified on an Android 15 tablet emulator (Pixel Tablet, 2560×1600), release APK signed with the
POS@034 key: setup wizard → sale (receipt total correct) → table left open → **force-killed** → both
orders back, app locked → **airplane mode + reboot** → opens offline, both orders intact → automatic
backup written to Documents/POS034 with installId, appVersion and recovery hash → **app uninstalled,
backup file still there** → Bluetooth permission prompt appears; with Bluetooth off the printer says so.
Still open: printing on a real printer; restoring that backup onto a fresh install via Settings →
Restore (do by hand); the Vitest port, proposed for Phase 5.

- [x] 6.10 platform seams (storage, printer, files) in `src/lib`; device ID moves to Phase 3 with licensing
- [ ] 8.1–8.6, 8.8, 8.11 (Capacitor, frozen app ID + origin, SQLite, Bluetooth printing, tablet behaviour)
- [ ] 8.7 layers 1 and 3 (local backup copy, manual export/share)
- [ ] 8.9 signing keystore created and backed up in two offline places
- [ ] Port `scripts/verify-*.mjs` into Vitest; Playwright flows at tablet viewport
- **Verify on the test tablet:** opens in airplane mode; kill the app mid-sale 20× → no lost closed sale; receipt prints on each tested printer; printer off/on mid-shift reconnects; reboot → data intact; reinstall-over-top with the same key → data intact.

### Phase 3 — Licensing, cloud backup, vendor dashboard — **built and tested locally 2026-09-25** (branch `phase-3-licensing`)
- [x] Worker + D1 (`license-server/`); Ed25519 keypair (private key in `~/.pos034/`, becomes a Worker secret); online activation; training mode gated on license. QR offline activation deferred until a customer needs it
- [x] 8.7 layer 2: encrypted cloud backup to Workers KV (free, no card) + restore-on-new-tablet flow in the setup wizard
- [x] Daily close (§10): windows follow the clock `[previous close, now)`, voids of closed days carried forward, hash-chained; auto at 23:59 / next launch, manual + printable on the Dashboard
- [x] Vendor dashboard "My Customers" + heartbeat (§7a); fees by month, payments, release/revoke/extend
- [x] Fee rules: training closes never billed; closes deduplicated by id across replacement tablets; first reported close anchors the chain
- Verified: app checks (license forgery, daily close chain, seal/open) and 23 server checks against a local Worker (activation, second-tablet refusal, heartbeat, forged licence, doctored close flagged, no double billing after a tablet swap, backup round trip).
- [x] Deployed 2026-09-25 on Cloudflare's free plan (no card): https://pos034-license.kennkennali.workers.dev — D1 database, KV backups, signing key and dashboard password as Worker secrets (password copy in `~/.pos034/admin-password.txt`)
- Verified live on the emulator: create license → activate → go live → sell → daily close → cloud backup → heartbeat shows tablet, close and 2% fee on the dashboard → app wiped → restored from the cloud with license key + recovery code → old tablet released → re-activated. Test data then deleted from production.
- Found and fixed live: end-of-day jobs ran after the day's first sale instead of at 23:59 (the daily backup had done this since v7).
- **Verify:** tampered license rejected; license from tablet A rejected on tablet B; factory-reset tablet → re-activate + restore works; server-side the backup is unreadable ciphertext; wrong recovery code can't decrypt.

### ~~Phase 4 — BIR features~~ — dropped 2026-09-25
POS@034 is a sales tracker, not a BIR machine (§10). The daily close moved to Phase 3.

### Phase 5 — Release pipeline (1 week)
- [ ] GitHub Actions → signed APK + web bundle → free hosting (KV or GitHub Releases; R2 needs a card); self-hosted live updates via the Worker; beta channel on KRAMGEN
- [ ] 8.10 Android developer verification registered
- **Verify:** tag a release → KRAMGEN's tablet takes the web update at close, with a backup first; a deliberately broken bundle rolls back by itself.

### Phase 6 — Install kit (1 week, parallel with 5)
- [ ] Menu CSV import, support bundle, install checklist, hardware sheet, EULA + privacy notice
- **Verify:** someone other than you sets up a fresh tablet using only the checklist.

### Phase 7 — Go to market
- [ ] Landing page (§14), web demo (training mode only, watermarked) on Cloudflare
- [ ] First 3 pilot customers at a discount, installed by you, weekly check-in for a month

### Later (only when customers ask and pay)
- Waiter tablets sending orders to a counter tablet over Wi-Fi (multi-terminal)
- Optional cloud sync / owner phone dashboard / multi-branch rollup (Option C)
- Windows PC build (Tauri or Electron, same web code)
- All-in-one Android POS terminals with built-in printers (Sunmi, iMin) — vendor print SDKs
- iPad (App Store only, USD 99/yr, review risk) — not planned
- Google Play Store distribution

---

## 13. Decisions

All decided 2026-09-25:

| # | Decision | Answer |
|---|---|---|
| 1 | Product name | **POS@034** (slug `pos034`) |
| 2 | Pricing | **One-time license + optional yearly maintenance + 2% technology fee on net sales** (§7) |
| 3 | Fee payer / base / billing | Store owes it · net sales · **monthly** |
| 4 | Fee reporting | Automatic daily net total in the heartbeat (§7a) |
| 5 | Non-payment | **Warnings only** — nothing restricted |
| 6 | Collection | **Manual GCash / bank transfer**, marked paid by hand; gateway later |
| 7 | Market | **Restaurants only** at launch |
| 8 | KRAMGEN | **Customer #1 / pilot; practice data only** — starts fresh via the setup wizard |
| 9 | Hosted Cloudflare URL | **Becomes the demo** (training mode forced, watermarked) |
| 10 | Target device | **Android tablet** (was Windows PC) |
| 11 | Hardware | **Regular Android tablet + Bluetooth thermal printer** |
| 12 | App shell | **Capacitor 8** (was Tauri 2 — Tauri's mobile support is too new for a POS) |
| 13 | Distribution | **You install the APK yourself** (word-of-mouth sales); no Play Store for now; Windows code signing no longer applies |
| 14 | BIR | **Not a BIR machine.** A sales and inventory tracker; prints order slips marked not an official receipt; the owner handles BIR invoicing. No TIN or branch code in the app; Phase 4 dropped (§10) |

Still open: nothing blocking.

---

## 14. Landing page — outline and copy

Target reader: owner of a small Philippine restaurant/carinderia, not technical, price-
sensitive, burned before by internet outages and by POS vendors with monthly fees. Write plain
English (Taglish touches optional). **Only publish claims that are true on launch day.** Never
say "BIR-ready" or "BIR-accredited": POS@034 is not a BIR machine (§10).

Stack: Astro static page on Cloudflare (see TECH-STACK.md), reusing the POS colors (`#f0ede9`
ground, `#080808` rail, `#ff5c1a` accent).

### Structure

1. **Nav** — logo · Features · Pricing · FAQ · [Try the demo] (button)
2. **Hero**
   - H1: **The tablet POS that keeps selling when the internet doesn't.**
   - Sub: POS@034 runs on an Android tablet at your counter. Every sale is saved the moment it
     happens and backed up automatically — no cloud subscription, no signal needed.
   - CTA primary: **Book a free demo** · secondary: **Try it in your browser**
   - Visual: photo of the tablet on a stand next to a receipt printer, POS floor on screen
3. **Problem strip** (3 short cards)
   - "Internet down? Lunch rush doesn't care." — cloud POS stops; POS@034 doesn't.
   - "₱90 overcharged on a ₱500 senior bill." — many tills apply VAT *after* the 20% discount.
   - "Where did that sale go?" — deleted sales and shared logins make shortages impossible to trace.
4. **Features** (grid of 6, icon + headline + one line)
   - **Works 100% offline** — Sales, reports and receipts run on the tablet. Internet is optional.
   - **Senior & PWD done right** — VAT removed first, 20% off the VAT-exclusive price, ID recorded, shared bills split per RR 7-2010.
   - **Staff PINs, not shared passwords** — Owner, waiter and purchaser roles. Every sale shows who opened it, served it, took the money — and who voided it.
   - **Nothing gets deleted** — Sales are voided with a reason, never erased. Stock comes back automatically.
   - **Split payments** — Cash, GCash, Maya, card and bank in one bill, with reference numbers for end-of-day checking.
   - **Lost the tablet? Not the books.** — Encrypted backup every night. New tablet, your recovery code, and your sales are back.
5. **Deep-dive: "Built for how Philippine restaurants actually run"** (alternating image/text rows)
   - Dine-in, takeout, GrabFood, FoodPanda orders side by side
   - Bluetooth receipt printer — no cables across the counter
   - Inventory that flags oversells instead of hiding them
   - Dashboard: today's net, best sellers, gross profit with cost frozen at time of sale
   - Daily close: every day's total, locked so it can't be quietly changed later
6. **How it works** (3 steps)
   1. **We set it up** — tablet, printer, your menu and your staff.
   2. **Train in practice mode** — ring up fake orders until everyone's comfortable.
   3. **Go live** — switch practice mode off and start selling.
7. **Pricing** (2–3 cards; numbers are yours to set)
   - **Starter** — one-time license, 1 tablet, 1 year updates & support
   - **Standard** — + on-site setup, menu entry, staff training, printer pairing
   - **Bundle (optional)** — license + tested tablet + printer, ready to sell
   - **Renewal** — yearly updates & support (optional; the app keeps working without it)
   - **Technology fee** — 2% of net sales, billed monthly. State it plainly on the card; a
     fee discovered after purchase kills word-of-mouth.
   - Line under cards: *No cloud subscription. Your sales stay on your tablet.*
8. **Trust / proof** — pilot-customer quote with photo + business name (with permission);
   "Used daily at KRAMGEN, Bacolod" once KRAMGEN is live and agrees to be named.
9. **FAQ**
   - *Do I need internet?* No. Only to activate, back up and get updates — and those wait until you're back online.
   - *What tablet do I need?* A 10–11" Android tablet (Android 10 or newer) and a Bluetooth receipt printer. We list tested models, or sell you a ready bundle.
   - *What if the tablet breaks or gets stolen?* Get a new one, enter your recovery code, and last night's backup comes back.
   - *Can I use it on more than one tablet?* Each tablet needs its own license. Waiter tablets and multi-branch sync are on the roadmap.
   - *Does it replace my BIR invoices?* No. POS@034 keeps your sales, stock and staff records accurate. Keep issuing your own BIR invoices; the order slip says it is not an official receipt.
   - *What happens if I stop paying for updates?* Nothing breaks. You keep using your version.
   - *Who can see my sales?* Only you. For the technology fee we receive one number per day —
     your total net sales. Backups are encrypted with your recovery code; we can't open them.
   - *How is the 2% fee billed?* Monthly, on net sales after senior/PWD discounts. Voided sales
     are never charged. Pay by GCash or bank transfer.
10. **Final CTA** — "Book a free 15-minute demo" + Messenger/Viber/WhatsApp buttons + phone number.
11. **Footer** — business name, DTI/SEC reg. no., TIN, address, EULA, privacy notice, support contact.

### Landing page checklist
- [ ] Mobile-first (owners will open it from Facebook on a phone)
- [ ] Real photos of the tablet + printer, real screenshots
- [ ] Demo link opens the watermarked training-mode web build
- [ ] Messenger link — most leads will come from a Facebook page
- [ ] No "BIR-ready" or "BIR-accredited" wording; no invented testimonials

---

## 15. Sources

- Capacitor + Next.js static export: https://capgo.app/blog/nextjs-mobile-app-capacitor-from-scratch/
- Capacitor storage guide: https://capacitorjs.com/docs/guides/storage
- SQLite plugin (v8): https://github.com/capacitor-community/sqlite
- Bluetooth ESC/POS printing plugin: https://github.com/Malik12tree/capacitor-thermal-printer
- ESC/POS Android library (Bluetooth/TCP/USB): https://github.com/DantSu/ESCPOS-ThermalPrinter-Android
- Self-hosted live updates: https://github.com/Cap-go/capacitor-updater , https://capgo.app/docs/plugins/updater/self-hosted/getting-started/
- Android developer verification: https://developer.android.com/developer-verification , https://android-developers.googleblog.com/2026/06/android-developer-verification.html
- Offline licensing (Ed25519): https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/ , https://dev.to/nicodemanez/how-offline-license-activation-actually-works-2paa
- RMC 5-2021: https://www.grantthornton.com.ph/globalassets/1.-member-firms/philippines/tax-alerts/2021/01.13.2021/rmc-no.-5-2021.pdf
- RMO 9-2021: https://www.grantthornton.com.ph/globalassets/1.-member-firms/philippines/tax-alerts/2021/03.02.2021/rmo-no.-9-2021.pdf
- BIR POS requirements summary (secondary source): https://orkids.ph/guides/bir-accredited-pos
- BIR POS/web platform registration (secondary): https://www.respicio.ph/commentaries/bir-registration-requirements-for-pos-systems-and-web-based-sales-platforms
