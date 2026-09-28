import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { applyPreset, type ShopType } from '@/lib/presets';
import { qty, type Qty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore, signInAs } from '@/test/store';
import { useAuth } from './useAuth';
import { usePos } from './usePos';

const S = () => usePos.getState();

const ITEM: Product = {
  id: 'item',
  name: 'Padlock',
  kind: 'stock',
  sku: 'PL-40',
  category: 'Hardware',
  unit: 'pcs',
  priceCents: cents(15000),
  costCents: cents(9000),
  vatExempt: false,
  active: true,
  reorderLevel: null,
};

const LABOR: Product = {
  ...ITEM,
  id: 'labor',
  name: 'Labor – per hour',
  kind: 'service',
  sku: null,
  category: 'Labor',
  unit: 'hour',
  priceCents: cents(30000),
  costCents: cents(0),
};

function preset(shopType: ShopType) {
  usePos.setState((s) => ({
    settings: { ...s.settings, shopType, features: applyPreset(shopType) },
  }));
}

function cart(): string {
  const id = S().openOrder('Walk-in', 'walk-in');
  S().addLine(id, 'item');
  return id;
}

describe('payExact', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('retail');
    S().upsertProduct(ITEM);
    S().upsertProduct(LABOR);
    S().receiveStock({ lines: [{ productId: 'item', qty: qty(5) }] });
  });

  it('closes a ₱150 cart with one cash payment of the amount due', () => {
    const id = cart();
    expect(S().payExact(id, 'cash')).toEqual({ ok: true });
    const order = S().order(id)!;
    expect(order.status).toBe('closed');
    expect(order.netCents).toBe(15000);
    expect(order.tenders).toHaveLength(1);
    expect(order.tenders[0]).toMatchObject({
      method: 'cash',
      amountCents: 15000,
      tenderedCents: 15000,
      changeCents: 0,
      refNo: null,
    });
    expect(S().stockOf('item')).toBe(qty(4));
  });

  it('refuses GCash without a reference number and leaves the order open', () => {
    const id = cart();
    expect(S().payExact(id, 'gcash')).toEqual({
      ok: false,
      error: 'GCash needs a reference number.',
    });
    expect(S().payExact(id, 'gcash', '   ')).toMatchObject({ ok: false });
    expect(S().order(id)).toMatchObject({ status: 'open', tenders: [], invoiceNo: null });
  });

  it('closes GCash with a reference number', () => {
    const id = cart();
    expect(S().payExact(id, 'gcash', '1234567890')).toEqual({ ok: true });
    const order = S().order(id)!;
    expect(order.status).toBe('closed');
    expect(order.tenders).toHaveLength(1);
    expect(order.tenders[0]).toMatchObject({
      method: 'gcash',
      amountCents: 15000,
      tenderedCents: null,
      changeCents: null,
      refNo: '1234567890',
    });
  });

  it('takes back its payment when the sale cannot close', () => {
    const id = S().openOrder('Walk-in', 'walk-in');
    S().addLine(id, 'item', qty(3));
    S().countStock('item', qty(2));
    expect(S().payExact(id, 'cash')).toEqual({ ok: false, error: 'Padlock: only 2 left.' });
    expect(S().order(id)).toMatchObject({ status: 'open', tenders: [] });
  });

  it('pays only what is still due after a part payment', () => {
    const id = cart();
    S().addTender(id, {
      method: 'gcash',
      amountCents: cents(5000),
      tenderedCents: null,
      changeCents: null,
      refNo: '555',
    });
    expect(S().payExact(id, 'cash')).toEqual({ ok: true });
    expect(S().order(id)?.tenders.map((t) => t.amountCents)).toEqual([5000, 10000]);
  });
});

describe('payment needs someone signed in', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('retail');
    S().upsertProduct(ITEM);
    S().receiveStock({ lines: [{ productId: 'item', qty: qty(5) }] });
  });

  it('refuses payExact, closeOrder and a payment from a signed-out till', () => {
    const id = cart();
    useAuth.setState({ session: null });
    expect(S().payExact(id, 'cash').ok).toBe(false);
    S().addTender(id, {
      method: 'cash',
      amountCents: cents(15000),
      tenderedCents: cents(15000),
      changeCents: cents(0),
      refNo: null,
    });
    expect(S().order(id)?.tenders).toEqual([]);
    expect(S().closeOrder(id).ok).toBe(false);
    expect(S().order(id)?.status).toBe('open');
  });
});

describe('open-order rules', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('auto');
    S().upsertProduct(ITEM);
    S().upsertProduct(LABOR);
    S().receiveStock({ lines: [{ productId: 'item', qty: qty(5) }] });
  });

  it('refuses to add a quantity of zero or less', () => {
    const id = S().openOrder('Job 1', 'walk-in');
    const refusal = { ok: false, error: 'Enter a quantity greater than zero.' };
    expect(S().addLine(id, 'item', qty(0))).toEqual(refusal);
    expect(S().addLine(id, 'item', qty(-1))).toEqual(refusal);
    expect(S().addLine(id, 'labor', qty(-2))).toEqual(refusal);
    expect(S().order(id)?.lines).toEqual([]);
  });

  it('refuses a change of a fraction of a thousandth, or of nothing', () => {
    const id = S().openOrder('Job 1', 'walk-in');
    S().addLine(id, 'item');
    const refusal = { ok: false, error: 'Enter a quantity.' };
    expect(S().changeQty(id, 1, 0.5 as Qty)).toEqual(refusal);
    expect(S().changeQty(id, 1, Number.NaN as Qty)).toEqual(refusal);
    expect(S().changeQty(id, 1, 0 as Qty)).toEqual(refusal);
    expect(S().order(id)?.lines[0]?.qty).toBe(qty(1));
  });

  it('removes a line that is reduced to zero, never below', () => {
    const id = S().openOrder('Job 1', 'walk-in');
    S().addLine(id, 'item', qty(2));
    S().addLine(id, 'labor');
    expect(S().changeQty(id, 1, qty(-5))).toEqual({ ok: true });
    expect(S().order(id)?.lines.map((l) => l.productId)).toEqual(['labor']);
    expect(S().available('item')).toBe(qty(5));
  });

  it('keeps an order with a payment on record: staff cannot discard it', () => {
    const id = S().openOrder('Job 1', 'walk-in');
    S().addLine(id, 'labor');
    S().addTender(id, {
      method: 'cash',
      amountCents: cents(10000),
      tenderedCents: cents(10000),
      changeCents: cents(0),
      refNo: null,
    });
    signInAs('staff');
    expect(S().discardOpenOrder(id)).toEqual({ ok: false, error: 'Ask the owner to cancel this sale.' });
    expect(S().order(id)?.status).toBe('open');
  });

  it('numbers a cancelled open order that took a payment', () => {
    const id = S().openOrder('Job 1', 'walk-in');
    S().addLine(id, 'labor');
    S().addTender(id, {
      method: 'cash',
      amountCents: cents(10000),
      tenderedCents: cents(10000),
      changeCents: cents(0),
      refNo: null,
    });
    expect(S().voidOrder(id, 'customer left')).toEqual({ ok: true });
    expect(S().order(id)).toMatchObject({ status: 'voided', invoiceNo: '00000-0000001' });
  });

  it('treats a served service-only order as unmoved: discard allowed, cancel unnumbered', () => {
    const a = S().openOrder('Job 1', 'walk-in');
    S().addLine(a, 'labor');
    S().serveAll(a);
    const b = S().openOrder('Job 2', 'walk-in');
    S().addLine(b, 'labor');
    S().serveAll(b);

    expect(S().voidOrder(a, 'wrong job')).toEqual({ ok: true });
    expect(S().order(a)).toMatchObject({ status: 'voided', invoiceNo: null });
    expect(S().invoiceSeq).toEqual({});

    signInAs('staff');
    expect(S().discardOpenOrder(b)).toEqual({ ok: true });
    expect(S().order(b)).toBeUndefined();
  });
});
