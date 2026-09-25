/**
 * The license: who bought this install, bound to this install and tablet,
 * signed by the license server. Checked offline on every launch — a shop
 * without internet must never be locked out of its own till.
 *
 * Format: base64url(JSON payload) + "." + base64url(Ed25519 signature over
 * that first part). Only the server holds the private key; the public key
 * below can verify but never forge.
 */

import { ed25519 } from '@noble/curves/ed25519.js';

const PUBLIC_KEY = 'TCRETdfXBY9lY0jL7ilH-q95we02gIl2BJLtiSYt4Gk';

export interface License {
  licenseId: string;
  businessName: string;
  installId: string;
  /** SHA-256 of the tablet's device id (see device.ts). */
  device: string;
  plan: string;
  /** ISO dates. */
  issuedAt: string;
  updatesUntil: string;
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * The license, if `text` is genuine and was issued for this install on this
 * tablet; otherwise null. Never throws — a corrupt license is simply no
 * license, and the till keeps working in training mode.
 */
export function verifyLicense(
  text: string | null,
  expected: { installId: string | null; device: string | null },
  publicKey: string = PUBLIC_KEY,
): License | null {
  if (!text || !expected.installId || !expected.device) return null;
  try {
    const [payload, signature] = text.trim().split('.');
    if (!payload || !signature) return null;
    const genuine = ed25519.verify(
      fromBase64Url(signature),
      new TextEncoder().encode(payload),
      fromBase64Url(publicKey),
    );
    if (!genuine) return null;
    const license = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as License;
    if (license.installId !== expected.installId || license.device !== expected.device) return null;
    return license;
  } catch {
    return null;
  }
}
