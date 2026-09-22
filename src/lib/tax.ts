/**
 * Philippine tax + statutory discount engine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * The v6 build computed a Senior Citizen / PWD sale as:
 *
 *     discount = subtotal * 0.20
 *     vat      = (subtotal - discount) * 0.12     <-- charges VAT to an
 *     total    = subtotal - discount + vat            exempt customer
 *
 * That is wrong twice over. Under RA 9994 (Senior Citizens) and RA 10754
 * (PWD), the customer is EXEMPT from VAT *and* gets 20% off. RR 7-2010
 * fixes the order of operations: the 20% is computed on the amount
 * EXCLUSIVE of VAT.
 *
 *     vatExemptBase = grossVatInclusive / 1.12
 *     discount      = vatExemptBase * 0.20
 *     amountDue     = vatExemptBase - discount
 *
 * On a PHP 500.00 VAT-inclusive bill:
 *     v6 build ....... PHP 448.00   (overcharge of PHP 90.86)
 *     correct ........ PHP 357.14
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

import { type Centavos, addC, cents, roundCents, scale, subC } from './money';

export const STATUTORY_DISCOUNT_RATE = 0.2;

export type DiscountKind = 'none' | 'senior' | 'pwd' | 'custom';

/** A statutory discount is 20% + VAT exemption. A custom discount is neither. */
export const isStatutory = (kind: DiscountKind): boolean =>
  kind === 'senior' || kind === 'pwd';

export interface TaxProfile {
  /**
   * Is the business VAT-registered? A carinderia grossing under PHP 3M/year
   * is almost certainly NOT, and pays 3% percentage tax instead. The v6 build
   * force-enabled VAT in dbLoad() with no way to switch it off.
   */
  vatRegistered: boolean;
  /**
   * Are menu prices VAT-inclusive? On a carinderia menu board they always
   * are. The v6 build treated them as exclusive and added 12% on top.
   */
  pricesIncludeVat: boolean;
  /** 0.12 today. Stored as a ratio, not a percentage. */
  vatRate: number;
  vatLabel: string;
}

export interface DiscountRequest {
  kind: DiscountKind;
  /** Only read when kind === 'custom'. 0-100. */
  customPercent?: number;
  /**
   * Number of people sharing the bill, for a shared-bill statutory discount.
   * RR 7-2010: the bill is divided by the number of diners and the discount
   * applies only to the eligible person's share. Defaults to 1 (whole bill).
   */
  diners?: number;
  /** Eligible diners among `diners`. Defaults to 1. */
  eligibleDiners?: number;
}

export interface BillBreakdown {
  /** Sum of line items as entered, before anything is applied. */
  gross: Centavos;
  /** Portion of the sale subject to VAT (0 for a fully exempt sale). */
  vatableSale: Centavos;
  /** Portion of the sale exempt from VAT (statutory discounts). */
  vatExemptSale: Centavos;
  /** Output VAT actually collected. */
  vat: Centavos;
  /** Total discount granted. */
  discount: Centavos;
  /** What the customer hands over. */
  amountDue: Centavos;
  /**
   * Income-tax deduction the business may claim on a statutory discount
   * (RA 9994 / RA 10754). Equal to the VAT-exclusive price x 20%.
   */
  deductibleDiscount: Centavos;
  kind: DiscountKind;
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
  const rate = profile.vatRegistered ? profile.vatRate : 0;
  const trace: string[] = [];
  const zero = cents(0);

  // ── No discount ───────────────────────────────────────────────────────
  if (request.kind === 'none') {
    if (!profile.vatRegistered) {
      trace.push('Non-VAT registered — no output VAT.');
      return {
        gross,
        vatableSale: zero,
        vatExemptSale: zero,
        vat: zero,
        discount: zero,
        amountDue: gross,
        deductibleDiscount: zero,
        kind: 'none',
        trace,
      };
    }
    if (profile.pricesIncludeVat) {
      const base = stripVat(gross, rate);
      trace.push(`Prices are VAT-inclusive — base = gross / ${(1 + rate).toFixed(2)}`);
      return {
        gross,
        vatableSale: base,
        vatExemptSale: zero,
        vat: subC(gross, base),
        discount: zero,
        amountDue: gross,
        deductibleDiscount: zero,
        kind: 'none',
        trace,
      };
    }
    const vat = scale(gross, rate);
    trace.push(`Prices are VAT-exclusive — ${profile.vatLabel} added on top.`);
    return {
      gross,
      vatableSale: gross,
      vatExemptSale: zero,
      vat,
      discount: zero,
      amountDue: addC(gross, vat),
      deductibleDiscount: zero,
      kind: 'none',
      trace,
    };
  }

  // ── Custom discount: an ordinary commercial discount. Still VATable. ──
  if (request.kind === 'custom') {
    const pct = Math.min(100, Math.max(0, request.customPercent ?? 0));
    const discount = scale(gross, pct / 100);
    const discounted = subC(gross, discount);
    trace.push(`Custom ${pct}% discount applied to gross.`);

    if (!profile.vatRegistered) {
      return {
        gross,
        vatableSale: zero,
        vatExemptSale: zero,
        vat: zero,
        discount,
        amountDue: discounted,
        deductibleDiscount: zero,
        kind: 'custom',
        trace,
      };
    }
    if (profile.pricesIncludeVat) {
      const base = stripVat(discounted, rate);
      return {
        gross,
        vatableSale: base,
        vatExemptSale: zero,
        vat: subC(discounted, base),
        discount,
        amountDue: discounted,
        deductibleDiscount: zero,
        kind: 'custom',
        trace,
      };
    }
    const vat = scale(discounted, rate);
    return {
      gross,
      vatableSale: discounted,
      vatExemptSale: zero,
      vat,
      discount,
      amountDue: addC(discounted, vat),
      deductibleDiscount: zero,
      kind: 'custom',
      trace,
    };
  }

  // ── Statutory: Senior Citizen (RA 9994) / PWD (RA 10754) ─────────────
  // 20% discount + VAT exemption, discount computed on the VAT-EXCLUSIVE
  // amount. This is the branch the v6 build got wrong.

  const diners = Math.max(1, Math.floor(request.diners ?? 1));
  const eligible = Math.min(diners, Math.max(1, Math.floor(request.eligibleDiners ?? 1)));
  const eligibleShare = eligible / diners;

  if (diners > 1) {
    trace.push(
      `Shared bill: ${eligible} of ${diners} diners eligible (RR 7-2010) — ` +
        `discount applies to their share only.`,
    );
  }

  // Split gross into the eligible portion and the rest.
  const eligibleGross = scale(gross, eligibleShare);
  const otherGross = subC(gross, eligibleGross);

  // Step 1 — remove VAT from the eligible portion.
  let exemptBase: Centavos;
  if (!profile.vatRegistered) {
    // Non-VAT business: the whole selling price is already the exempt base.
    exemptBase = eligibleGross;
    trace.push('Non-VAT registered — selling price is the VAT-exempt base.');
  } else if (profile.pricesIncludeVat) {
    exemptBase = stripVat(eligibleGross, rate);
    trace.push(
      `Step 1 — remove ${profile.vatLabel}: eligible share / ${(1 + rate).toFixed(2)}`,
    );
  } else {
    exemptBase = eligibleGross;
    trace.push(`Step 1 — prices already exclude ${profile.vatLabel}; no VAT added.`);
  }

  // Step 2 — 20% off the VAT-exclusive base.
  const discount = scale(exemptBase, STATUTORY_DISCOUNT_RATE);
  trace.push('Step 2 — 20% statutory discount on the VAT-exclusive amount.');

  // Step 3 — amount due for the eligible share.
  const eligibleDue = subC(exemptBase, discount);
  trace.push('Step 3 — amount due = VAT-exclusive amount less the discount.');

  // The non-eligible share is billed normally.
  let otherVatable = cents(0);
  let otherVat = cents(0);
  let otherDue = otherGross;
  if (profile.vatRegistered && otherGross > 0) {
    if (profile.pricesIncludeVat) {
      otherVatable = stripVat(otherGross, rate);
      otherVat = subC(otherGross, otherVatable);
      otherDue = otherGross;
    } else {
      otherVatable = otherGross;
      otherVat = scale(otherGross, rate);
      otherDue = addC(otherGross, otherVat);
    }
  }

  return {
    gross,
    vatableSale: otherVatable,
    vatExemptSale: exemptBase,
    vat: otherVat,
    discount,
    amountDue: addC(eligibleDue, otherDue),
    // RA 9994 / RA 10754: the discount is deductible from gross income.
    deductibleDiscount: discount,
    kind: request.kind,
    trace,
  };
}
