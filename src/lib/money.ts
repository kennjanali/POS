/**
 * Money is ALWAYS an integer number of centavos.
 *
 * The v6 build accumulated `price * qty` in JS floats and rounded
 * inconsistently, so the dashboard total and the sum of receipts drifted
 * apart. Nothing in this codebase stores a peso float. Ever.
 */

/** Branded type so a raw number can't be passed where centavos are expected. */
export type Centavos = number & { readonly __brand: 'Centavos' };

export const cents = (n: number): Centavos => Math.round(n) as Centavos;

/** Parse a user-typed peso string ("89", "89.50", "1,234.5") into centavos. */
export function parsePesos(input: string | number): Centavos {
  if (typeof input === 'number') return cents(input * 100);
  const cleaned = input.replace(/[^0-9.-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? cents(value * 100) : cents(0);
}

/** Round-half-up. Banker's rounding surprises cashiers; half-up matches receipts. */
export function roundCents(value: number): Centavos {
  return (value < 0 ? -Math.round(-value) : Math.round(value)) as Centavos;
}

/** Multiply centavos by a unitless ratio (e.g. 0.20 discount) and round. */
export function scale(amount: Centavos, ratio: number): Centavos {
  return roundCents(amount * ratio);
}

export const addC = (...values: Centavos[]): Centavos =>
  values.reduce<number>((a, b) => a + b, 0) as Centavos;

export const subC = (a: Centavos, b: Centavos): Centavos => (a - b) as Centavos;

export const mulQty = (unit: Centavos, qty: number): Centavos =>
  (unit * qty) as Centavos;
