/**
 * Issuing and reading licenses. The app verifies them with the public key it
 * ships (src/lib/license.ts); only this server can sign one.
 *
 * Format: base64url(JSON) + "." + base64url(Ed25519 signature of the first part).
 */

export interface LicenseFields {
  licenseId: string;
  businessName: string;
  installId: string;
  device: string;
  plan: string;
  issuedAt: string;
  updatesUntil: string;
}

const encoder = new TextEncoder();

const toBase64Url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

function keys(privateJwk: string) {
  const jwk = JSON.parse(privateJwk) as JsonWebKey;
  const { d: _secret, ...publicJwk } = jwk;
  return {
    sign: crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']),
    verify: crypto.subtle.importKey('jwk', publicJwk, { name: 'Ed25519' }, false, ['verify']),
  };
}

export async function signLicense(fields: LicenseFields, privateJwk: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(fields)));
  const signature = await crypto.subtle.sign('Ed25519', await keys(privateJwk).sign, encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/** The fields, if this server signed `text`; otherwise null. */
export async function readLicense(text: unknown, privateJwk: string): Promise<LicenseFields | null> {
  if (typeof text !== 'string') return null;
  const [payload, signature] = text.split('.');
  if (!payload || !signature) return null;
  try {
    const genuine = await crypto.subtle.verify(
      'Ed25519',
      await keys(privateJwk).verify,
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    return genuine ? (JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as LicenseFields) : null;
  } catch {
    return null;
  }
}

/** No 0/O or 1/I: keys are read out over the phone and typed by hand. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `ABCD-EFGH-JKLM-NPQR`. */
export function newLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

export function normalizeKey(key: unknown): string {
  return typeof key === 'string' ? key.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-') : '';
}
