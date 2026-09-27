/**
 * The figures the Today screen shows. One place, so the tiles on the screen and
 * the day's close always say the same thing about the same day.
 */

import { businessDate } from './format';
import { cents, type Centavos } from './money';
import { TENDER_METHODS, type Order, type TenderMethod } from './types';

export interface DaySummary {
  /** Sales settled on this day. */
  sales: number;
  gross: Centavos;
  /** Of the discount given, the part a promo code gave away. */
  promoDiscount: Centavos;
  /** Of the discount given, the part the owner gave away. */
  ownerDiscount: Centavos;
  net: Centavos;
  /** Sales cancelled on this day, however they were paid. */
  cancelled: number;
  cancelledCents: Centavos;
  /** Output VAT on the sales, as it was frozen on them. */
  vat: Centavos;
  collected: Record<TenderMethod, Centavos>;
  collectedTotal: Centavos;
  /** What the till should hold: the cash taken today. */
  expectedCash: Centavos;
}

/**
 * One day's figures. A sale belongs to the day it was paid, and a cancellation
 * to the day it was cancelled — the same rule the report and the close use, so
 * a void never erases a day it did not happen on.
 */
export function daySummary(orders: Order[], day: string): DaySummary {
  const collected = Object.fromEntries(TENDER_METHODS.map((m) => [m, 0])) as Record<TenderMethod, number>;

  let sales = 0;
  let gross = 0;
  let promoDiscount = 0;
  let ownerDiscount = 0;
  let net = 0;
  let vat = 0;
  let cancelled = 0;
  let cancelledCents = 0;

  for (const order of orders) {
    if (order.status === 'closed' && order.closedAt !== null && businessDate(order.closedAt) === day) {
      sales += 1;
      gross += order.grossCents;
      net += order.netCents;
      vat += order.vatCents;
      // A legacy discount is neither the owner's nor a promo's, so it is in
      // neither bucket rather than in the wrong one.
      if (order.discount.kind === 'promo') promoDiscount += order.discountCents;
      if (order.discount.kind === 'owner') ownerDiscount += order.discountCents;
      for (const tender of order.tenders) collected[tender.method] += tender.amountCents;
    } else if (
      order.status === 'voided' &&
      businessDate(order.voidedAt ?? order.closedAt ?? order.openedAt) === day
    ) {
      cancelled += 1;
      cancelledCents += order.netCents;
    }
  }

  const collectedTotal = cents(
    TENDER_METHODS.reduce((total, m) => total + collected[m], 0),
  );

  return {
    sales,
    gross: cents(gross),
    promoDiscount: cents(promoDiscount),
    ownerDiscount: cents(ownerDiscount),
    net: cents(net),
    cancelled,
    cancelledCents: cents(cancelledCents),
    vat: cents(vat),
    collected: Object.fromEntries(
      TENDER_METHODS.map((m) => [m, cents(collected[m])]),
    ) as Record<TenderMethod, Centavos>,
    collectedTotal,
    expectedCash: cents(collected.cash),
  };
}
