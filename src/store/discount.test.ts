import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import type { SaleDiscount } from '@/lib/types';
import { ownerShop, resetStore } from '@/test/store';
import { usePos } from './usePos';

const S = () => usePos.getState();

/** Open a sale with one ₱500 line, served. */
function ringUp500(): string {
  S().upsertProduct({
    id: 'p500',
    name: 'Item 500',
    unit: 'pc',
    priceCents: cents(50000),
    costCents: cents(20000),
    vatExempt: false,
    active: true,
  });
  const id = S().openOrder('T1', 'dine-in');
  S().addLine(id, 'p500');
  S().serveAll(id);
  return id;
}

/** The owner-discount setter is Task 12's; until then the field is set directly. */
function setDiscount(orderId: string, discount: SaleDiscount) {
  usePos.setState((s) => ({
    orders: s.orders.map((o) => (o.id === orderId ? { ...o, discount } : o)),
  }));
}

describe('sale discount', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
  });

  it('closes an owner 10% discount on ₱500 with ₱50 off', () => {
    const id = ringUp500();
    setDiscount(id, { kind: 'owner', percent: 10, fixedCents: null, by: null });
    S().addTender(id, {
      method: 'cash',
      amountCents: cents(45000),
      tenderedCents: cents(45000),
      changeCents: cents(0),
      refNo: null,
    });
    expect(S().closeOrder(id)).toBe(true);
    expect(S().order(id)?.discountCents).toBe(5000);
    expect(S().order(id)?.netCents).toBe(45000);
  });

  it('clearDiscount takes the discount off an open sale', () => {
    const id = ringUp500();
    setDiscount(id, { kind: 'owner', percent: 10, fixedCents: null, by: null });
    expect(S().clearDiscount(id)).toEqual({ ok: true });
    expect(S().order(id)?.discount).toEqual({ kind: 'none' });
  });
});
