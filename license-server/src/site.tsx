/**
 * The public website: what POS@034 does, sign-up, and a customer's account
 * page with their license key and the Android app download. Server-rendered
 * HTML with plain forms, like the dashboard.
 */

import { Hono, type Context } from 'hono';
import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';

import { currentAccount, endSession, hashPassword, passwordMatches, sha256, startSession, type Account } from './accounts';
import type { Env } from './env';
import { FEE_RATE, feeSummary, peso } from './fees';

type Ctx = Context<{ Bindings: Env }>;

/** The web demo: training mode only, nothing leaves the browser. */
const DEMO_URL = 'https://pos.kennkennali.workers.dev';
/** Where the release pipeline puts the signed APK (scripts/publish-apk.mjs). */
export const APK_KEY = 'android/pos034.apk';
export interface ApkMeta {
  version: string;
  size: number;
  uploaded: number;
}

const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60_000;

const site = new Hono<{ Bindings: Env }>();

// ── Landing page ─────────────────────────────────────────────────────────

const FEATURES: [string, string][] = [
  ['Works offline', 'Sales, reports and order slips run on the tablet. The internet is only for backups and updates, and those wait until you are back online.'],
  ['Senior & PWD done right', 'VAT removed first, then 20% off the VAT-exclusive price, the ID recorded, and shared bills split per diner.'],
  ['Staff PINs', 'Owner, waiter and purchaser roles. Every sale shows who opened it, who took the money, and who voided it.'],
  ['Nothing gets deleted', 'Sales are voided with a reason, never erased, and the stock comes back by itself.'],
  ['Split payments', 'Cash, GCash, Maya, card and bank on one bill, with reference numbers for checking at the end of the day.'],
  ['Lost the tablet, not the books', 'An encrypted backup every night. On a new tablet, your recovery code brings your sales back.'],
  ['Dine-in, takeout, GrabFood, FoodPanda', 'All order types side by side, printed to a Bluetooth receipt printer.'],
  ['Daily close', 'Every day\'s totals locked at 23:59, chained so a day cannot be quietly changed later.'],
];

const FAQ: [string, string][] = [
  ['Do I need internet?', 'No. Only to activate, back up and get updates, and those wait until you are back online.'],
  ['What do I need?', 'A 10–11" Android tablet (Android 10 or newer) and a Bluetooth thermal receipt printer.'],
  ['What if the tablet breaks or gets stolen?', 'Get a new one, install the app, and restore last night\'s backup with your license key and recovery code. We move your license to the new tablet.'],
  ['Does it replace my BIR invoices?', 'No. POS@034 keeps your sales, stock and staff records accurate. Keep issuing your own BIR invoices; the order slip says it is not an official receipt.'],
  ['Who can see my sales?', 'Only you. For the technology fee the tablet sends each day\'s totals. Your orders, menu and staff stay on the tablet, and backups are encrypted with your recovery code, so we cannot open them.'],
  ['How is the 2% fee billed?', 'Monthly, on net sales after senior and PWD discounts. Voided sales are never charged. Pay by GCash or bank transfer.'],
  ['What if I stop paying for yearly updates?', 'Nothing breaks. You keep using the version you have.'],
];

site.get('/', async (c) => {
  const account = await currentAccount(c);
  return c.html(
    <Layout title="POS@034 — the tablet POS for restaurants" account={account}>
      <section class="hero">
        <h1>The tablet POS that keeps selling when the internet doesn't.</h1>
        <p>POS@034 runs on an Android tablet at your counter. Every sale is saved the moment it happens and backed up every night. No signal needed.</p>
        <div class="ctas">
          <a class="btn" href={account ? '/account' : '/register'}>{account ? 'My account' : 'Register'}</a>
          <a class="btn ghost" href={DEMO_URL}>Try the demo</a>
        </div>
      </section>

      <section id="features">
        <h2>What it does</h2>
        <div class="grid">
          {FEATURES.map(([title, text]) => (
            <div class="tile"><h3>{title}</h3><p>{text}</p></div>
          ))}
        </div>
      </section>

      <section>
        <h2>How it works</h2>
        <ol class="steps">
          <li><b>Register</b> here. We call you to confirm and send your license.</li>
          <li><b>Download the app</b> from your account, on the tablet, and enter your license key.</li>
          <li><b>Practice</b> in training mode until everyone is comfortable, then go live.</li>
        </ol>
      </section>

      <section id="pricing">
        <h2>Pricing</h2>
        <div class="grid">
          <div class="tile"><h3>License</h3><p>One-time, per tablet. Includes a year of updates and support.</p></div>
          <div class="tile"><h3>Yearly updates</h3><p>Optional. The app keeps working without it.</p></div>
          <div class="tile"><h3>Technology fee</h3><p>{FEE_RATE * 100}% of net sales, billed monthly.</p></div>
        </div>
        <p class="muted">No cloud subscription. Your sales stay on your tablet.</p>
      </section>

      <section id="faq">
        <h2>Questions</h2>
        {FAQ.map(([q, a]) => (
          <details><summary>{q}</summary><p>{a}</p></details>
        ))}
      </section>

      <section class="hero end">
        <h2>Ready to try it?</h2>
        <div class="ctas">
          <a class="btn" href="/register">Register</a>
          <a class="btn ghost" href={DEMO_URL}>Try the demo</a>
        </div>
      </section>
    </Layout>,
  );
});

// ── Register and log in ──────────────────────────────────────────────────

const SIGNUP_FIELDS = [
  ['business_name', 'Business name', 'text', 'organization'],
  ['owner_name', 'Your name', 'text', 'name'],
  ['mobile', 'Mobile number', 'tel', 'tel'],
  ['city', 'City', 'text', 'address-level2'],
  ['email', 'Email', 'email', 'email'],
] as const;

type SignupForm = Partial<Record<(typeof SIGNUP_FIELDS)[number][0], string>>;

function RegisterPage({ error, values = {} }: { error?: string; values?: SignupForm }) {
  return (
    <Layout title="Register · POS@034" narrow>
      <h1>Register</h1>
      <p class="muted">For restaurants. We will call you to confirm, then your account can download the app.</p>
      {error && <p class="error">{error}</p>}
      <form method="post" class="stack">
        {SIGNUP_FIELDS.map(([name, label, type, autocomplete]) => (
          <label>{label}<input name={name} type={type} value={values[name] ?? ''} autocomplete={autocomplete} maxlength={100} required /></label>
        ))}
        <label>Password (8 or more characters)<input name="password" type="password" autocomplete="new-password" minlength={8} maxlength={200} required /></label>
        <button class="btn">Register</button>
      </form>
      <p class="muted">Already registered? <a href="/login">Log in</a></p>
    </Layout>
  );
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

site.get('/register', async (c) => ((await currentAccount(c)) ? c.redirect('/account') : c.html(<RegisterPage />)));

site.post('/register', async (c) => {
  const form = await c.req.parseBody();
  const values = Object.fromEntries(SIGNUP_FIELDS.map(([name]) => [name, String(form[name] ?? '').trim().slice(0, 100)])) as Required<SignupForm>;
  values.email = values.email.toLowerCase();
  const password = String(form.password ?? '');

  const error =
    SIGNUP_FIELDS.some(([name]) => !values[name]) ? 'Please fill in every field.'
    : !isEmail(values.email) ? 'That email address does not look right.'
    : password.length < 8 || password.length > 200 ? 'The password needs 8 or more characters.'
    : null;
  if (error) return c.html(<RegisterPage error={error} values={values} />, 400);

  const taken = await c.env.DB.prepare('SELECT 1 FROM accounts WHERE email = ?').bind(values.email).first();
  if (taken) return c.html(<RegisterPage error="That email is already registered. Log in instead." values={values} />, 409);

  const account = await c.env.DB.prepare(
    'INSERT INTO accounts (email, password, owner_name, business_name, mobile, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(values.email, await hashPassword(password), values.owner_name, values.business_name, values.mobile, values.city, Date.now())
    .first<{ id: number }>();
  await startSession(c, account!.id);
  return c.redirect('/account');
});

function LoginPage({ error, email = '' }: { error?: string; email?: string }) {
  return (
    <Layout title="Log in · POS@034" narrow>
      <h1>Log in</h1>
      {error && <p class="error">{error}</p>}
      <form method="post" class="stack">
        <label>Email<input name="email" type="email" value={email} autocomplete="email" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="btn">Log in</button>
      </form>
      <p class="muted">New here? <a href="/register">Register</a>. Forgot your password? Message us and we will send you a reset link.</p>
    </Layout>
  );
}

site.get('/login', async (c) => ((await currentAccount(c)) ? c.redirect('/account') : c.html(<LoginPage />)));

site.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email ?? '').trim().toLowerCase();
  const password = String(form.password ?? '');
  const row = await c.env.DB.prepare('SELECT id, password, failed_logins, locked_until FROM accounts WHERE email = ?')
    .bind(email)
    .first<{ id: number; password: string; failed_logins: number; locked_until: number | null }>();

  const now = Date.now();
  if (row?.locked_until && row.locked_until > now) {
    return c.html(<LoginPage error="Too many wrong passwords. Try again in 15 minutes." email={email} />, 429);
  }
  if (!row || !(await passwordMatches(password, row.password))) {
    if (row) {
      const failed = row.failed_logins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await c.env.DB.prepare('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?')
        .bind(lock ? 0 : failed, lock ? now + LOCK_MS : null, row.id)
        .run();
    }
    return c.html(<LoginPage error="That email and password do not match." email={email} />, 401);
  }
  await c.env.DB.prepare('UPDATE accounts SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(row.id).run();
  await startSession(c, row.id);
  return c.redirect('/account');
});

site.post('/logout', async (c) => {
  await endSession(c);
  return c.redirect('/');
});

// ── Password reset, by a link you send them ──────────────────────────────

const resetAccount = async (c: Ctx) =>
  c.env.DB.prepare('SELECT id FROM accounts WHERE reset_hash = ? AND reset_expires > ?')
    .bind(await sha256(c.req.param('token') ?? ''), Date.now())
    .first<{ id: number }>();

function ResetPage({ error }: { error?: string }) {
  return (
    <Layout title="New password · POS@034" narrow>
      <h1>Set a new password</h1>
      {error && <p class="error">{error}</p>}
      <form method="post" class="stack">
        <label>New password (8 or more characters)<input name="password" type="password" autocomplete="new-password" minlength={8} maxlength={200} required /></label>
        <button class="btn">Save and log in</button>
      </form>
    </Layout>
  );
}

const expired = (c: Ctx) =>
  c.html(
    <Layout title="Link expired · POS@034" narrow>
      <h1>This link has expired</h1>
      <p>Reset links work once, for 24 hours. Message us for a new one.</p>
    </Layout>,
    410,
  );

site.get('/reset/:token', async (c) => ((await resetAccount(c)) ? c.html(<ResetPage />) : expired(c)));

site.post('/reset/:token', async (c) => {
  const account = await resetAccount(c);
  if (!account) return expired(c);
  const password = String((await c.req.parseBody()).password ?? '');
  if (password.length < 8 || password.length > 200) return c.html(<ResetPage error="The password needs 8 or more characters." />, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE accounts SET password = ?, reset_hash = NULL, reset_expires = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?')
      .bind(await hashPassword(password), account.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id),
  ]);
  await startSession(c, account.id);
  return c.redirect('/account');
});

// ── The customer's account ───────────────────────────────────────────────

site.get('/account', async (c) => {
  const account = await currentAccount(c);
  if (!account) return c.redirect('/login');

  const license = account.license_id
    ? await c.env.DB.prepare('SELECT key, status, updates_until FROM licenses WHERE id = ?')
        .bind(account.license_id)
        .first<{ key: string; status: string; updates_until: string }>()
    : null;

  return c.html(
    <Layout title="My account · POS@034" account={account} narrow>
      <h1>{account.business_name}</h1>
      {!license ? (
        <p class="note">Thanks for registering. We will call you on <b>{account.mobile}</b> to confirm, then your license and the app download appear here.</p>
      ) : (
        <>
          <dl class="facts">
            <dt>License key</dt><dd class="mono">{license.key}</dd>
            <dt>Status</dt><dd>{license.status === 'active' ? 'Active' : 'Revoked — contact us'}</dd>
            <dt>Updates until</dt><dd>{license.updates_until}</dd>
          </dl>
          <Fees licenseId={account.license_id!} db={c.env.DB} />
          <Download kv={c.env.RELEASES} />
        </>
      )}
      <form method="post" action="/logout"><button class="link">Log out</button></form>
    </Layout>,
  );
});

async function Fees({ licenseId, db }: { licenseId: string; db: D1Database }) {
  const [months, paid] = await Promise.all([
    db.prepare('SELECT substr(date, 1, 7) AS month, SUM(net_cents) AS net FROM closes WHERE license_id = ? GROUP BY month')
      .bind(licenseId)
      .all<{ month: string; net: number }>(),
    db.prepare('SELECT SUM(amount_cents) AS paid FROM payments WHERE license_id = ?').bind(licenseId).first<{ paid: number | null }>(),
  ]);
  const fee = feeSummary(months.results, paid?.paid ?? 0);
  return (
    <dl class="facts">
      <dt>Fee this month</dt><dd>{peso(fee.thisMonth)} so far ({FEE_RATE * 100}% of net sales)</dd>
      <dt>Amount due</dt><dd>{fee.due > 0 ? `${peso(fee.due)} — pay by GCash or bank transfer` : 'Nothing due'}</dd>
    </dl>
  );
}

async function Download({ kv }: { kv: KVNamespace }) {
  // A listing carries the metadata without reading the file itself.
  const apk = (await kv.list<ApkMeta>({ prefix: APK_KEY })).keys.find((k) => k.name === APK_KEY)?.metadata;
  return (
    <section>
      <h2>Install on your tablet</h2>
      {apk ? (
        <a class="btn" href="/account/download">Download POS@034 {apk.version} ({(apk.size / 1048576).toFixed(0)} MB)</a>
      ) : (
        <p class="note">The app download is being prepared. Check back soon.</p>
      )}
      <ol class="steps">
        <li>Open this page <b>on the tablet</b>, log in and tap Download.</li>
        <li>Open the downloaded file. If Android asks, allow your browser to install apps.</li>
        <li>Open POS@034 and follow the setup. <b>Write down the recovery code</b> it shows you.</li>
        <li>Settings → License: enter your license key and tap Activate.</li>
        <li>Practice in training mode. When your staff are ready, turn training mode off.</li>
      </ol>
    </section>
  );
}

site.get('/account/download', async (c) => {
  const account = await currentAccount(c);
  if (!account) return c.redirect('/login');
  if (!account.license_id) return c.redirect('/account');
  const { value, metadata } = await c.env.RELEASES.getWithMetadata<ApkMeta>(APK_KEY, 'stream');
  if (!value) return c.redirect('/account');
  return new Response(value, {
    headers: {
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': `attachment; filename="pos034-${metadata?.version ?? 'latest'}.apk"`,
      ...(metadata?.size ? { 'content-length': String(metadata.size) } : {}),
    },
  });
});

// ── Layout ───────────────────────────────────────────────────────────────

function Layout({ title, account, narrow, children }: { title: string; account?: Account | null; narrow?: boolean; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content="Offline-first tablet POS for Philippine restaurants." />
        <style>{raw(CSS)}</style>
      </head>
      <body>
        <nav class="top">
          <a class="logo" href="/">POS<span>@</span>034</a>
          <a class="sec" href="/#features">Features</a>
          <a class="sec" href="/#pricing">Pricing</a>
          <a class="sec" href="/#faq">FAQ</a>
          <span class="grow" />
          {account ? <a href="/account">My account</a> : <><a href="/login">Log in</a><a class="btn small" href="/register">Register</a></>}
        </nav>
        <main class={narrow ? 'narrow' : ''}>{children}</main>
        <footer>POS@034 · A sales and inventory tracker, not a BIR machine.</footer>
      </body>
    </html>
  );
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,sans-serif;color:#080808;background:#f0ede9}
a{color:#c2410c}
.top{display:flex;gap:16px;align-items:center;padding:12px 16px;background:#080808;flex-wrap:wrap}
.top a{color:#e7e5e4;text-decoration:none;font-size:14px}
.logo{font-weight:800;font-size:18px!important;color:#fff!important}.logo span{color:#ff5c1a}
.grow{flex:1}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}main.narrow{max-width:520px}
h1{font-size:28px;line-height:1.2;margin:8px 0 12px}h2{font-size:22px;margin:40px 0 12px}h3{margin:0 0 4px;font-size:16px}
.hero{padding:32px 0 8px}.hero h1{font-size:clamp(28px,6vw,44px);max-width:800px}.hero p{font-size:18px;max-width:640px}
.hero.end{text-align:center}.hero.end .ctas{justify-content:center}
.ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}
.btn{display:inline-block;background:#ff5c1a;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;text-align:center}
.btn.ghost{background:transparent;color:#080808;box-shadow:inset 0 0 0 2px #080808}
.btn.small{padding:6px 12px;color:#fff!important}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}
.tile{background:#fff;border-radius:12px;padding:16px}.tile p{margin:0;color:#44403c;font-size:15px}
.steps{padding-left:20px}.steps li{margin:6px 0}
details{background:#fff;border-radius:10px;padding:12px 16px;margin:8px 0}summary{font-weight:700;cursor:pointer}details p{margin:8px 0 0}
.muted{color:#57534e}
.stack{display:grid;gap:12px}
label{display:grid;gap:4px;font-size:14px;font-weight:600}
input{font:inherit;height:44px;border-radius:8px;border:1px solid #d6d3d1;padding:0 12px;background:#fff}
.error{background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px 14px}
.note{background:#fff7ed;border-radius:10px;padding:12px 16px}
.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;background:#fff;border-radius:12px;padding:12px 16px;margin:12px 0}
.facts dt{color:#57534e}.facts dd{margin:0;font-weight:600}.mono{font-family:ui-monospace,monospace}
.link{background:none;border:0;color:#57534e;text-decoration:underline;font:inherit;cursor:pointer;padding:0;margin-top:24px}
footer{text-align:center;color:#78716c;font-size:13px;padding:24px 16px}
@media (max-width:480px){.top .sec{display:none}}
`;

export { site };
