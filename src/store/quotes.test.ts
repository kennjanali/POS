import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { applyPreset, type ShopType } from '@/lib/presets';
import { qty, type Qty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore, signInAs } from '@/test/store';
import { usePos } from './usePos';

const S = () => usePos.getState();

const TIRE: Product = {
  id: 'tire',
  name: 'Tire',
  kind: 'stock',
  sku: 'TR-1',
  category: 'Tires',
  unit: 'pcs',
  priceCents: cents(300000),
  costCents: cents(180000),
  vatExempt: false,
  active: true,
  reorderLevel: null,
};

const LABOR: Product = {
  ...TIRE,
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

function stock(productId: string, onHand: Qty) {
  usePos.setState((s) => ({
    stock: { ...s.stock, [s.branches[0]!.id]: { ...s.stock[s.branches[0]!.id], [productId]: onHand } },
  }));
}

function onHand(productId: string): number {
  return S().stock[S().branches[0]!.id]?.[productId] ?? 0;
}

/** A cart of tire x4 and labor x2: 1,200,000 + 60,000. */
function cart(): string {
  const id = S().openOrder('Job', 'walk-in');
  S().addLine(id, 'tire', qty(4));
  S().addLine(id, 'labor', qty(2));
  return id;
}

function quoteIdOf(quoteNo: string): string {
  const found = S().quotes.find((q) => q.quoteNo === quoteNo);
  if (!found) throw new Error(`${quoteNo} is missing`);
  return found.id;
}

function asOwner() {
  signInAs('superadmin');
}

describe('saveOrderAsQuote', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('auto');
    S().upsertProduct(TIRE);
    S().upsertProduct(LABOR);
    S().receiveStock({ lines: [{ productId: 'tire', qty: qty(4) }] });
    signInAs('staff');
  });

  it('numbers the first quote Q-0001, keeps the totals and leaves stock alone', () => {
    const orderId = cart();
    const saved = S().saveOrderAsQuote(orderId);
    if (!saved.ok) throw new Error(saved.error);

    expect(S().quotes).toHaveLength(1);
    const quote = S().quotes[0]!;
    expect(quote.quoteNo).toBe('Q-0001');
    expect(quote.status).toBe('open');
    expect(quote.grossCents).toBe(1260000);
    expect(quote.discountCents).toBe(0);
    expect(quote.netCents).toBe(1260000);
    expect(quote.lines.map((l) => l.name)).toEqual(['Tire', 'Labor – per hour']);
    // A quote is a piece of paper. It never moves stock.
    expect(onHand('tire')).toBe(4000);
    // The cart it was made from is gone, so the hold on the tires is released.
    expect(S().order(orderId)).toBeUndefined();
  });

  it('gives the second quote Q-0002', () => {
    const first = S().saveOrderAsQuote(cart());
    if (!first.ok) throw new Error(first.error);
    const second = S().saveOrderAsQuote(cart());
    if (!second.ok) throw new Error(second.error);
    expect(S().quotes.map((q) => q.quoteNo)).toEqual(['Q-0001', 'Q-0002']);
  });
});

describe('convertQuote', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('auto');
    S().upsertProduct(TIRE);
    S().upsertProduct(LABOR);
    S().receiveStock({ lines: [{ productId: 'tire', qty: qty(4) }] });
    signInAs('staff');
  });

  function quote(): string {
    const saved = S().saveOrderAsQuote(cart());
    if (!saved.ok) throw new Error(saved.error);
    return quoteIdOf('Q-0001');
  }

  it('opens the sale at the quoted price, not the new one', () => {
    const id = quote();
    asOwner();
    S().upsertProduct({ ...TIRE, priceCents: cents(320000) });

    const converted = S().convertQuote(id);
    if (!converted.ok) throw new Error(converted.error);
    const order = S().order(converted.orderId)!;
    expect(order.fromQuoteId).toBe(id);
    expect(order.lines.map((l) => l.unitCents)).toEqual([cents(300000), cents(30000)]);
    expect(S().quotes[0]!.status).toBe('converted');
    expect(S().quotes[0]!.convertedSaleId).toBe(order.id);
  });

  it('refuses when the shelf cannot cover the quote, naming the tire', () => {
    const id = quote();
    stock('tire', qty(3));
    const r = S().convertQuote(id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('Tire');
    expect(S().quotes[0]!.status).toBe('open');
  });

  it('refuses when a product is no longer sold', () => {
    const id = quote();
    asOwner();
    S().upsertProduct({ ...TIRE, active: false });
    const r = S().convertQuote(id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('Tire');
  });

  it('needs the owner to confirm an expired quote, then goes through', () => {
    const id = quote();
    usePos.setState((s) => ({
      quotes: s.quotes.map((q) => (q.id === id ? { ...q, validUntil: '2000-01-01' } : q)),
    }));

    const refused = S().convertQuote(id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('2000-01-01');

    const confirmed = S().convertQuote(id, undefined, { confirmExpired: true });
    expect(confirmed.ok).toBe(true);
  });
});

describe('requote', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('auto');
    S().upsertProduct(TIRE);
    S().upsertProduct(LABOR);
    S().receiveStock({ lines: [{ productId: 'tire', qty: qty(4) }] });
    signInAs('staff');
  });

  it('copies the quote at today\'s prices under a new number', () => {
    const saved = S().saveOrderAsQuote(cart());
    if (!saved.ok) throw new Error(saved.error);
    asOwner();
    S().upsertProduct({ ...TIRE, priceCents: cents(320000) });

    const again = S().requote(quoteIdOf('Q-0001'));
    if (!again.ok) throw new Error(again.error);
    const fresh = S().quotes.find((q) => q.id === again.quoteId)!;
    expect(fresh.quoteNo).toBe('Q-0002');
    expect(fresh.lines.find((l) => l.productId === 'tire')!.unitCents).toBe(cents(320000));
    expect(fresh.netCents).toBe(1340000);
  });
});

describe('cancelQuote', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('auto');
    S().upsertProduct(TIRE);
    S().upsertProduct(LABOR);
    S().receiveStock({ lines: [{ productId: 'tire', qty: qty(4) }] });
    signInAs('staff');
  });

  it('refuses staff', () => {
    const saved = S().saveOrderAsQuote(cart());
    if (!saved.ok) throw new Error(saved.error);
    const r = S().cancelQuote(quoteIdOf('Q-0001'), 'Customer went elsewhere');
    expect(r.ok).toBe(false);
    expect(S().quotes[0]!.status).toBe('open');
  });

  it('lets the owner cancel it, and says why', () => {
    const saved = S().saveOrderAsQuote(cart());
    if (!saved.ok) throw new Error(saved.error);
    asOwner();
    expect(S().cancelQuote(quoteIdOf('Q-0001'), 'Customer went elsewhere').ok).toBe(true);
    const quote = S().quotes[0]!;
    expect(quote.status).toBe('cancelled');
    expect(quote.cancelledReason).toBe('Customer went elsewhere');
  });
});
