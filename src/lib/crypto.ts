/**
 * PIN hashing.
 *
 * The raw six digits never leave this module: callers pass a PIN in and get a
 * credential out, or ask whether a PIN matches one. Nothing else in the app —
 * store, IndexedDB, sessionStorage, logs — ever sees the digits.
 *
 * PBKDF2-HMAC-SHA256 via Web Crypto, random 16-byte salt per user. A six-digit
 * PIN is only a million possibilities, so the salt stops one derivation from
 * answering for every user and the iteration count is what makes a stolen
 * IndexedDB file expensive to grind. It is not a substitute for the server-side
 * boundary; see the access-control note in the README.
 */

/** OWASP's PBKDF2-SHA256 floor is higher. Sign-in has to try every user's salt
 *  in turn on till hardware that may be a six-year-old tablet, so this is the
 *  point where the two curves cross. Stored per credential, so raising it later
 *  does not invalidate PINs already set. */
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export const PIN_LENGTH = 6;

export interface PinCredential {
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  iterations: number;
}

const DIGITS_ONLY = /^\d+$/;

export function isValidPin(pin: string): boolean {
  return pin.length === PIN_LENGTH && DIGITS_ONLY.test(pin);
}

function subtle(): SubtleCrypto {
  // crypto.subtle exists only in a secure context. Served over plain http on a
  // LAN address it is undefined, and a thrown string beats a silent no-op.
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('PIN security needs https or localhost. This page is not a secure context.');
  }
  return crypto.subtle;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await subtle().importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<PinCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, ITERATIONS);
  return { salt: toBase64(salt), hash: toBase64(hash), iterations: ITERATIONS };
}

export async function verifyPin(pin: string, credential: PinCredential): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  // Deliberately not wrapped in a try/catch. A missing crypto.subtle or a
  // corrupt stored credential is a fault the operator has to see and fix —
  // swallowing it here turns an unusable till into "Incorrect PIN" five times
  // over, followed by a lockout, with nothing on screen to explain why.
  const candidate = await derive(pin, fromBase64(credential.salt), credential.iterations);
  const expected = fromBase64(credential.hash);
  if (candidate.length !== expected.length) return false;
  // Constant-time compare. Mostly principle at this layer, but it costs nothing.
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= (candidate[i] ?? 0) ^ (expected[i] ?? 0);
  }
  return diff === 0;
}
