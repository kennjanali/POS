/**
 * "My Customers" — your dashboard. Server-rendered HTML with plain forms, so
 * there is nothing to build and no script running in the page. Behind
 * Cloudflare Access (see access.ts).
 */

import { Hono } from 'hono';
import type { Child } from 'hono/jsx';

import type { Env } from './env';
import { newLicenseKey } from './license';

/** Must match TECH_FEE_RATE in the app's Dashboard (src/app/dashboard/page.tsx). */
const FEE_RATE = 0.02;
const DAY = 86_400_000;

interface Row {
  id: string;
  key: string;
  business_name: string;
  city: string;
  plan: string;
  updates_until: string;
  status: string;
  notes: string;
  install_id: string | null;
  app_version: string | null;
  model: string | null;
  last_backup_at: number | null;
  printer_ok: number | null;
  seen_at: number | null;
}

const admin = new Hono<{ Bindings: Env }>();

const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const month = (ts = Date.now()) => new Date(ts + 8 * 3600_000).toISOString().slice(0, 7); // Asia/Manila
const ago = (ts: number | null) => {
  if (!ts) return 'never';
  const days = Math.floor((Date.now() - ts) / DAY);
  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
};
const tone = (ts: number | null, amberDays: number, redDays: number) =>
  !ts ? 'bad' : Date.now() - ts < amberDays * DAY ? 'good' : Date.now() - ts < redDays * DAY ? 'warn' : 'bad';
const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

async function loadCustomers(db: D1Database) {
  const [rows, fees, paid, gaps] = await Promise.all([
    db
      .prepare(
        `SELECT l.*, a.install_id, h.app_version, h.model, h.last_backup_at, h.printer_ok, h.seen_at
         FROM licenses l
         LEFT JOIN activations a ON a.license_id = l.id AND a.released_at IS NULL
         LEFT JOIN heartbeats h ON h.install_id = a.install_id
         ORDER BY l.created_at DESC`,
      )
      .all<Row>(),
    db
      .prepare('SELECT license_id, substr(date, 1, 7) AS month, SUM(net_cents) AS net FROM closes GROUP BY license_id, month')
      .all<{ license_id: string; month: string; net: number }>(),
    db.prepare('SELECT license_id, SUM(amount_cents) AS paid FROM payments GROUP BY license_id').all<{ license_id: string; paid: number }>(),
    db.prepare('SELECT license_id, COUNT(*) AS n FROM closes WHERE linked = 0 GROUP BY license_id').all<{ license_id: string; n: number }>(),
  ]);

  const current = month();
  const latest = rows.results.reduce((best, r) => (r.app_version && newer(r.app_version, best) ? r.app_version : best), '0.0.0');
  return rows.results.map((r) => {
    const mine = fees.results.filter((f) => f.license_id === r.id);
    const feeOf = (m: { net: number }) => Math.round(m.net * FEE_RATE);
    const thisMonth = mine.filter((m) => m.month === current).reduce((s, m) => s + feeOf(m), 0);
    const billed = mine.filter((m) => m.month < current).reduce((s, m) => s + feeOf(m), 0);
    const payments = paid.results.find((p) => p.license_id === r.id)?.paid ?? 0;
    return {
      ...r,
      thisMonth,
      due: Math.max(0, billed - payments),
      gaps: gaps.results.find((g) => g.license_id === r.id)?.n ?? 0,
      behind: !!r.app_version && newer(latest, r.app_version),
      expiring: r.updates_until < new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10),
    };
  });
}

type Customer = Awaited<ReturnType<typeof loadCustomers>>[number];

const TABS: { key: string; label: string; show: (c: Customer) => boolean }[] = [
  { key: 'all', label: 'All', show: () => true },
  { key: 'updates', label: 'Updates', show: (c) => c.behind },
  { key: 'licenses', label: 'Licenses', show: (c) => c.status !== 'active' || c.expiring || !c.install_id },
  { key: 'backups', label: 'Backups', show: (c) => !!c.install_id && tone(c.last_backup_at, 2, 4) !== 'good' },
  { key: 'fees', label: 'Fees', show: (c) => c.due > 0 || c.gaps > 0 },
  { key: 'offline', label: 'Offline', show: (c) => !!c.install_id && tone(c.seen_at, 1, 7) === 'bad' },
];

admin.get('/', async (c) => {
  const customers = await loadCustomers(c.env.DB);
  const tab = TABS.find((t) => t.key === c.req.query('tab')) ?? TABS[0]!;
  const created = c.req.query('created');
  return c.html(
    <Page title="My Customers">
      {created && <p class="flash">License created. Give the customer this key: <b class="mono">{created}</b></p>}
      <nav class="tabs">
        {TABS.map((t) => (
          <a href={`?tab=${t.key}`} class={t.key === tab.key ? 'tab on' : 'tab'}>
            {t.label} <span class="count">{customers.filter(t.show).length}</span>
          </a>
        ))}
      </nav>
      <ul class="rows">
        {customers.filter(tab.show).map((cu) => (
          <li>
            <a class="row" href={`/admin/licenses/${cu.id}`}>
              <span class="avatar" style={`background:${colour(cu.business_name)}`}>{cu.business_name[0]?.toUpperCase()}</span>
              <span class="name">
                {cu.business_name}
                <small>{cu.city || cu.id}</small>
              </span>
              <span class="cell">{cu.app_version ?? '—'}{cu.behind && <b class="badge">update</b>}</span>
              <Dot tone={cu.status !== 'active' ? 'bad' : cu.expiring ? 'warn' : 'good'} title="License">
                {cu.status !== 'active' ? 'Revoked' : cu.install_id ? 'Licensed' : 'Not activated'}
              </Dot>
              <Dot tone={tone(cu.last_backup_at, 2, 4)} title="Backup">☁ {ago(cu.last_backup_at)}</Dot>
              <Dot tone={cu.gaps > 0 ? 'bad' : cu.due > 0 ? 'warn' : 'good'} title="Fees">
                {cu.gaps > 0 ? `${cu.gaps} gap${cu.gaps === 1 ? '' : 's'}` : cu.due > 0 ? `${peso(cu.due)} due` : peso(cu.thisMonth)}
              </Dot>
              <Dot tone={tone(cu.seen_at, 1, 7)} title="Last seen">⚡ {ago(cu.seen_at)}</Dot>
            </a>
          </li>
        ))}
      </ul>
      <form method="post" action="/admin/licenses" class="new">
        <h2>New license</h2>
        <input name="business_name" placeholder="Business name" required />
        <input name="city" placeholder="City" />
        <label>Updates until <input type="date" name="updates_until" value={new Date(Date.now() + 365 * DAY).toISOString().slice(0, 10)} required /></label>
        <button>Create license</button>
      </form>
    </Page>,
  );
});

admin.post('/licenses', async (c) => {
  const form = await c.req.parseBody();
  const name = String(form.business_name ?? '').trim();
  if (!name) return c.redirect('/admin');
  const year = new Date().getUTCFullYear();
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM licenses WHERE id LIKE ?').bind(`LIC-${year}-%`).first<{ n: number }>();
  const id = `LIC-${year}-${String((count?.n ?? 0) + 1).padStart(4, '0')}`;
  const key = newLicenseKey();
  await c.env.DB.prepare(
    'INSERT INTO licenses (id, key, business_name, city, updates_until, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, key, name, String(form.city ?? '').trim(), String(form.updates_until), Date.now())
    .run();
  return c.redirect(`/admin?created=${encodeURIComponent(key)}`);
});

admin.get('/licenses/:id', async (c) => {
  const id = c.req.param('id');
  const cu = (await loadCustomers(c.env.DB)).find((x) => x.id === id);
  if (!cu) return c.notFound();
  const [activations, closes, payments] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM activations WHERE license_id = ? ORDER BY activated_at DESC').bind(id)
      .all<{ install_id: string; device: string; activated_at: number; released_at: number | null }>(),
    c.env.DB.prepare('SELECT no, date, orders, net_cents, linked FROM closes WHERE license_id = ? ORDER BY closed_at DESC LIMIT 31').bind(id)
      .all<{ no: number; date: string; orders: number; net_cents: number; linked: number }>(),
    c.env.DB.prepare('SELECT month, amount_cents, method, ref, paid_at FROM payments WHERE license_id = ? ORDER BY paid_at DESC').bind(id)
      .all<{ month: string; amount_cents: number; method: string; ref: string; paid_at: number }>(),
  ]);
  const action = (path: string) => `/admin/licenses/${id}/${path}`;
  return c.html(
    <Page title={cu.business_name} back>
      <dl class="facts">
        <dt>License</dt><dd>{cu.id} · <span class="mono">{cu.key}</span> · {cu.status}</dd>
        <dt>Updates until</dt><dd>{cu.updates_until}</dd>
        <dt>Tablet</dt><dd>{cu.model ?? '—'} · app {cu.app_version ?? '—'} · printer {cu.printer_ok === null ? '—' : cu.printer_ok ? 'OK' : 'not reachable'}</dd>
        <dt>Last seen</dt><dd>{ago(cu.seen_at)} · backup {ago(cu.last_backup_at)}</dd>
        <dt>Fees</dt><dd>{peso(cu.thisMonth)} this month · {peso(cu.due)} due from past months</dd>
      </dl>

      <section class="actions">
        <form method="post" action={action('payments')}>
          <h2>Record a payment</h2>
          <input name="month" type="month" value={month(Date.now() - 20 * DAY)} required />
          <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount (₱)" required />
          <select name="method"><option value="gcash">GCash</option><option value="bank">Bank</option><option value="other">Other</option></select>
          <input name="ref" placeholder="Reference no." />
          <button>Save payment</button>
        </form>
        <form method="post" action={action('extend')}>
          <h2>Updates until</h2>
          <input type="date" name="updates_until" value={cu.updates_until} required />
          <button>Save</button>
        </form>
        <form method="post" action={action('release')}>
          <h2>Move to a new tablet</h2>
          <p>Frees the license so the new tablet can activate. The old one keeps working offline until its license is replaced.</p>
          <button disabled={!cu.install_id}>Release current tablet</button>
        </form>
        <form method="post" action={action(cu.status === 'active' ? 'revoke' : 'reactivate')}>
          <h2>{cu.status === 'active' ? 'Revoke' : 'Reactivate'}</h2>
          <button class={cu.status === 'active' ? 'danger' : ''}>{cu.status === 'active' ? 'Revoke license' : 'Reactivate license'}</button>
        </form>
      </section>

      <h2>Daily closes</h2>
      <table>
        <tr><th>#</th><th>Date</th><th>Sales</th><th>Net</th><th>Fee</th><th></th></tr>
        {closes.results.map((cl) => (
          <tr class={cl.linked ? '' : 'gap'}>
            <td>{cl.no}</td><td>{cl.date}</td><td>{cl.orders}</td><td>{peso(cl.net_cents)}</td>
            <td>{peso(Math.round(cl.net_cents * FEE_RATE))}</td><td>{cl.linked ? '' : 'does not chain — check this day'}</td>
          </tr>
        ))}
      </table>

      <h2>Payments</h2>
      <table>
        <tr><th>For</th><th>Amount</th><th>Method</th><th>Ref</th><th>Recorded</th></tr>
        {payments.results.map((p) => (
          <tr><td>{p.month}</td><td>{peso(p.amount_cents)}</td><td>{p.method}</td><td>{p.ref}</td><td>{new Date(p.paid_at).toISOString().slice(0, 10)}</td></tr>
        ))}
      </table>

      <h2>Tablets</h2>
      <table>
        <tr><th>Install</th><th>Activated</th><th>Released</th></tr>
        {activations.results.map((a) => (
          <tr><td class="mono">{a.install_id.slice(0, 13)}…</td><td>{new Date(a.activated_at).toISOString().slice(0, 10)}</td><td>{a.released_at ? new Date(a.released_at).toISOString().slice(0, 10) : 'current'}</td></tr>
        ))}
      </table>
    </Page>,
  );
});

admin.post('/licenses/:id/payments', async (c) => {
  const form = await c.req.parseBody();
  const cents = Math.round(Number(form.amount) * 100);
  if (cents > 0) {
    await c.env.DB.prepare('INSERT INTO payments (license_id, month, amount_cents, method, ref, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(c.req.param('id'), String(form.month), cents, String(form.method), String(form.ref ?? ''), Date.now())
      .run();
  }
  return c.redirect(`/admin/licenses/${c.req.param('id')}`);
});

admin.post('/licenses/:id/extend', async (c) => {
  const form = await c.req.parseBody();
  await c.env.DB.prepare('UPDATE licenses SET updates_until = ? WHERE id = ?').bind(String(form.updates_until), c.req.param('id')).run();
  return c.redirect(`/admin/licenses/${c.req.param('id')}`);
});

admin.post('/licenses/:id/release', async (c) => {
  await c.env.DB.prepare('UPDATE activations SET released_at = ? WHERE license_id = ? AND released_at IS NULL').bind(Date.now(), c.req.param('id')).run();
  return c.redirect(`/admin/licenses/${c.req.param('id')}`);
});

for (const [path, status] of [['revoke', 'revoked'], ['reactivate', 'active']] as const) {
  admin.post(`/licenses/:id/${path}`, async (c) => {
    await c.env.DB.prepare('UPDATE licenses SET status = ? WHERE id = ?').bind(status, c.req.param('id')).run();
    return c.redirect(`/admin/licenses/${c.req.param('id')}`);
  });
}

// ── Layout ───────────────────────────────────────────────────────────────

function colour(name: string): string {
  const palette = ['#16a34a', '#0f766e', '#f59e0b', '#0891b2', '#71717a', '#f97316', '#4338ca', '#c026d3'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

function Dot({ tone, title, children }: { tone: string; title: string; children: Child }) {
  return <span class={`cell dot ${tone}`} title={title}>{children}</span>;
}

function Page({ title, back, children }: { title: string; back?: boolean; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · POS@034</title>
        <style>{CSS}</style>
      </head>
      <body>
        <main class="card">
          <header>
            {back && <a class="back" href="/admin">← My Customers</a>}
            <h1>{title}</h1>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;padding:32px 16px;font:14px/1.5 system-ui,sans-serif;color:#18181b;
  background:radial-gradient(circle at 20% 110%,#3b0764 0,transparent 45%),radial-gradient(circle at 90% -10%,#1e3a8a 0,transparent 40%),#09090b}
.card{max-width:1100px;margin:0 auto;background:#f4f4f5;border-radius:16px;padding:24px;box-shadow:0 0 0 8px #3f3f46}
h1{margin:0 0 16px;font-size:22px}h2{font-size:14px;margin:20px 0 8px}
.back{color:#71717a;text-decoration:none;font-size:13px}
.tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #e4e4e7;padding-bottom:12px;margin-bottom:8px}
.tab{padding:8px 12px;border-radius:8px;color:#3f3f46;text-decoration:none;font-weight:600}
.tab.on{background:#e4e4e7}.count{font-size:11px;background:#d4d4d8;border-radius:6px;padding:1px 6px;margin-left:4px}
.rows{list-style:none;margin:0;padding:0;background:#fff;border-radius:12px}
.row{display:grid;grid-template-columns:40px minmax(160px,1.6fr) 90px repeat(4,minmax(110px,1fr));gap:12px;align-items:center;
  padding:12px 16px;color:inherit;text-decoration:none;border-bottom:1px solid #f4f4f5}
.row:hover{background:#f3e8ff}
.avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700}
.name{font-weight:700}.name small{display:block;font-weight:400;color:#71717a}
.cell{font-size:13px;white-space:nowrap}.badge{margin-left:6px;font-size:10px;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 5px}
.dot::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}
.good::before{background:#16a34a}.warn::before{background:#f59e0b}.bad::before{background:#dc2626}
.flash{background:#dcfce7;border-radius:8px;padding:10px 14px}.mono{font-family:ui-monospace,monospace}
form{background:#fff;border-radius:12px;padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
form h2{width:100%;margin:0}form p{width:100%;margin:0;color:#71717a;font-size:12px}
.new{margin-top:16px}.actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
input,select,button{font:inherit;height:40px;border-radius:8px;border:1px solid #d4d4d8;padding:0 10px;background:#fff}
button{background:#ff5c1a;border-color:#ff5c1a;color:#fff;font-weight:700;cursor:pointer}button:disabled{opacity:.4}
button.danger{background:#dc2626;border-color:#dc2626}
.facts{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;background:#fff;border-radius:12px;padding:12px 16px;margin:0}
.facts dt{color:#71717a}.facts dd{margin:0}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:13px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #f4f4f5}th{color:#71717a;font-weight:600}
tr.gap td{background:#fee2e2}
@media (max-width:800px){.row{grid-template-columns:40px 1fr;}.row .cell{grid-column:2}}
`;

export { admin };
