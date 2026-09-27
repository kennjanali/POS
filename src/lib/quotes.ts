/**
 * Quotations.
 *
 * A quote is a promise about a price, dated. It never moves stock and never
 * counts as money taken; the only thing it does is become an order, at the
 * prices written on it.
 */

import type { Quote } from './types';

/** `Q-0001`, and `Q-10000` once there are more than four digits. */
export function nextQuoteNo(seq: number): string {
  return `Q-${String(seq).padStart(4, '0')}`;
}

/**
 * Where a quote stands on a given business date. A quote stops holding the day
 * after `validUntil`, so one dated today is still good today.
 */
export function quoteStatus(q: Quote, today: string): 'open' | 'expired' | 'converted' | 'cancelled' {
  if (q.status !== 'open') return q.status;
  return q.validUntil < today ? 'expired' : 'open';
}

/**
 * A `YYYY-MM-DD` business date some days on. Walks the calendar rather than
 * adding to the clock, so a quote made at 11pm still expires in the morning
 * and not a day early.
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

