/**
 * Promo codes.
 *
 * A code is typed by anyone at the counter, but only the owner makes one. The
 * percent is checked against the business date (Asia/Manila), not the wall
 * clock, so a code stays good for the whole of its last day and the tablet
 * works offline.
 */

import type { Promo } from './types';

/** Trim and uppercase, so " grand10 " is the same code as "GRAND10". */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

/** 3 to 12 characters, letters and digits only. */
export function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{3,12}$/.test(code);
}

export type PromoStatus = 'active' | 'scheduled' | 'expired' | 'off';

/**
 * Where a code stands on a given business date. `endsOn` is inclusive: a code
 * whose last day is today still works right up to midnight. A deactivated code
 * is always off, whatever its dates say.
 */
export function promoStatus(p: Promo, today: string): PromoStatus {
  if (!p.active) return 'off';
  if (p.startsOn !== null && today < p.startsOn) return 'scheduled';
  if (p.endsOn !== null && today > p.endsOn) return 'expired';
  return 'active';
}

/**
 * The code the cashier typed, or null when it does not exist or is not usable
 * today. The caller says so plainly and changes nothing.
 */
export function findUsablePromo(promos: readonly Promo[], input: string, today: string): Promo | null {
  const code = normalizeCode(input);
  if (!isValidCode(code)) return null;
  const match = promos.find((p) => p.code === code);
  if (!match || promoStatus(match, today) !== 'active') return null;
  return match;
}
