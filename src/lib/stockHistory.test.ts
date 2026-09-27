import { describe, expect, it } from 'vitest';

import { qty } from './qty';
import { productHistory, UPGRADE_RESET_NOTE } from './stockHistory';
import type { Order, StockMove, User } from './types';

function move(fields: Partial<StockMove> & Pick<StockMove, 'id' | 'delta' | 'reason' | 'at'>): StockMove {
  return {
    branchId: 'B1',
    productId: 'p',
    refOrderId: null,
    note: null,
    actorUserId: null,
    supplier: null,
    docNo: null,
    unitCostCents: null,
    ...fields,
  } as StockMove;
}

const users = [{ id: 'u1', name: 'Juan' }] as User[];
const orders = [{ id: 'o1', invoiceNo: 'B1-0000142' }] as Order[];

describe('productHistory', () => {
  const moves = [
    move({ id: 'm1', delta: qty(20), reason: 'restock', at: 100, actorUserId: 'u1', supplier: 'Acme', docNo: 'DR-7' }),
    move({ id: 'm2', delta: qty(-4), reason: 'sale', at: 300, refOrderId: 'o1' }),
    move({ id: 'm3', delta: qty(-1), reason: 'spoilage', at: 200, note: 'dropped' }),
    move({ id: 'm4', delta: qty(5), reason: 'count', at: 50, note: UPGRADE_RESET_NOTE }),
    move({ id: 'x1', delta: qty(9), reason: 'restock', at: 400, productId: 'other' }),
    move({ id: 'x2', delta: qty(9), reason: 'restock', at: 500, branchId: 'B2' }),
  ];

  it('lists only this product in this branch, newest first', () => {
    expect(productHistory(moves, orders, users, 'p', 'B1').map((r) => r.id)).toEqual(['m2', 'm3', 'm1', 'm4']);
  });

  it('says what each move was, who made it and which sale it was', () => {
    const rows = productHistory(moves, orders, users, 'p', 'B1');
    expect(rows[0]).toMatchObject({ label: 'Sale', delta: qty(-4), saleNo: 'B1-0000142', who: '—' });
    expect(rows[1]).toMatchObject({ label: 'Damage', note: 'dropped', saleNo: null });
    expect(rows[2]).toMatchObject({ label: 'Add stock', who: 'Juan', supplier: 'Acme', docNo: 'DR-7' });
    expect(rows[3]).toMatchObject({ label: 'Upgrade reset' });
  });
});
