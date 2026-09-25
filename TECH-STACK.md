# POS@034 — Technology stack

Status: **proposed, living document.** Written 2026-09-25; target switched to **Android
tablets** the same day. Expect entries to move between Keep / Rework / Remove as the rework
goes on. When a decision changes, edit the table and add a line to the change log at the
bottom. Don't leave stale rows.

Companion to [REWORK-PLAN.md](REWORK-PLAN.md), which covers the *why* and the phase order.
This file covers *what we build with*.

---

## Principle

**Re-platform, don't re-write.** The app layer already handles the hard parts correctly:
integer centavos, the RR 7-2010 tax engine, void-never-delete, gapless invoices and PIN
hashing, with 200+ checks proving it. We keep that layer, put it in an Android app shell,
give it a durable database and a receipt printer, and add a licensing server and vendor
dashboard.

---

## System overview

```
┌──────────── Store counter (one per store) ───────────────────────────────┐
│  Android tablet — POS@034 app (Capacitor 8)                               │
│   ├─ UI: React 19 + TypeScript + Tailwind 4 (Next.js static export)       │
│   ├─ State: zustand (all mutations)                                       │
│   ├─ Platform seams (src/platform/*): storage · printing · backup · device│
│   │    Android: SQLite · Bluetooth ESC/POS · encrypted backup · ANDROID_ID│
│   │    Web demo: IndexedDB · browser print · file download                │
│   └─ Live updater (self-hosted) for the web layer                         │
│        │ Bluetooth                                                        │
│        ▼                                                                  │
│  58/80 mm thermal receipt printer                                         │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ HTTPS, when online: activate · heartbeat (daily net) · encrypted backup · updates
┌──────────────▼──────────── Cloudflare (your account) ────────────────────┐
│  License Worker (Hono) + D1  → licenses, activations, heartbeats, fees    │
│  Vendor dashboard "My Customers" (behind Cloudflare Access)               │
│  R2                           → APKs, web bundles, encrypted backups      │
│  Static sites                 → landing page (Astro) · web demo           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 1. POS@034 app (web layer, shared by Android and the demo)

| Layer | Choice | Status | Why | Rejected |
|---|---|---|---|---|
| Language | **TypeScript 5 (strict)** | Keep | Type-safe money (`Centavos` branded type), already written | — |
| UI | **React 19** | Keep | Already written; biggest help/hiring pool | Flutter / React Native rewrite: months lost, tax engine re-done |
| Framework | **Next.js 15, `output: 'export'`** | Keep, **review** | Produces the static bundle Capacitor loads (`webDir: "out"`). No server code, so a move to **Vite** later is mechanical if Next's upgrade churn costs time | Next server features: nothing to render server-side |
| State | **zustand 5** | Keep | Small, holds every mutation in one store | Redux: more code, same result |
| Styling | **Tailwind CSS 4** | Keep, **rework** layouts | Tablet layout pass: 10–11" landscape, ≥44 px touch targets, no hover-only controls | — |
| Icons / classes | **lucide-react**, **clsx** | Keep | In place | — |
| Money / tax | `src/lib/money.ts`, `src/lib/tax.ts` | Keep, unchanged | Correct and tested | — |
| Auth | Local 6-digit PIN, PBKDF2 via Web Crypto | Keep, **rework** | Right model per store; keypad already touch-first. Rework: first-run wizard replaces the shipped `000000`, add a recovery code | Online accounts / OAuth |
| Platform seams | **`src/platform/*`**: storage, printing, backup, device ID, file export — one interface each, web + Android implementations | **Add** | Components never call Capacitor directly; the demo and the app share every screen | Sprinkling `Capacitor.isNativePlatform()` through components |
| License verify | **`@noble/curves`** (Ed25519) | **Add** | Audited, tiny, no native code | Hand-rolled crypto |
| Backup encryption | **Web Crypto**: PBKDF2 (recovery code) → AES-GCM | **Add** | Built in; you store ciphertext you can't read | — |

## 2. Android app shell

| Piece | Choice | Status | Notes |
|---|---|---|---|
| Shell | **Capacitor 8** (`@capacitor/core`, `cli`, `android`) | **Add** — decided | Mature on Android; Tauri 2 mobile rejected as too new; Flutter/React Native rejected (rewrite) |
| Application ID | `ph.<you>.pos034` | **Add** | **Frozen forever** |
| Web origin | `androidScheme: "https"`, `hostname: "localhost"` (defaults) | **Add** | **Frozen forever**: decides where WebView storage lives; secure context for `crypto.subtle` |
| Database | **`@capacitor-community/sqlite`** (v8), WAL | **Add** | Android storage implementation; SQLCipher encryption available if needed |
| Printing | **`capacitor-thermal-printer`** (Bluetooth ESC/POS), fallback `@capacitor-community/bluetooth-le` + ESC/POS encoder | **Add** | Test against the exact printers you recommend; 58 mm and 80 mm layouts |
| Device / app info | `@capacitor/device` (`ANDROID_ID`), `@capacitor/app` | **Add** | License binding, heartbeat, pause/resume lock |
| Files / sharing | `@capacitor/filesystem`, `@capacitor/share` | **Add** | Manual backup export to Drive / USB / email |
| Tablet behaviour | `@capacitor/screen-orientation`, a keep-awake plugin, status bar / immersive | **Add** | Landscape, screen stays on while signed in |
| Live updates | **`@capgo/capacitor-updater`**, self-hosted | **Add** | Web-layer updates from R2 via the Worker; auto-rollback on a bad bundle |
| APK updates | Download from R2 + Android installer intent (`REQUEST_INSTALL_PACKAGES`) | **Add** | Only when native parts change |
| Min Android | **10+** | Decided | Small test matrix |
| Signing | Android keystore (APK signing key) | **Add** | Mandatory, free. **Back up in two offline places**: losing it = no updates ever again |
| Developer verification | Android Developer Console (limited-distribution account) | **Add** before 2027 | Google's rule reaches all countries in 2027; unregistered sideloaded apps stop installing |
| Distribution | APK installed by you | Decided | Play Store later, if ever |

## 3. Licensing server + vendor dashboard (yours)

| Piece | Choice | Status | Notes |
|---|---|---|---|
| Runtime | **Cloudflare Workers** | **Add** | Account already exists (`wrangler.jsonc`) |
| Router | **Hono** | **Add** | Small, typed, made for Workers |
| Database | **Cloudflare D1** (SQLite) | **Add** | `licenses`, `activations`, `heartbeats`, `daily_net`, `invoices`, `payments`, `notes`, `backups` (metadata only) |
| Object storage | **Cloudflare R2** | **Add** | APKs, web bundles, encrypted backups (30 days + month-ends per install) |
| Signing | Ed25519 private key in Worker secrets | **Add** | Never leaves Cloudflare |
| Admin auth | **Cloudflare Access** (email OTP / Google) | **Add** | Only you can open the dashboard |
| Dashboard UI | React + Tailwind (or Hono JSX), served by the Worker | **Add** | "My Customers", WPMU DEV–style (plan §7a) |
| Payments | Manual GCash / bank transfer, marked paid by hand | Decided | PayMongo / Xendit later |

## 4. Websites

| Piece | Choice | Status | Notes |
|---|---|---|---|
| Landing page | **Astro** (static) + Tailwind on Cloudflare | **Add** | Mobile-first; copy in plan §14 |
| Web demo | Current Next.js build on Cloudflare, training mode forced, watermarked, web platform seams | **Rework** | The existing public URL becomes the demo |

## 5. Quality and delivery

| Piece | Choice | Status | Notes |
|---|---|---|---|
| Typecheck / lint | `tsc --noEmit`, ESLint 9 + `eslint-config-next` | Keep | |
| Domain checks | `scripts/verify-*.mjs` (tax, auth, demo, safeguards) | **Rework** → Vitest | Port them; keep every assertion. Add `verify:bir`, `verify:migrate` |
| Unit tests | **Vitest** | **Add** | |
| End-to-end | **Playwright** at tablet viewports (1280×800, 1920×1200) | **Add** | Wizard, sell, void, Z-read, backup/restore |
| Device testing | Real test tablet + 2–3 Bluetooth printers | **Add** | Emulators can't test Bluetooth printing |
| CI/CD | **GitHub Actions** (`ubuntu-latest` + Android SDK + JDK 21) | **Add** | check → `next build` → `cap sync` → Gradle release → sign → R2 |
| Logs | Rotating local log + "Export support file" | **Add** | Works offline; no customer data |
| Error reporting | Optional opt-in Sentry | Later | Off by default |

---

## Remove / retire

| Item | Where | Why | When |
|---|---|---|---|
| Shipped superadmin PIN `000000` (`DEFAULT_SUPERADMIN`, `DEFAULT_PIN_CREDENTIAL`, `hasDefaultPin`) | `src/lib/seed.ts` | Every customer would share one published credential | Phase 1 |
| `DefaultPinBar` + the "000000 can never be set again" rule | `src/components/layout/`, `usePos.ts` | Only exist because of the shipped PIN | Phase 1 |
| KRAMGEN branding, Bacolod address, carinderia menu as defaults | `src/lib/seed.ts`, 9 files with `KRAMGEN` | KRAMGEN is customer #1, not the product. Menu becomes an optional template | Phase 1 |
| Storage keys `kramgen` / `kramgen-pos-v7` | `idb.ts`, `usePos.ts` | Renamed to `pos034` / `pos034-v7`; KRAMGEN has practice data only | Phase 1 |
| "Add branch" on a single install | `BranchManager.tsx` | One install = one branch | Phase 1 |
| Tech fee 3% / yearly | `src/app/dashboard/page.tsx` | Now 2% of net, monthly | Phase 1 |
| Desktop-only layout assumptions (hover, small targets, fixed rail) | `components/layout`, `components/pos` | Tablet is the main device | Phase 1 |
| Direct `idb.ts` use from the store | `usePos.ts` | Goes through the storage seam; IndexedDB stays only for the web demo | Phase 1–2 |
| Browser print as the receipt path | `Receipt.tsx` | Bluetooth ESC/POS on Android; browser print only in the demo | Phase 2 |
| Browser-download backups | `backup.ts`, `archive.ts` | Replaced by local copy + encrypted cloud + share; download only in the demo | Phase 2–3 |
| `wrangler.jsonc` deploying the full app as the product | repo root | Repurposed to deploy the demo only | Phase 7 |
| `scripts/migrate-v6.mjs` | `scripts/` | v6 → v7 converter for the old single-file build; no POS@034 customer has v6 data | Decide in Phase 1 |
| ~~Tauri 2 desktop shell, Windows code signing, NSIS installer~~ | — | Dropped when the target became Android tablets. Windows can return later (Tauri or Electron) | — |

---

## Target repository layout

```
/                      POS@034 web app (Next.js static export) — src/, scripts/ as today
/src/platform/         storage · printing · backup · device seams (web + android implementations)
/android/              Capacitor-generated Android project (committed)
/capacitor.config.ts   app ID, webDir, frozen scheme/hostname
/license-server/       Cloudflare Worker: Hono + D1 + R2 + vendor dashboard
/site/                 Astro landing page
/.github/workflows/    CI: check, build signed APK + web bundle, publish
REWORK-PLAN.md         why + phases
TECH-STACK.md          this file
```

---

## Change log

| Date | Change |
|---|---|
| 2026-09-25 | First version: Tauri 2 desktop (Windows), SQLite target, Cloudflare Workers + Hono + D1 licensing, Astro landing page, manual GCash/bank payments |
| 2026-09-25 | **Target switched to Android tablet + Bluetooth printer.** Tauri 2 → Capacitor 8; Rust dropped; SQLite via `@capacitor-community/sqlite` from the first Android build (no IndexedDB migration); Bluetooth ESC/POS printing made required; encrypted cloud backup to R2 added; self-hosted live updates; APK signing + Android developer verification replace Windows code signing; platform seams added so the web demo and the app share every screen |
