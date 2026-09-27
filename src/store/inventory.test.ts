import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { applyPreset } from '@/lib/presets';
import { qty, type Qty } from '@/lib/qty';
import { computeBill } from '@/lib/tax';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore, signInAs } from '@/test/store';
import { orderGross, usePos } from './usePos';

const S = () => usePos.getState();

function item(id: string, reorderLevel: Qty | null = null): Product {
  return {
    id,
    name: `Item ${id}`,
    kind: 'stock',
    sku: null,
    category: '',
    unit: 'pcs',
    priceCents: cents(10000),
    costCents: cents(4000),
    vatExempt: false,
    active: true,
    reorderLevel,
  };
}

function receive(productId: string, units: number) {
  return S().receiveStock({ lines: [{ productId, qty: qty(units) }] });
}

/** Sell `units` of the product and pay exactly, in cash. */
function sell(productId: string, units: number) {
  const id = S().openOrder('Walk-in', 'walk-in');
  expect(S().addLine(id, productId, qty(units))).toEqual({ ok: true });
  const due = computeBill(orderGross(S().order(id)!), S().settings, { kind: 'none' }).amountDue;
  S().addTender(id, { method: 'cash', amountCents: due, tenderedCents: due, changeCents: cents(0), refNo: null });
  expect(S().closeOrder(id)).toEqual({ ok: true });
  return id;
}

describe('inventory', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    usePos.setState((s) => ({ settings: { ...s.settings, shopType: 'retail', features: applyPreset('retail') } }));
    S().upsertProduct(item('w'));
  });

  it('receives stock at a new cost; a closed sale keeps its cost', () => {
    receive('w', 5);
    const sale = sell('w', 1);
    const before = S().stockOf('w');

    expect(
      S().receiveStock({
        lines: [{ productId: 'w', qty: qty(20), unitCostCents: cents(45000) }],
        supplier: 'Acme',
        docNo: 'DR-7',
      }),
    ).toEqual({ ok: true });

    expect(S().stockOf('w')).toBe(before + 20000);
    expect(S().product('w')?.costCents).toBe(45000);
    expect(S().order(sale)?.lines[0]?.costCents).toBe(4000);
    expect(S().stockMoves[0]).toMatchObject({
      productId: 'w',
      delta: 20000,
      reason: 'restock',
      supplier: 'Acme',
      docNo: 'DR-7',
      unitCostCents: 45000,
    });
  });

  it('refuses the same item twice in one delivery', () => {
    expect(
      S().receiveStock({
        lines: [
          { productId: 'w', qty: qty(1) },
          { productId: 'w', qty: qty(2) },
        ],
      }),
    ).toEqual({ ok: false, error: 'Each item can only be listed once.' });
    expect(S().stockOf('w')).toBe(0);
  });

  it('writes the difference of a count as a count move', () => {
    receive('w', 10);
    expect(S().countStock('w', qty(7))).toEqual({ ok: true });
    expect(S().stockOf('w')).toBe(qty(7));
    expect(S().stockMoves[0]).toMatchObject({ productId: 'w', delta: -3000, reason: 'count' });
  });

  it('refuses damage beyond on hand', () => {
    receive('w', 2);
    const moves = S().stockMoves;
    expect(S().recordDamage('w', qty(3), 'dropped')).toMatchObject({ ok: false });
    expect(S().stockOf('w')).toBe(qty(2));
    expect(S().stockMoves).toBe(moves);

    expect(S().recordDamage('w', qty(2), 'dropped')).toEqual({ ok: true });
    expect(S().stockMoves[0]).toMatchObject({ delta: -2000, reason: 'spoilage', note: 'dropped' });
  });

  it('refuses staff receiving stock', () => {
    signInAs('staff');
    expect(receive('w', 5)).toEqual({ ok: false, error: 'Only the owner can do that.' });
    expect(S().stockOf('w')).toBe(0);
  });

  it('sells a quick-added item', () => {
    const service = S().quickAddProduct({
      name: 'Labor – per hour',
      priceCents: cents(30000),
      kind: 'service',
      unit: 'hour',
      openingQty: qty(0),
    });
    const stocked = S().quickAddProduct({
      name: 'Tire patch',
      priceCents: cents(5000),
      kind: 'stock',
      unit: 'pcs',
      openingQty: qty(5),
    });
    if (!service.ok || !stocked.ok) throw new Error('quick add refused');

    const id = S().openOrder('Walk-in', 'walk-in');
    expect(S().addLine(id, service.id)).toEqual({ ok: true });
    expect(S().addLine(id, stocked.id, qty(5))).toEqual({ ok: true });
    expect(S().stockOf(stocked.id)).toBe(qty(5));
  });

  it('lists low stock most urgent first', () => {
    for (const [id, units] of [['a', 4], ['b', 1], ['c', 20]] as const) {
      S().upsertProduct(item(id, qty(10)));
      receive(id, units);
    }
    const mine = S().lowStock().filter((r) => ['a', 'b', 'c'].includes(r.productId));
    expect(mine).toEqual([
      { productId: 'b', available: qty(1), level: qty(10) },
      { productId: 'a', available: qty(4), level: qty(10) },
    ]);
  });

  it('alerts once when a sale crosses the reorder level; only dismiss clears it', () => {
    S().upsertProduct(item('w', qty(10)));
    receive('w', 11);
    expect(S().lowStockAlerts).toEqual([]);

    sell('w', 1);
    expect(S().lowStockAlerts).toEqual(['w']);
    sell('w', 1);
    expect(S().lowStockAlerts).toEqual(['w']);

    receive('w', 20);
    expect(S().lowStockAlerts).toEqual(['w']);
    S().dismissLowStockAlert('w');
    expect(S().lowStockAlerts).toEqual([]);
  });
});
