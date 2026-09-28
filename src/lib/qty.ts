/**
 * Quantities are ALWAYS an integer number of thousandths: 2.5 m is 2500, one
 * piece is 1000. Like centavos, so quantity maths never touches a float.
 */

import type { Features } from './features';
import { roundCents, type Centavos } from './money';

/** Branded type so a raw count can't be passed where thousandths are expected. */
export type Qty = number & { readonly __brand: 'Qty' };

export const QTY_ONE = 1000 as Qty;

/** Units sold by measure. Only these ever take a decimal quantity. */
export const MEASURED_UNITS: readonly string[] = ['m', 'kg'];

/** Whole or decimal units as thousandths, rounded to the nearest one. */
export function qty(units: number): Qty {
  return Math.round(units * 1000) as Qty;
}

/** A decimal quantity only for a measured unit, and only with the switch on. */
export function decimalsAllowed(unit: string, features: Features): boolean {
  return features.measuredUnits && MEASURED_UNITS.includes(unit);
}

/**
 * A typed quantity ("3", "2.5", "0.75") as thousandths, or null if it is not
 * one: zero, negative, a comma, more than 3 decimals, or any decimal at all
 * when `decimals` is off. Read digit by digit, never through a float.
 */
export function parseQty(input: string, decimals: boolean): Qty | null {
  const match = /^(\d*)(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!match) return null;
  const [, whole = '', fraction] = match;
  if (fraction !== undefined && !decimals) return null;
  if (whole === '' && fraction === undefined) return null;
  const q = Number(whole || '0') * 1000 + Number((fraction ?? '').padEnd(3, '0'));
  return q > 0 && Number.isSafeInteger(q) ? (q as Qty) : null;
}

/** 2500 → "2.5", 3000 → "3", 750 → "0.75". */
export function formatQty(q: Qty): string {
  const sign = q < 0 ? '-' : '';
  const abs = Math.abs(q);
  const fraction = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${Math.floor(abs / 1000)}${fraction ? `.${fraction}` : ''}`;
}

/** Unit price × quantity, rounded half-up to the centavo. */
export function lineTotal(unit: Centavos, q: Qty): Centavos {
  return roundCents((unit * q) / 1000);
}
