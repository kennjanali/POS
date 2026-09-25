/**
 * What the tablets call. No cookies, no sessions: activation is proved by the
 * license key, everything after by the signed license itself.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { GENESIS, signClose } from '../../src/lib/closes';
import type { DailyClose } from '../../src/lib/types';
import type { Env } from './env';
import { normalizeKey, readLicense, signLicense } from './license';

interface LicenseRow {
  id: string;
  business_name: string;
  plan: string;
  updates_until: string;
  status: string;
}

const api = new Hono<{ Bindings: Env }>();

// The app runs at https://localhost inside the Android WebView.
api.use('*', cors({ origin: '*', allowMethods: ['POST'], allowHeaders: ['content-type'] }));

const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 8 && v.length <= 64;
const isDevice = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

api.post('/activate', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const key = normalizeKey(body.key);
  const { installId, device } = body;
  if (!key || !isId(installId) || !isDevice(device)) {
    return c.json({ error: 'That activation request is incomplete.' }, 400);
  }

  const license = await c.env.DB.prepare(
    'SELECT id, business_name, plan, updates_until, status FROM licenses WHERE key = ?',
  )
    .bind(key)
    .first<LicenseRow>();
  if (!license) return c.json({ error: 'That license key is not recognised.' }, 404);
  if (license.status !== 'active') {
    return c.json({ error: 'This license has been revoked. Contact support.' }, 403);
  }

  // One tablet per license. Re-activating the same install is fine (a
  // reinstall); a different one needs you to release the old tablet first.
  const open = await c.env.DB.prepare(
    'SELECT install_id, device FROM activations WHERE license_id = ? AND released_at IS NULL',
  )
    .bind(license.id)
    .first<{ install_id: string; device: string }>();
  if (open && (open.install_id !== installId || open.device !== device)) {
    return c.json({ error: 'This license is active on another tablet. Contact support to move it.' }, 409);
  }
  if (!open) {
    await c.env.DB.prepare(
      'INSERT INTO activations (license_id, install_id, device, activated_at) VALUES (?, ?, ?, ?)',
    )
      .bind(license.id, installId, device, Date.now())
      .run();
  }

  const signed = await signLicense(
    {
      licenseId: license.id,
      businessName: license.business_name,
      installId,
      device,
      plan: license.plan,
      issuedAt: new Date().toISOString().slice(0, 10),
      updatesUntil: license.updates_until,
    },
    c.env.LICENSE_PRIVATE_KEY,
  );
  return c.json({ license: signed });
});

interface Heartbeat {
  license: string;
  appVersion?: string;
  os?: string;
  model?: string;
  lastBackupAt?: number | null;
  errorCount?: number;
  printerOk?: boolean;
  closes?: DailyClose[];
}

api.post('/heartbeat', async (c) => {
  const body = await c.req.json<Heartbeat>().catch(() => null);
  const license = await readLicense(body?.license, c.env.LICENSE_PRIVATE_KEY);
  if (!body || !license) return c.json({ error: 'Not a license this server issued.' }, 401);

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO heartbeats (install_id, license_id, app_version, os, model, last_backup_at, error_count, printer_ok, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(install_id) DO UPDATE SET license_id = excluded.license_id, app_version = excluded.app_version,
       os = excluded.os, model = excluded.model, last_backup_at = excluded.last_backup_at,
       error_count = excluded.error_count, printer_ok = excluded.printer_ok, seen_at = excluded.seen_at`,
  )
    .bind(
      license.installId,
      license.licenseId,
      body.appVersion ?? null,
      body.os ?? null,
      body.model ?? null,
      body.lastBackupAt ?? null,
      body.errorCount ?? null,
      body.printerOk === undefined ? null : Number(body.printerOk),
      now,
    )
    .run();

  await recordCloses(c.env.DB, license.installId, license.licenseId, body.closes ?? [], now);

  const last = await c.env.DB.prepare('SELECT MAX(no) AS no FROM closes WHERE install_id = ?')
    .bind(license.installId)
    .first<{ no: number | null }>();
  return c.json({ ackThrough: last?.no ?? 0 });
});

/**
 * Store each close once, never overwriting. `linked` records whether it
 * chains onto the close before it — hash recomputed here with the app's own
 * code, previous hash and running total matching. A doctored or missing day
 * shows up as an unlinked close on the dashboard.
 */
async function recordCloses(db: D1Database, installId: string, licenseId: string, closes: DailyClose[], now: number) {
  let previous: { hash: string; running: number } | null = null;
  for (const close of [...closes].sort((a, b) => a.no - b.no)) {
    if (!Number.isInteger(close.no) || close.no < 1) continue;
    previous ??= await db
      .prepare('SELECT hash, running_net_cents AS running FROM closes WHERE install_id = ? AND no = ?')
      .bind(installId, close.no - 1)
      .first<{ hash: string; running: number }>();

    const { hash, ...unsigned } = close;
    const genuine = (await signClose(unsigned)).hash === hash;
    const chains = close.no === 1
      ? close.prevHash === GENESIS && close.runningNetCents === close.netCents
      : previous !== null &&
        close.prevHash === previous.hash &&
        close.runningNetCents === previous.running + close.netCents;

    await db
      .prepare(
        `INSERT OR IGNORE INTO closes (install_id, no, license_id, date, closed_at, orders, net_cents, running_net_cents, hash, linked, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(installId, close.no, licenseId, close.date, close.closedAt, close.orders, close.netCents,
        close.runningNetCents, hash, Number(genuine && chains), now)
      .run();
    previous = { hash, running: close.runningNetCents };
  }
}

export { api };
