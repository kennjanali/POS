/**
 * UUIDv7 — time-ordered, so it sorts chronologically and keeps Postgres
 * B-tree inserts local instead of scattering them across the index the way
 * UUIDv4 does. Replaces v6's `Date.now() + Math.random().slice(2,6)`, which
 * had only ~1.7M distinct suffixes per millisecond.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ms = Date.now();
  bytes[0] = (ms / 0x10000000000) & 0xff;
  bytes[1] = (ms / 0x100000000) & 0xff;
  bytes[2] = (ms / 0x1000000) & 0xff;
  bytes[3] = (ms / 0x10000) & 0xff;
  bytes[4] = (ms / 0x100) & 0xff;
  bytes[5] = ms & 0xff;

  // version 7
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // RFC 4122 variant
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}
