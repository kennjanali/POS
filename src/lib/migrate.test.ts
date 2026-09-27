import { describe, expect, it } from 'vitest';

import { migrateOrderV7, migrateSnapshot } from './migrate';
import type { DataSnapshot } from './types';

/** A closed sale as the v7 build stored it. */
function v7Order(discount: Record<string, unknown>) {
  return {
    id: 'o1',
    invoiceNo: '00000-0000001',
    branchId: 'BR001',
    label: 'T1',
    type: 'dine-in',
    status: 'closed',
    openedAt: 1,
    closedAt: 2,
    lines: [],
    tenders: [],
    discountKind: 'none',
    customPercent: 20,
    diners: 1, eligibleDiners: 1,
    discountIdNo: null,
    discountIdName: null,
    grossCents: 50000,
    vatableCents: 0,
    vatExemptCents: 0,
    vatCents: 0,
    discountCents: 0,
    netCents: 50000,
    voidedReason: null,
    voidedAt: null,
    openedBy: null,
    servedBy: null,
    paidBy: null,
    voidedBy: null,
    ...discount,
  };
}

describe('migrateOrderV7', () => {
  it('turns a statutory sale into a legacy discount and keeps its frozen totals', () => {
    const v7 = v7Order({
      discountKind: 'senior',
      discountIdNo: 'SC-123456',
      discountIdName: 'Aling Nena',
      vatExemptCents: 44643,
      discountCents: 8929,
      netCents: 35714,
    });
    const order = migrateOrderV7(v7);
    expect(order.discount.kind).toBe('legacy');
    expect(order.netCents).toBe(35714);
    expect(order.discountCents).toBe(8929);
    expect(order.vatExemptCents).toBe(44643);
    expect(order.grossCents).toBe(50000);
    expect(order).not.toHaveProperty('discountKind');
    expect(order).not.toHaveProperty('discountIdNo');
  });

  it('turns a custom 15% discount into an owner discount', () => {
    const order = migrateOrderV7(v7Order({ discountKind: 'custom', customPercent: 15 }));
    expect(order.discount).toEqual({ kind: 'owner', percent: 15, fixedCents: null, by: null });
    expect(order).not.toHaveProperty('customPercent');
  });

  it('keeps no discount as none', () => {
    expect(migrateOrderV7(v7Order({})).discount).toEqual({ kind: 'none' });
  });
});

describe('migrateSnapshot', () => {
  it('brings a v7 backup to version 8, orders included', () => {
    const v7 = {
      version: 7,
      exportedAt: '2026-01-01T00:00:00.000Z',
      orders: [v7Order({ discountKind: 'custom', customPercent: 15 })],
    } as unknown as DataSnapshot;
    const s = migrateSnapshot(v7);
    expect(s.version).toBe(8);
    expect(s.orders[0]?.discount).toEqual({ kind: 'owner', percent: 15, fixedCents: null, by: null });
  });
});
