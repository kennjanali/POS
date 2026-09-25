/**
 * Encrypted cloud backup. A tablet can be dropped, stolen or wiped; the
 * nightly copy on the license server is what brings the books back.
 *
 * Encrypted on the tablet before it leaves: gzip, then AES-256-GCM with a key
 * derived from the owner's recovery code. The server stores bytes it cannot
 * read. The key is derived once, while the code is on screen (setup or a
 * reissue), and kept on the tablet — never inside a backup. Restoring on a
 * new tablet derives it again from the code the owner wrote down.
 */

import { LICENSE_SERVER_URL } from './brand';
import type { DataSnapshot } from './types';

export interface BackupKey {
  /** base64 — travels with each upload so the code alone can re-derive the key. */
  salt: string;
  /** base64 raw AES-256 key. Stays on this tablet. */
  key: string;
}

/** Same work factor as PIN hashing (crypto.ts). */
const ITERATIONS = 210_000;
/** Format byte, so the layout can change later without guessing. */
const FORMAT = 1;

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** As in crypto.ts: case, dashes and spaces never matter. */
const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function derive(code: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalize(code)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** A fresh key for this recovery code. */
export async function createBackupKey(recoveryCode: string): Promise<BackupKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(recoveryCode, salt);
  return { salt: toBase64(salt), key: toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key))) };
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** [format][12-byte IV][AES-GCM ciphertext of gzip(JSON)]. */
export async function sealBackup(snapshot: DataSnapshot, backupKey: BackupKey): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', fromBase64(backupKey.key), 'AES-GCM', false, ['encrypt']);
  const zipped = await pipe(new TextEncoder().encode(JSON.stringify(snapshot)), new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped));
  const out = new Uint8Array(1 + iv.length + sealed.length);
  out.set([FORMAT], 0);
  out.set(iv, 1);
  out.set(sealed, 1 + iv.length);
  return out;
}

/** The snapshot, or null if the code is wrong or the file is damaged. */
export async function openBackup(
  bytes: Uint8Array,
  recoveryCode: string,
  salt: string,
): Promise<DataSnapshot | null> {
  if (bytes[0] !== FORMAT) return null;
  try {
    const key = await derive(recoveryCode, fromBase64(salt));
    const iv = bytes.slice(1, 13);
    const zipped = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.slice(13)));
    const json = new TextDecoder().decode(await pipe(zipped, new DecompressionStream('gzip')));
    return JSON.parse(json) as DataSnapshot;
  } catch {
    return null;
  }
}

// ── Talking to the license server ────────────────────────────────────────

/** Upload tonight's sealed backup. Proves who it is with the signed license. */
export async function uploadBackup(sealed: Uint8Array<ArrayBuffer>, license: string, salt: string): Promise<void> {
  const response = await fetch(`${LICENSE_SERVER_URL}/api/backup`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-license': license, 'x-salt': salt },
    body: new Blob([sealed]),
  });
  if (!response.ok) throw new Error(`Cloud backup refused (${response.status}).`);
}

export interface CloudBackup {
  name: string;
  size: number;
  uploaded: number;
}

/** Backups held for a license, newest first. The license key is the proof. */
export async function listBackups(licenseKey: string): Promise<CloudBackup[]> {
  const response = await fetch(`${LICENSE_SERVER_URL}/api/backups`, { headers: { 'x-license-key': licenseKey } });
  const reply = (await response.json()) as { backups?: CloudBackup[]; error?: string };
  if (!reply.backups) throw new Error(reply.error ?? 'Could not list backups.');
  return reply.backups;
}

export async function downloadBackup(licenseKey: string, name: string): Promise<{ bytes: Uint8Array; salt: string }> {
  const response = await fetch(`${LICENSE_SERVER_URL}/api/backups/${encodeURIComponent(name)}`, {
    headers: { 'x-license-key': licenseKey },
  });
  const salt = response.headers.get('x-salt');
  if (!response.ok || !salt) throw new Error('Could not download that backup.');
  return { bytes: new Uint8Array(await response.arrayBuffer()), salt };
}
