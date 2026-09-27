/**
 * Tax and discount engine.
 *
 * One discount per sale: none, a percent off, or a fixed peso amount off,
 * always taken off the gross. VAT is shop-level: on a VAT-registered shop the
 * prices already include VAT, so VAT is worked out of the discounted price,
 * never added on top.
 */

import { type Centavos, cents, roundCents, scale, subC } from './money';

export interface TaxProfile {
  /**
   * Is the business VAT-registered? A carinderia grossing under PHP 3M/year
   * is almost certainly NOT, and pays 3% percentage tax instead. The v6 build
   * force-enabled VAT in dbLoad() with no way to switch it off.
   */
  vatRegistered: boolean;
  /** 0.12 today. Stored as a ratio, not a percentage. */
  vatRate: number;
  vatLabel: string;
}

export type DiscountRequest =
  | { kind: 'none' }
  | {
      kind: 'percent';
      /** 0-100; anything outside is clamped. */
      percent: number;
    }
  | {
      kind: 'fixed';
      /** Capped at the gross. */
      cents: Centavos;
    };

export interface BillBreakdown {
  /** Sum of line items as entered, before anything is applied. */
  gross: Centavos;
  /** The discounted price without its VAT (0 on a non-VAT shop). */
  vatableSale: Centavos;
  /** VAT included in the amount due. */
  vat: Centavos;
  /** Total discount granted. */
  discount: Centavos;
  /** What the customer hands over. */
  amountDue: Centavos;
  /** Human-readable trace of each step. Rendered in the bill drawer. */
  trace: string[];
}

/**
 * Strip VAT out of a VAT-inclusive amount.
 *   base = gross / (1 + rate)
 */
function stripVat(gross: Centavos, rate: number): Centavos {
  return roundCents(gross / (1 + rate));
}

export function computeBill(
  gross: Centavos,
  profile: TaxProfile,
  request: DiscountRequest = { kind: 'none' },
): BillBreakdown {
  const trace: string[] = [];
  let discount = cents(0);
  if (request.kind === 'percent') {
    const pct = Math.min(100, Math.max(0, request.percent));
    discount = scale(gross, pct / 100);
    trace.push(`${pct}% discount applied to gross.`);
  } else if (request.kind === 'fixed') {
    discount = cents(Math.min(Math.max(0, request.cents), gross));
    trace.push('Fixed discount applied to gross.');
  }
  const discounted = subC(gross, discount);

  if (!profile.vatRegistered) {
    trace.push('Non-VAT registered — no output VAT.');
    return {
      gross,
      vatableSale: cents(0),
      vat: cents(0),
      discount,
      amountDue: discounted,
      trace,
    };
  }

  const rate = profile.vatRate;
  const base = stripVat(discounted, rate);
  trace.push(`Prices include ${profile.vatLabel} — base = price / ${(1 + rate).toFixed(2)}`);
  return {
    gross,
    vatableSale: base,
    vat: subC(discounted, base),
    discount,
    amountDue: discounted,
    trace,
  };
}
