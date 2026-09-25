// End-to-end check against a running server (default: `npm run dev` on :8787).
// Run: node scripts/e2e.mjs [baseUrl]
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:8787';
// The dashboard password: ADMIN_PASSWORD, or the one in .dev.vars for a local run.
const password = process.env.ADMIN_PASSWORD ??
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
const basic = (pw) => ({ authorization: `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}` });
// Origin: the dashboard's forms only accept posts from its own pages.
const adminFetch = (path, init = {}) => fetch(BASE + path, { ...init, headers: { origin: BASE, ...init.headers, ...basic(password) } });
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
};
const post = (path, body) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ── The dashboard is not open to anyone ──────────────────────────────────
check('the dashboard refuses a visitor with no password', (await fetch(`${BASE}/admin`)).status === 401);
check('and one with the wrong password', (await fetch(`${BASE}/admin`, { headers: basic('wrong-password-123456789') })).status === 401);
check('and lets the admin in', (await adminFetch('/admin')).status === 200);

// ── Create a license through the dashboard form ──────────────────────────
const business = `E2E Carinderia ${Date.now()}`;
const created = await adminFetch('/admin/licenses', {
  method: 'POST',
  body: new URLSearchParams({ business_name: business, city: 'Bacolod', updates_until: '2027-12-31' }),
  redirect: 'manual',
});
const key = decodeURIComponent(new URL(created.headers.get('location'), BASE).searchParams.get('created') ?? '');
check('the dashboard creates a license and shows its key', /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(key), key);

// ── Activate ─────────────────────────────────────────────────────────────
const installId = crypto.randomUUID();
const device = createHash('sha256').update('emulator-device').digest('hex');
const activated = await (await post('/api/activate', { key: key.toLowerCase().replace(/-/g, ' '), installId, device })).json();
check('activation returns a license', typeof activated.license === 'string', JSON.stringify(activated));

// Verify with the public key the app ships — proves the server's secret and
// the app's key are a pair.
const appKey = readFileSync(new URL('../../src/lib/license.ts', import.meta.url), 'utf8').match(/PUBLIC_KEY = '([^']+)'/)[1];
const [payload, signature] = activated.license.split('.');
const genuine = verify(
  null,
  Buffer.from(payload),
  createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: appKey }, format: 'jwk' }),
  Buffer.from(signature, 'base64url'),
);
const fields = JSON.parse(Buffer.from(payload, 'base64url').toString());
check('the app\'s public key verifies it', genuine);
check('it is bound to this install and tablet', fields.installId === installId && fields.device === device);

const again = await post('/api/activate', { key, installId, device });
check('re-activating the same tablet works (a reinstall)', again.ok);
const other = await post('/api/activate', { key, installId: crypto.randomUUID(), device: 'f'.repeat(64) });
check('a second tablet is refused', other.status === 409, (await other.json()).error);
const wrong = await post('/api/activate', { key: 'AAAA-AAAA-AAAA-AAAA', installId, device });
check('an unknown key is refused', wrong.status === 404);

// ── Heartbeat with daily closes ──────────────────────────────────────────
// Mirrors canonical() in src/lib/closes.ts. If the two ever differ, the
// server marks every close unlinked and this check fails loudly.
const TENDERS = ['cash', 'gcash', 'maya', 'card', 'bank', 'other'];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const signClose = (c) => ({
  ...c,
  hash: sha(JSON.stringify([c.id, c.no, c.date, c.closedAt, c.closedBy, c.orders, c.grossCents, c.discountCents,
    c.voidedEarlierCents, c.netCents, TENDERS.map((t) => c.tenders[t]), c.runningNetCents, c.prevHash])),
});
const makeClose = (no, net, prev) => signClose({
  id: crypto.randomUUID(), no, date: `2026-09-${String(20 + no).padStart(2, '0')}`, closedAt: 1_790_000_000_000 + no * 86_400_000,
  closedBy: null, orders: 10, grossCents: net, discountCents: 0, voidedEarlierCents: 0, netCents: net,
  tenders: { cash: net, gcash: 0, maya: 0, card: 0, bank: 0, other: 0 },
  runningNetCents: (prev?.runningNetCents ?? 0) + net, prevHash: prev?.hash ?? 'genesis',
});
const c1 = makeClose(1, 500_000);
const c2 = makeClose(2, 300_000, c1);
const beat = await (await post('/api/heartbeat', {
  license: activated.license, appVersion: '0.1.0', os: 'Android 15', model: 'Pixel Tablet',
  lastBackupAt: Date.now(), errorCount: 0, printerOk: true, closes: [c1, c2],
})).json();
check('the heartbeat acknowledges the closes', beat.ackThrough === 2, JSON.stringify(beat));

const forged = { ...makeClose(3, 900_000, c2), netCents: 100 }; // edited after signing
await post('/api/heartbeat', { license: activated.license, closes: [forged] });
const fake = await post('/api/heartbeat', { license: `${payload}.${Buffer.from('nope').toString('base64url')}`, closes: [] });
check('a heartbeat with a forged license is refused', fake.status === 401);

// ── Dashboard ────────────────────────────────────────────────────────────
const list = await (await adminFetch('/admin')).text();
check('the customer is on the dashboard', list.includes(business));
const detail = await (await adminFetch(`/admin/licenses/${fields.licenseId}`)).text();
// The fee counts every close as reported, the flagged one included (edited to
// claim ₱1.00): 2% of ₱5,000 + ₱3,000 + ₱1 = ₱160.02. The flag is for you to
// chase; the server does not guess what the real figure was.
const thisMonth = detail.match(/(₱[0-9,.]+) this month/)?.[1];
check('the fee is 2% of reported net', thisMonth === '₱160.02', `this month: ${thisMonth}`);
check('the edited close is flagged', (detail.match(/does not chain/g) ?? []).length === 1);

// ── Replacement tablet: release, re-activate, restored closes resent ─────
await adminFetch(`/admin/licenses/${fields.licenseId}/release`, { method: 'POST', redirect: 'manual' });
const newInstall = crypto.randomUUID();
const newDevice = createHash('sha256').update('replacement-tablet').digest('hex');
const moved = await (await post('/api/activate', { key, installId: newInstall, device: newDevice })).json();
check('after release, the new tablet activates', typeof moved.license === 'string', JSON.stringify(moved));
const c4 = makeClose(4, 200_000, c2); // continues the chain from the restored closes
const resent = await (await post('/api/heartbeat', { license: moved.license, closes: [c1, c2, c4] })).json();
const after = await (await adminFetch(`/admin/licenses/${fields.licenseId}`)).text();
const afterMonth = after.match(/(₱[0-9,.]+) this month/)?.[1];
check('restored closes are not billed twice', afterMonth === '₱200.02', `this month: ${afterMonth} (was ₱160.02, plus 2% of ₱2,000)`);
check('the chain carries on across tablets', (after.match(/does not chain/g) ?? []).length === 1);
check('the new tablet is acknowledged through close 4', resent.ackThrough === 4, JSON.stringify(resent));

// ── Encrypted backups ────────────────────────────────────────────────────
const blob = crypto.getRandomValues(new Uint8Array(4096));
const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
const uploaded = await fetch(`${BASE}/api/backup`, {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream', 'x-license': moved.license, 'x-salt': salt },
  body: blob,
});
check('a licensed tablet uploads its sealed backup', uploaded.ok, await uploaded.clone().text());
const noLicense = await fetch(`${BASE}/api/backup`, { method: 'POST', headers: { 'x-salt': salt }, body: blob });
check('an upload without a license is refused', noLicense.status === 401);

const listed = await (await fetch(`${BASE}/api/backups`, { headers: { 'x-license-key': key } })).json();
check('the owner lists backups with the license key', listed.backups?.length === 1, JSON.stringify(listed));
const back = await fetch(`${BASE}/api/backups/${listed.backups[0].name}`, { headers: { 'x-license-key': key } });
const backBytes = new Uint8Array(await back.arrayBuffer());
check('the download is byte-for-byte what was uploaded', Buffer.compare(Buffer.from(backBytes), Buffer.from(blob)) === 0);
check('it comes with its salt', back.headers.get('x-salt') === salt);
const stranger = await fetch(`${BASE}/api/backups`, { headers: { 'x-license-key': 'AAAA-AAAA-AAAA-AAAA' } });
check('a wrong license key sees nothing', stranger.status === 404);

// ── A live install's first close follows unreported training closes ──────
const trainingKey = decodeURIComponent(new URL((await adminFetch('/admin/licenses', {
  method: 'POST', body: new URLSearchParams({ business_name: `Anchor ${Date.now()}`, updates_until: '2027-12-31' }), redirect: 'manual',
})).headers.get('location'), BASE).searchParams.get('created'));
const liveDevice = createHash('sha256').update('anchor-tablet').digest('hex');
const live = await (await post('/api/activate', { key: trainingKey, installId: crypto.randomUUID(), device: liveDevice })).json();
const t1 = makeClose(1, 50_000);
const t2 = makeClose(2, 50_000, t1); // training closes: never sent
const firstLive = makeClose(3, 120_000, t2);
await post('/api/heartbeat', { license: live.license, closes: [firstLive] });
const anchorId = JSON.parse(Buffer.from(live.license.split('.')[0], 'base64url').toString()).licenseId;
const anchorPage = await (await adminFetch(`/admin/licenses/${anchorId}`)).text();
check('the first live close anchors the chain', !anchorPage.includes('does not chain') && anchorPage.includes('₱1,200.00'));

// ── Website: register, approval, download, login, reset ──────────────────
const form = (path, fields, cookie = '', origin = BASE) =>
  fetch(BASE + path, { method: 'POST', redirect: 'manual', body: new URLSearchParams(fields), headers: { origin, cookie } });
const page = (path, cookie = '') => fetch(BASE + path, { redirect: 'manual', headers: { cookie } });
const sessionOf = (res) => res.headers.get('set-cookie')?.match(/pos034_session=[0-9a-f]+/)?.[0] ?? '';

const home = await (await page('/')).text();
check('the landing page says what it does and links to sign-up', home.includes('keeps selling') && home.includes('href="/register"'));

const email = `owner${Date.now()}@example.com`;
const signup = { business_name: `Site Carinderia ${Date.now()}`, owner_name: 'Maria', mobile: '09171234567', city: 'Iloilo', email, password: 'correct horse' };
check('a bad email is refused', (await form('/register', { ...signup, email: 'nope' })).status === 400);
check('a short password is refused', (await form('/register', { ...signup, password: 'short' })).status === 400);
check('another site cannot post the sign-up form', (await form('/register', signup, '', 'https://evil.example')).status === 403);
const registered = await form('/register', { ...signup, email: email.toUpperCase() });
let session = sessionOf(registered);
check('registering logs them in', registered.status === 302 && registered.headers.get('location') === '/account' && !!session);
check('the same email cannot register twice', (await form('/register', signup)).status === 409);

let account = await (await page('/account', session)).text();
check('a pending account has no key and no download', account.includes('We will call you') && !account.includes('/account/download'));
check('and the download refuses it', (await page('/account/download', session)).headers.get('location') === '/account');
check('no account page without logging in', (await page('/account')).headers.get('location') === '/login');

const dash = await (await adminFetch('/admin')).text();
const signupId = dash.match(/\/admin\/signups\/(\d+)\/approve/)?.[1];
check('the sign-up waits on your dashboard', dash.includes(signup.business_name) && dash.includes('09171234567') && !!signupId);
const approved = await adminFetch(`/admin/signups/${signupId}/approve`, { method: 'POST', redirect: 'manual' });
const siteLicenseId = approved.headers.get('location')?.split('/').pop();
const licensePage = await (await adminFetch(`/admin/licenses/${siteLicenseId}`)).text();
check('approving creates their license, with their contact details', /LIC-\d{4}-\d{4}/.test(siteLicenseId ?? '') && licensePage.includes('Maria · 09171234567'));

account = await (await page('/account', session)).text();
const siteKey = account.match(/[A-Z2-9]{4}(-[A-Z2-9]{4}){3}/)?.[0];
check('the customer now sees their license key', !!siteKey && licensePage.includes(siteKey));
check('and the download', account.includes('href="/account/download"'));
const apk = await page('/account/download', session);
const apkBytes = new Uint8Array(await apk.arrayBuffer());
check('the download is an APK', apk.headers.get('content-type') === 'application/vnd.android.package-archive' && apkBytes[0] === 0x50 && apkBytes[1] === 0x4b,
  `${apk.status} ${apk.headers.get('content-type')} ${apkBytes.length} bytes`);

check('a wrong password is refused', (await form('/login', { email, password: 'wrong password' })).status === 401);
const loggedIn = await form('/login', { email, password: 'correct horse' });
check('the right one logs in', loggedIn.status === 302 && !!sessionOf(loggedIn));

for (let i = 0; i < 10; i++) await form('/login', { email, password: 'guess guess' });
check('ten wrong passwords lock the account for a while', (await form('/login', { email, password: 'correct horse' })).status === 429);

const reset = await adminFetch(`/admin/accounts/${signupId}/reset`, { method: 'POST', redirect: 'manual' });
const resetLink = decodeURIComponent(new URL(reset.headers.get('location'), BASE).searchParams.get('reset') ?? '');
const resetPath = new URL(resetLink).pathname;
check('you can make a reset link', resetPath.startsWith('/reset/') && (await page(resetPath)).status === 200);
const resetDone = await form(resetPath, { password: 'new password 1' });
check('the link sets a new password and logs them in', resetDone.status === 302 && !!sessionOf(resetDone));
check('and works only once', (await page(resetPath)).status === 410);
check('it signs out the old sessions', (await page('/account', session)).headers.get('location') === '/login');
session = sessionOf(await form('/login', { email, password: 'new password 1' }));
check('the new password works, and clears the lock', !!session);
await form('/logout', {}, session);
check('logging out ends the session', (await page('/account', session)).headers.get('location') === '/login');

console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll license-server checks passed.');
process.exit(failures ? 1 : 0);
