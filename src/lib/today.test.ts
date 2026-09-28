import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { QTY_ONE } from '@/lib/qty';
import { businessDate } from '@/lib/format';
import { renderClose } from '@/lib/receipt';
import { daySummary } from '@/lib/today';
import type { Order, SaleDiscount, TenderMethod } from '@/lib/types';
import { ownerShop, resetStore } from '@/test/store';
import { usePos } from '@/store/usePos';

/** Local midday, so the business date is the same wherever the suite runs. */
const DAY = '2026-01-15';
const AT = new Date(2026, 0, 15, 12, 0, 0).getTime();
const TOMORROW = new Date(2026, 0, 16, 12, 0, 0).getTime();

/** A settled sale, written into the store the way the till leaves it. */
function seed(over: { id: string } & Partial<Order>): Order {
  const s = usePos.getState();
  const product = s.products[0]!;
  const order: Order = {
    invoiceNo: String(s.orders.length + 1),
    branchId: s.activeBranchId!,
    label: 'Table 1',
    type: 'dine-in',
    status: 'closed',
    customerName: null,
    customerPhone: null,
    vehiclePlate: null,
    fromQuoteId: null,
    openedAt: AT,
    closedAt: AT,
    lines: [
      {
        lineNo: 1,
        productId: product.id,
        name: product.name,
        unitCents: cents(100_000),
        costCents: cents(60_000),
        kind: product.kind,
        unit: product.unit,
        qty: QTY_ONE,
        served: true,
        servedAt: AT,
        voided: false,
        voidReason: null,
      },
    ],
    tenders: [],
    discount: { kind: 'none' },
    grossCents: cents(100_000),
    vatableCents: cents(0),
    vatExemptCents: cents(0),
    vatCents: cents(0),
    discountCents: cents(0),
    netCents: cents(100_000),
    voidedReason: null,
    voidedAt: null,
    openedBy: null,
    servedBy: null,
    paidBy: null,
    voidedBy: null,
    ...over,
  };
  usePos.setState((state) => ({ orders: [...state.orders, order] }));
  return order;
}

/** Settle a seeded sale, the cash or the wallet taking the amount due. */
function pay(id: string, method: TenderMethod, amountCents: number): void {
  usePos.setState((s) => ({
    orders: s.orders.map((o) =>
      o.id === id
        ? {
            ...o,
            tenders: [
              ...o.tenders,
              {
                id: `${o.id}-t`,
                method,
                amountCents: cents(amountCents),
                tenderedCents: method === 'cash' ? cents(amountCents) : null,
                changeCents: method === 'cash' ? cents(0) : null,
                refNo: null,
                takenAt: AT,
              },
            ],
          }
        : o,
    ),
  }));
}

const PROMO: SaleDiscount = { kind: 'promo', promoId: 'p1', code: 'GRAND10', percent: 10 };
const OWNER: SaleDiscount = { kind: 'owner', percent: null, fixedCents: cents(10_000), by: 'Owner' };

describe('daySummary', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    usePos.setState(() => ({ orders: [], closes: [] }));
  });

  it('counts the day\u2019s paid sales and what was collected', () => {
    seed({ id: 'a', grossCents: cents(50_000), discountCents: cents(5_000), netCents: cents(45_000) });
    pay('a', 'cash', 45_000);
    seed({ id: 'b', grossCents: cents(30_000), netCents: cents(30_000) });
    pay('b', 'gcash', 30_000);

    const s = daySummary(usePos.getState().orders, DAY);

    expect(s.sales).toBe(2);
    expect(s.gross).toBe(80_000);
    expect(s.net).toBe(75_000);
    expect(s.collected.cash).toBe(45_000);
    expect(s.collected.gcash).toBe(30_000);
    expect(s.collected.maya).toBe(0);
    expect(s.collectedTotal).toBe(75_000);
    expect(s.expectedCash).toBe(45_000);
    expect(s.cancelled).toBe(0);
    expect(s.cancelledCents).toBe(0);
  });

  it('splits a promo discount from an owner discount', () => {
    seed({ id: 'a', discountCents: cents(5_000), netCents: cents(45_000), discount: PROMO });
    seed({ id: 'b', discountCents: cents(10_000), netCents: cents(90_000), discount: OWNER });

    const s = daySummary(usePos.getState().orders, DAY);

    expect(s.promoDiscount).toBe(5_000);
    expect(s.ownerDiscount).toBe(10_000);
  });

  it('leaves a legacy discount out of both buckets', () => {
    seed({ id: 'a', discountCents: cents(5_000), netCents: cents(45_000), discount: { kind: 'legacy' } });

    const s = daySummary(usePos.getState().orders, DAY);

    expect(s.promoDiscount).toBe(0);
    expect(s.ownerDiscount).toBe(0);
    expect(s.net).toBe(45_000);
  });

  it('counts a sale voided today as a cancellation, not as a sale', () => {
    seed({
      id: 'a',
      status: 'voided',
      netCents: cents(20_000),
      voidedReason: 'Wrong table',
      voidedAt: new Date(2026, 0, 15, 14, 0, 0).getTime(),
    });

    const s = daySummary(usePos.getState().orders, DAY);

    expect(s.sales).toBe(0);
    expect(s.net).toBe(0);
    expect(s.collectedTotal).toBe(0);
    expect(s.cancelled).toBe(1);
    expect(s.cancelledCents).toBe(20_000);
  });

  it('totals the output VAT frozen on the sales', () => {
    seed({ id: 'a', vatableCents: cents(112_000), vatCents: cents(12_000) });

    expect(daySummary(usePos.getState().orders, DAY).vat).toBe(12_000);
  });

  it('ignores a sale settled on another day', () => {
    seed({ id: 'a', closedAt: TOMORROW });

    expect(daySummary(usePos.getState().orders, DAY).sales).toBe(0);
  });

  it('counts an open table as neither a sale nor a cancellation', () => {
    seed({ id: 'a', status: 'open', closedAt: null, netCents: cents(0) });

    const s = daySummary(usePos.getState().orders, DAY);

    expect(s.sales).toBe(0);
    expect(s.cancelled).toBe(0);
  });
});

describe('daySummary through the till (the plan scenario)', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
  });

  const S = () => usePos.getState();

  function item(id: string, pesos: number) {
    S().upsertProduct({
      id,
      name: id,
      kind: 'service',
      sku: null,
      category: '',
      unit: 'job',
      priceCents: cents(pesos * 100),
      costCents: cents(0),
      vatExempt: false,
      active: true,
      reorderLevel: null,
    });
  }

  function sale(productId: string): string {
    const id = S().openOrder('Walk-in', 'walk-in');
    S().addLine(id, productId);
    S().serveAll(id);
    return id;
  }

  it('₱500 cash with a 10% promo, ₱300 GCash, one cancelled: net 75000, promo 5000', () => {
    item('five', 500);
    item('three', 300);
    expect(S().createPromo({ code: 'GRAND10', percent: 10 }).ok).toBe(true);

    const a = sale('five');
    expect(S().applyPromo(a, 'GRAND10').ok).toBe(true);
    expect(S().payExact(a, 'cash').ok).toBe(true);
    const b = sale('three');
    expect(S().payExact(b, 'gcash', '1234567890').ok).toBe(true);
    const c = sale('three');
    expect(S().payExact(c, 'cash').ok).toBe(true);
    expect(S().voidOrder(c, 'wrong item').ok).toBe(true);

    const day = daySummary(S().orders, businessDate(Date.now()));
    expect(day.net).toBe(75000);
    expect(day.promoDiscount).toBe(5000);
    expect(day.collected.cash).toBe(45000);
    expect(day.collected.gcash).toBe(30000);
    expect(day.cancelled).toBe(1);
    expect(day.expectedCash).toBe(45000);
  });

  it('a ₱1,120 sale on a VAT-registered shop gives vat 12000', () => {
    usePos.setState((s) => ({ settings: { ...s.settings, vatRegistered: true } }));
    item('big', 1120);
    expect(S().payExact(sale('big'), 'cash').ok).toBe(true);
    expect(daySummary(S().orders, businessDate(Date.now())).vat).toBe(12000);
  });

  it("refuses a negative count, and the slip reads Today's summary", async () => {
    item('three', 300);
    expect(S().payExact(sale('three'), 'cash').ok).toBe(true);
    expect(await S().closeDay(cents(-100))).toBeNull();

    const close = await S().closeDay(cents(30000));
    expect(close?.countedCashCents).toBe(30000);
    const slip = renderClose(close!, S().settings);
    expect(slip).toContain("TODAY'S SUMMARY #");
    expect(slip).not.toMatch(/daily close|output vat/i);
  });
});
