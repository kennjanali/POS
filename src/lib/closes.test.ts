import { describe, expect, it } from 'vitest';

import { brokenLink, buildClose, signClose } from '@/lib/closes';
import { cents, parsePesos, type Centavos } from '@/lib/money';
import { QTY_ONE } from '@/lib/qty';
import type { DailyClose, Order } from '@/lib/types';
import { ownerShop, resetStore } from '@/test/store';
import { usePos } from '@/store/usePos';

type Unsigned = Omit<DailyClose, 'hash'>;

const AT = new Date(2026, 0, 15, 21, 0, 0).getTime();
const LATER = new Date(2026, 0, 15, 22, 0, 0).getTime();

/** A settled sale the way the till leaves it: the cash taken matches the net. */
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
    openedAt: AT - 60_000,
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
        servedAt: AT - 60_000,
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
  if (!over.tenders) {
    order.tenders = [
      {
        id: `${order.id}-t`,
        method: 'cash',
        amountCents: order.netCents,
        tenderedCents: order.netCents,
        changeCents: cents(0),
        refNo: null,
        takenAt: AT,
      },
    ];
  }
  usePos.setState((state) => ({ orders: [...state.orders, order] }));
  return order;
}

/** A close in the shape every close before this task was written. */
function asFormat1(close: Unsigned): Unsigned {
  const rest = { ...close };
  delete rest.format;
  delete rest.promoDiscountCents;
  delete rest.ownerDiscountCents;
  delete rest.vatCents;
  delete rest.expectedCashCents;
  delete rest.countedCashCents;
  return rest as Unsigned;
}

async function fresh(): Promise<void> {
  resetStore();
  await ownerShop();
  usePos.setState(() => ({ orders: [], closes: [] }));
}

const closeOf = (previous: DailyClose | null, now: number, countedCashCents?: Centavos) =>
  signClose(
    buildClose({
      id: `c${now}`,
      orders: usePos.getState().orders,
      previous,
      now,
      actor: null,
      countedCashCents,
    }),
  );

describe('close format 2', () => {
  it('splits the discount, freezes VAT, and states the expected cash', async () => {
    await fresh();
    seed({
      id: 'a',
      discountCents: cents(5_000),
      netCents: cents(95_000),
      vatCents: cents(12_000),
      discount: { kind: 'promo', promoId: 'p', code: 'TEN', percent: 5 },
    });
    seed({
      id: 'b',
      discountCents: cents(10_000),
      netCents: cents(90_000),
      discount: { kind: 'owner', percent: null, fixedCents: cents(10_000), by: 'Owner' },
    });

    const close = await closeOf(null, LATER);

    expect(close.format).toBe(2);
    expect(close.promoDiscountCents).toBe(5_000);
    expect(close.ownerDiscountCents).toBe(10_000);
    expect(close.vatCents).toBe(12_000);
    // Both sales went through the till; ₱15,000 of that was given away.
    expect(close.expectedCashCents).toBe(185_000);
    expect(close.countedCashCents).toBeNull();
  });

  it('carries the counted cash the owner entered', async () => {
    await fresh();
    seed({ id: 'a' });

    const close = await closeOf(null, LATER, parsePesos('995'));

    expect(close.countedCashCents).toBe(99_500);
  });

  it('leaves the counted cash null when the day closes by itself', async () => {
    await fresh();
    seed({ id: 'a' });

    const close = await closeOf(null, LATER);

    expect(close.countedCashCents).toBeNull();
  });

  it('expected cash is only what went through the till, not the whole sale', async () => {
    await fresh();
    seed({ id: 'a' });
    seed({
      id: 'b',
      netCents: cents(30_000),
      tenders: [
        {
          id: 'b-t',
          method: 'gcash',
          amountCents: cents(30_000),
          tenderedCents: null,
          changeCents: null,
          refNo: 'G-1',
          takenAt: AT,
        },
      ],
    });

    const close = await closeOf(null, LATER);

    expect(close.netCents).toBe(130_000);
    expect(close.tenders.gcash).toBe(30_000);
    expect(close.expectedCashCents).toBe(100_000);
  });
});

describe('close chain', () => {
  it('verifies a chain whose older close was written before the new fields', async () => {
    await fresh();
    seed({ id: 'a' });
    const first = await closeOf(null, AT);
    const legacy = await signClose(asFormat1(first));
    expect(legacy.format).toBeUndefined();

    seed({ id: 'b' });
    const second = await closeOf(legacy, LATER);

    expect(await brokenLink([legacy, second])).toBeNull();
  });

  it('shows an edited expected cash figure as a broken chain', async () => {
    await fresh();
    seed({ id: 'a' });
    const close = await closeOf(null, AT);

    const edited = { ...close, expectedCashCents: cents(1) };

    expect(await brokenLink([edited])).toBe(close.no);
  });

  it('shows a deleted close as a broken chain', async () => {
    await fresh();
    seed({ id: 'a' });
    const first = await closeOf(null, AT);
    seed({ id: 'b' });
    const second = await closeOf(first, LATER);

    // Reported by the close that no longer adds up, which is the second one:
    // it is numbered 2 but sits where 1 should be.
    expect(await brokenLink([second])).toBe(2);
  });
});
