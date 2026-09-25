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
api.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST'],
    allowHeaders: ['content-type', 'x-license', 'x-license-key', 'x-salt'],
    exposeHeaders: ['x-salt'],
  }),
);

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

  const last = await c.env.DB.prepare('SELECT MAX(no) AS no FROM closes WHERE license_id = ?')
    .bind(license.licenseId)
    .first<{ no: number | null }>();
  return c.json({ ackThrough: last?.no ?? 0 });
});

/**
 * Store each close once, by its own id, never overwriting — a close restored
 * onto a replacement tablet is already here and is skipped, so no day is
 * billed twice.
 *
 * `linked` records whether it chains onto the close before it: hash
 * recomputed with the app's own code, and a previous close of this license
 * whose hash and running total it continues. Followed by hash rather than
 * by tablet, so the chain carries on across a replacement. The first close
 * ever received for a license anchors the chain (closes taken in training
 * mode are never sent). A doctored or missing day shows as unlinked.
 */
async function recordCloses(db: D1Database, installId: string, licenseId: string, closes: DailyClose[], now: number) {
  const known = await db.prepare('SELECT COUNT(*) AS n FROM closes WHERE license_id = ?').bind(licenseId).first<{ n: number }>();
  let anchored = (known?.n ?? 0) > 0;
  const received = new Map<string, number>(); // hash -> running total, this batch

  for (const close of [...closes].sort((a, b) => a.no - b.no)) {
    if (typeof close.id !== 'string' || !Number.isInteger(close.no) || close.no < 1) continue;
    const exists = await db.prepare('SELECT 1 FROM closes WHERE close_id = ?').bind(close.id).first();
    if (exists) continue;

    const previousRunning =
      received.get(close.prevHash) ??
      (
        await db
          .prepare('SELECT running_net_cents AS running FROM closes WHERE license_id = ? AND hash = ?')
          .bind(licenseId, close.prevHash)
          .first<{ running: number }>()
      )?.running;

    const { hash, ...unsigned } = close;
    const genuine = (await signClose(unsigned)).hash === hash;
    const chains =
      (close.prevHash === GENESIS && close.no === 1 && close.runningNetCents === close.netCents) ||
      (previousRunning !== undefined && close.runningNetCents === previousRunning + close.netCents) ||
      !anchored;

    await db
      .prepare(
        `INSERT INTO closes (close_id, install_id, no, license_id, date, closed_at, orders, net_cents, running_net_cents, hash, linked, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(close.id, installId, close.no, licenseId, close.date, close.closedAt, close.orders, close.netCents,
        close.runningNetCents, hash, Number(genuine && chains), now)
      .run();
    received.set(hash, close.runningNetCents);
    anchored = true;
  }
}

// ── Encrypted backups ────────────────────────────────────────────────────
// Stored as `<licenseId>/<YYYY-MM-DD>.bin`: one per day, a re-upload the same
// day replaces it. The salt rides along so the owner's recovery code alone
// can decrypt it on a new tablet.

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const KEEP_DAILY = 30;

api.post('/backup', async (c) => {
  const license = await readLicense(c.req.header('x-license'), c.env.LICENSE_PRIVATE_KEY);
  if (!license) return c.json({ error: 'Not a license this server issued.' }, 401);
  const salt = c.req.header('x-salt') ?? '';
  if (!/^[A-Za-z0-9+/=]{16,64}$/.test(salt)) return c.json({ error: 'Missing salt.' }, 400);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BACKUP_BYTES) return c.json({ error: 'Backup too large or empty.' }, 413);

  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // Asia/Manila
  await c.env.BACKUPS.put(`${license.licenseId}/${day}.bin`, body, {
    customMetadata: { salt, installId: license.installId },
  });
  await prune(c.env.BACKUPS, license.licenseId);
  return c.json({ ok: true, name: `${day}.bin` });
});

/** Keep the last 30 days, and the first backup of every month for good. */
async function prune(bucket: R2Bucket, licenseId: string) {
  const listed = await bucket.list({ prefix: `${licenseId}/` });
  const names = listed.objects.map((o) => o.key).sort().reverse(); // newest first
  const firstOfMonth = new Set<string>();
  const seenMonth = new Set<string>();
  for (const name of [...names].reverse()) {
    const month = name.slice(licenseId.length + 1, licenseId.length + 8);
    if (!seenMonth.has(month)) {
      seenMonth.add(month);
      firstOfMonth.add(name);
    }
  }
  const drop = names.slice(KEEP_DAILY).filter((name) => !firstOfMonth.has(name));
  if (drop.length > 0) await bucket.delete(drop);
}

/** The license key is the proof: only the owner has it, and the files are unreadable without the recovery code. */
async function licenseByKey(db: D1Database, key: string | undefined) {
  return db
    .prepare("SELECT id FROM licenses WHERE key = ? AND status = 'active'")
    .bind(normalizeKey(key))
    .first<{ id: string }>();
}

api.get('/backups', async (c) => {
  const license = await licenseByKey(c.env.DB, c.req.header('x-license-key'));
  if (!license) return c.json({ error: 'That license key is not recognised.' }, 404);
  const listed = await c.env.BACKUPS.list({ prefix: `${license.id}/` });
  const backups = listed.objects
    .map((o) => ({ name: o.key.slice(license.id.length + 1), size: o.size, uploaded: o.uploaded.getTime() }))
    .sort((a, b) => b.name.localeCompare(a.name));
  return c.json({ backups });
});

api.get('/backups/:name', async (c) => {
  const license = await licenseByKey(c.env.DB, c.req.header('x-license-key'));
  if (!license) return c.json({ error: 'That license key is not recognised.' }, 404);
  const name = c.req.param('name');
  if (!/^\d{4}-\d{2}-\d{2}\.bin$/.test(name)) return c.json({ error: 'No such backup.' }, 404);
  const object = await c.env.BACKUPS.get(`${license.id}/${name}`);
  if (!object) return c.json({ error: 'No such backup.' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-salt': object.customMetadata?.salt ?? '',
      'access-control-expose-headers': 'x-salt',
      'access-control-allow-origin': '*',
    },
  });
});

export { api };
