import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { applyPreset, type ShopType } from '@/lib/presets';
import { qty, type Qty } from '@/lib/qty';
import { computeBill } from '@/lib/tax';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore, signInAs } from '@/test/store';
import { orderGross, usePos } from './usePos';

const S = () => usePos.getState();

const WIDGET: Product = {
  id: 'w',
  name: 'Widget',
  kind: 'stock',
  sku: null,
  category: '',
  unit: 'pcs',
  priceCents: cents(10000),
  costCents: cents(4000),
  vatExempt: false,
  active: true,
  reorderLevel: null,
};

function preset(shopType: ShopType) {
  usePos.setState((s) => ({
    settings: { ...s.settings, shopType, features: applyPreset(shopType) },
  }));
}

/** The seeded catalog's first line, found by name: the setup wizard mints
 *  product ids, so nothing outside it can know one. It stands in for "some
 *  other stocked product the Widget is easy to tell apart from". */
function seededId(): string {
  const found = S().products.find((p) => p.name === 'Chicken Paa');
  if (!found) throw new Error('the sample catalog was not loaded');
  return found.id;
}

/** Pay exactly what `gross` comes to, in cash. */
function payFor(id: string, gross = orderGross(S().order(id)!)) {
  const due = computeBill(gross, S().settings, { kind: 'none' }).amountDue;
  S().addTender(id, { method: 'cash', amountCents: due, tenderedCents: due, changeCents: cents(0), refNo: null });
}

describe('stock rules', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('retail');
    S().upsertProduct(WIDGET);
    S().receiveStock({ lines: [{ productId: 'w', qty: qty(3) }] });
  });

  it('refuses more than is available', () => {
    const id = S().openOrder('Walk-in', 'walk-in');
    expect(S().addLine(id, 'w', qty(4))).toEqual({ ok: false, error: 'Only 3 left.' });
    expect(S().order(id)?.lines).toEqual([]);
  });

  it('holds stock for open orders, and a discard releases it', () => {
    const a = S().openOrder('A', 'walk-in');
    const b = S().openOrder('B', 'walk-in');
    expect(S().addLine(a, 'w', qty(2))).toEqual({ ok: true });
    expect(S().available('w')).toBe(qty(1));
    expect(S().addLine(b, 'w', qty(2))).toEqual({ ok: false, error: 'Only 1 left.' });

    expect(S().discardOpenOrder(a)).toEqual({ ok: true });
    expect(S().order(a)).toBeUndefined();
    expect(S().addLine(b, 'w', qty(2))).toEqual({ ok: true });
  });

  it('checks the same limit when a quantity goes up', () => {
    const id = S().openOrder('A', 'walk-in');
    S().addLine(id, 'w', qty(2));
    expect(S().changeQty(id, 1, qty(2))).toEqual({ ok: false, error: 'Only 1 left.' });
    expect(S().changeQty(id, 1, qty(1))).toEqual({ ok: true });
    expect(S().order(id)?.lines[0]?.qty).toBe(qty(3));
  });

  it('deducts at close and numbers the sale only then', () => {
    const b = S().openOrder('B', 'walk-in');
    S().addLine(b, 'w', qty(2));
    const c = S().openOrder('C', 'walk-in');
    expect(S().order(b)?.invoiceNo).toBeNull();
    expect(S().invoiceSeq).toEqual({});

    payFor(b);
    expect(S().closeOrder(b)).toEqual({ ok: true });
    expect(S().stockOf('w')).toBe(qty(1));
    expect(S().order(b)?.invoiceNo).toBe('00000-0000001');
    expect(S().order(b)?.lines[0]).toMatchObject({ served: true });
    expect(S().stockMoves[0]).toMatchObject({ productId: 'w', delta: qty(-2), reason: 'sale', refOrderId: b });
    expect(S().order(c)?.invoiceNo).toBeNull();
  });

  it('re-checks on hand at close and changes nothing when short', () => {
    const id = S().openOrder('A', 'walk-in');
    S().addLine(id, 'w', qty(3));
    S().countStock('w', qty(2));
    payFor(id);
    const moves = S().stockMoves;

    expect(S().closeOrder(id)).toEqual({ ok: false, error: 'Widget: only 2 left.' });
    expect(S().order(id)?.status).toBe('open');
    expect(S().order(id)?.invoiceNo).toBeNull();
    expect(S().stockOf('w')).toBe(qty(2));
    expect(S().stockMoves).toBe(moves);
    expect(S().invoiceSeq).toEqual({});
  });

  it('refuses an item that is no longer sold', () => {
    S().removeProduct('w');
    const id = S().openOrder('A', 'walk-in');
    expect(S().addLine(id, 'w')).toEqual({ ok: false, error: 'That item is no longer sold.' });
  });

  it('keeps the price a line was added at', () => {
    const id = S().openOrder('A', 'walk-in');
    S().addLine(id, 'w');
    S().upsertProduct({ ...WIDGET, priceCents: cents(12000) });
    S().addLine(id, 'w');
    expect(S().order(id)?.lines.map((l) => l.unitCents)).toEqual([10000, 12000]);
  });

  it('never lets damage or a count take stock below zero', () => {
    S().recordDamage('w', qty(2), 'dropped');
    expect(S().recordDamage('w', qty(5), 'dropped')).toEqual({
      ok: false,
      error: 'Only 1 on hand.',
    });
    expect(S().countStock('w', -1000 as Qty)).toEqual({ ok: false, error: 'Enter a count of 0 or more.' });
    expect(S().stockOf('w')).toBe(qty(1));
  });

  it('lets staff discard an unserved order but not a served one', () => {
    preset('restaurant');
    const unserved = S().openOrder('T1', 'dine-in');
    S().addLine(unserved, 'w');
    const served = S().openOrder('T2', 'dine-in');
    S().addLine(served, 'w');
    S().serveAll(served);

    signInAs('staff');
    expect(S().discardOpenOrder(unserved)).toEqual({ ok: true });
    expect(S().order(unserved)).toBeUndefined();
    expect(S().discardOpenOrder(served)).toEqual({ ok: false, error: 'Ask the owner to cancel this sale.' });
    expect(S().order(served)?.status).toBe('open');
  });

  it('bills served lines only in a restaurant', () => {
    preset('restaurant');
    const id = S().openOrder('T1', 'dine-in');
    S().addLine(id, 'w');
    S().serveAll(id);
    S().addLine(id, seededId());
    payFor(id, cents(10000));

    expect(S().closeOrder(id)).toEqual({ ok: true });
    expect(S().order(id)?.grossCents).toBe(10000);
    expect(S().stockOf('w')).toBe(qty(2));
    expect(S().stockOf(seededId())).toBe(qty(30));
  });

  it('refuses the whole serve when a line is short', () => {
    preset('restaurant');
    const id = S().openOrder('T1', 'dine-in');
    S().addLine(id, 'w', qty(3));
    S().addLine(id, seededId());
    S().countStock('w', qty(2));

    expect(S().serveAll(id)).toEqual({ ok: false, error: 'Widget: only 2 left.' });
    expect(S().order(id)?.lines.every((l) => !l.served)).toBe(true);
    expect(S().stockOf(seededId())).toBe(qty(30));
  });

  it('numbers an open order with served lines when the owner cancels it', () => {
    preset('restaurant');
    const id = S().openOrder('T1', 'dine-in');
    S().addLine(id, 'w');
    S().serveAll(id);

    expect(S().voidOrder(id, 'walked out')).toEqual({ ok: true });
    expect(S().order(id)).toMatchObject({ status: 'voided', invoiceNo: '00000-0000001' });
    expect(S().stockOf('w')).toBe(qty(3));
  });
});
