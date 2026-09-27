import { describe, expect, it } from 'vitest';

import { migrateMoveV7, migrateOrderV7, migrateSnapshot } from './migrate';
import type { DataSnapshot, Settings } from './types';

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

  it('counts line quantities in thousandths, as stock lines', () => {
    const line = { lineNo: 1, productId: 'p1', name: 'Coke', unitCents: 3500, qty: 2, served: true };
    const [migrated] = migrateOrderV7(v7Order({ lines: [line] })).lines;
    expect(migrated).toMatchObject({ qty: 2000, kind: 'stock', unit: '' });
  });
});

describe('migrateMoveV7', () => {
  it('counts a move in thousandths', () => {
    const move = { id: 'm1', branchId: 'BR001', productId: 'p1', delta: -2, reason: 'sale' };
    expect(migrateMoveV7(move).delta).toBe(-2000);
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

  it('counts a v7 backup’s stock in thousandths and gives its products a kind', () => {
    const v7 = {
      version: 7,
      exportedAt: '2026-01-01T00:00:00.000Z',
      products: [{ id: 'p1', name: 'Coke', unit: 'btl', priceCents: 3500, costCents: 2000, vatExempt: false, active: true }],
      orders: [],
      stock: { BR001: { p1: 5 } },
      stockMoves: [{ id: 'm1', branchId: 'BR001', productId: 'p1', delta: 5, reason: 'opening' }],
      settings: { lowStockAt: 10 } as Settings,
    } as unknown as DataSnapshot;
    const s = migrateSnapshot(v7);
    expect(s.stock.BR001?.p1).toBe(5000);
    expect(s.stockMoves[0]?.delta).toBe(5000);
    expect(s.settings.lowStockAt).toBe(10000);
    expect(s.products[0]).toMatchObject({ kind: 'stock', sku: null, category: '', reorderLevel: null });
  });
});
