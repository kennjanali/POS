import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { ownerShop, resetStore } from '@/test/store';
import { orderGross, usePos } from './usePos';

const S = () => usePos.getState();

describe('service lines', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
  });

  it('never move stock when served, sold or cancelled', () => {
    S().upsertProduct({
      id: 'svc',
      name: 'Labor – per hour',
      kind: 'service',
      sku: null,
      category: 'Labor',
      unit: 'hour',
      priceCents: cents(30000),
      costCents: cents(0),
      vatExempt: false,
      active: true,
      reorderLevel: null,
    });
    const stockBefore = S().stock;
    const movesBefore = S().stockMoves;

    const id = S().openOrder('Job 1', 'walk-in');
    S().addLine(id, 'svc');
    S().serveAll(id);
    expect(S().order(id)?.lines[0]).toMatchObject({ kind: 'service', served: true });
    const due = orderGross(S().order(id)!);
    S().addTender(id, { method: 'cash', amountCents: due, tenderedCents: due, changeCents: cents(0), refNo: null });
    expect(S().closeOrder(id)).toEqual({ ok: true });
    expect(S().voidOrder(id, 'test')).toEqual({ ok: true });

    expect(S().stockMoves).toEqual(movesBefore);
    expect(S().stock).toEqual(stockBefore);
    expect(S().stock[S().activeBranchId]).not.toHaveProperty('svc');
  });
});
