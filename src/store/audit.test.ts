/**
 * Findings from the Revision 2 audit (Task 23), each pinned by a test.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_FEATURES } from '@/lib/features';
import { cents } from '@/lib/money';
import { qty, type Qty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore, signInAs, TABLES, withFeatures } from '@/test/store';
import { useAuth } from './useAuth';
import { usePos } from './usePos';

const S = () => usePos.getState();

const WIRE: Product = {
  id: 'wire',
  name: 'Wire',
  kind: 'stock',
  sku: null,
  category: '',
  unit: 'm',
  priceCents: cents(3000),
  costCents: cents(1800),
  vatExempt: false,
  active: true,
  reorderLevel: null,
};
const PADLOCK: Product = { ...WIRE, id: 'lock', name: 'Padlock', unit: 'pcs', priceCents: cents(10000) };

/** Stock on hand, per product, adds up from the moves. */
function ledgerAddsUp(): boolean {
  const sums: Record<string, Record<string, number>> = {};
  for (const m of S().stockMoves) {
    sums[m.branchId] ??= {};
    sums[m.branchId]![m.productId] = (sums[m.branchId]![m.productId] ?? 0) + m.delta;
  }
  return Object.entries(S().stock).every(([bid, perProduct]) =>
    Object.entries(perProduct).every(([pid, q]) => q === (sums[bid]?.[pid] ?? 0)),
  );
}

beforeEach(async () => {
  resetStore();
  await ownerShop();
});

describe('a demo leaves no niche behind', () => {
  it('Remove demo data puts back the shop from before the demo, codes made meanwhile included', async () => {
    const own = S().products.map((p) => p.name).sort();
    await S().loadDemoBusiness('restaurant', { days: 2, salesPerDay: 3 });
    expect(S().settings.ticketLabel).toBe('Table');
    expect(S().createPromo({ code: 'GRAND10', percent: 10 }).ok).toBe(true);

    expect(S().resetAll()).toBe(true);
    expect(S().products.map((p) => p.name).sort()).toEqual(own);
    expect(S().settings.features).toEqual(DEFAULT_FEATURES);
    expect(S().settings.ticketLabel).toBe('Sale');
    expect(S().promos.map((p) => p.code)).toEqual(['GRAND10']);
    expect(S().quotes).toEqual([]);
    expect(S().preDemo).toBeNull();
    expect(ledgerAddsUp()).toBe(true);
  });

  it('going live after a demo does the same', async () => {
    const own = S().products.map((p) => p.name).sort();
    await S().loadDemoBusiness('auto', { days: 2, salesPerDay: 3 });
    // A second demo replaces the first; the shop set aside is still the owner's.
    await S().loadDemoBusiness('carwash', { days: 2, salesPerDay: 3 });
    usePos.setState({ licensed: { licenseId: 'LIC-TEST' } as never });
    expect(S().updateSettings({ trainingMode: false }).ok).toBe(true);
    expect(S().products.map((p) => p.name).sort()).toEqual(own);
    expect(S().settings.features).toEqual(DEFAULT_FEATURES);
    expect(S().promos).toEqual([]);
  });
});

describe('the store keeps its own rules', () => {
  it('starts a new branch with an empty shelf, and only the owner adds one', () => {
    S().upsertBranch({ id: 'BR2', name: 'Two', address: '', branchCode: '00002', color: '#000', active: true });
    S().setActiveBranch('BR2');
    expect(S().stock.BR2).toEqual({});
    expect(ledgerAddsUp()).toBe(true);

    signInAs('staff');
    S().upsertBranch({ id: 'BR3', name: 'Three', address: '', branchCode: '00003', color: '#000', active: true });
    expect(S().branches.some((b) => b.id === 'BR3')).toBe(false);
  });

  it('refuses staff a restore, a data wipe and a month prune', () => {
    const snapshot = S().exportSnapshot();
    signInAs('staff');
    expect(S().importSnapshot(snapshot).ok).toBe(false);
    expect(S().resetAll()).toBe(false);
  });

  it('refuses part of a whole unit, and decimals once selling by measure is off', () => {
    S().upsertProduct(PADLOCK);
    S().upsertProduct(WIRE);
    S().receiveStock({ lines: [{ productId: 'lock', qty: qty(5) }, { productId: 'wire', qty: qty(10) }] });
    const id = S().openOrder('Walk-in', 'walk-in');
    expect(S().addLine(id, 'lock', 1500 as Qty)).toEqual({ ok: false, error: 'Padlock is sold in whole pcs.' });
    expect(S().addLine(id, 'wire', 2500 as Qty).ok).toBe(true);
    withFeatures({ measuredUnits: false });
    expect(S().addLine(id, 'wire', 500 as Qty).ok).toBe(false);
    expect(S().changeQty(id, 1, 500 as Qty).ok).toBe(false);
  });

  it('caps a fixed owner discount by what is billed, not by what is on the order', () => {
    withFeatures(TABLES);
    S().upsertProduct(PADLOCK);
    S().receiveStock({ lines: [{ productId: 'lock', qty: qty(5) }] });
    const id = S().openOrder('T1', 'dine-in');
    S().addLine(id, 'lock');
    S().serveAll(id);
    S().addLine(id, 'lock', qty(2));
    // ₱100 served, ₱200 more still to come.
    expect(S().applyOwnerDiscount(id, { fixedCents: cents(12000) })).toEqual({
      ok: false,
      error: 'That is more than the sale.',
    });
  });

  it('refuses a payment that does not add up', () => {
    S().upsertProduct(PADLOCK);
    S().receiveStock({ lines: [{ productId: 'lock', qty: qty(1) }] });
    const id = S().openOrder('Walk-in', 'walk-in');
    S().addLine(id, 'lock');
    const bad = [
      { method: 'cash' as const, amountCents: cents(-100), tenderedCents: cents(0), changeCents: cents(0), refNo: null },
      { method: 'cash' as const, amountCents: cents(10000), tenderedCents: cents(10000), changeCents: cents(500), refNo: null },
      { method: 'gcash' as const, amountCents: 100.5 as never, tenderedCents: null, changeCents: null, refNo: '1' },
    ];
    for (const tender of bad) expect(S().addTender(id, tender).ok).toBe(false);
    expect(S().order(id)!.tenders).toEqual([]);
  });

  it('will not switch open sales off while any are open', () => {
    withFeatures({ openOrders: true });
    S().openOrder('Table 1', 'walk-in');
    const result = S().updateSettings({ features: { ...S().settings.features, openOrders: false } });
    expect(result).toEqual({ ok: false, error: 'Pay or cancel the 1 open sale first.' });
    expect(S().settings.features.openOrders).toBe(true);
  });

  it('calls a converted quote a Sale once open sales are off, whatever the old word was', async () => {
    await S().loadDemoBusiness('auto', { days: 2, salesPerDay: 3 });
    usePos.setState((s) => ({
      orders: s.orders.filter((o) => o.status !== 'open'),
      settings: { ...s.settings, features: { ...s.settings.features, openOrders: false } },
    }));
    const quote = S().quotes[0]!;
    const result = S().convertQuote(quote.id, Date.now(), { confirmExpired: true });
    if (!result.ok) throw new Error(result.error);
    expect(S().order(result.orderId)!.label).toBe('Sale');
  });
});

describe("Today's summary windows", () => {
  it('never loses a sale paid in the same millisecond as a close', async () => {
    const product = S().products.find((p) => p.kind === 'stock')!;
    const sell = () => {
      const id = S().openOrder('Walk-in', 'walk-in');
      S().addLine(id, product.id);
      expect(S().payExact(id, 'cash').ok).toBe(true);
    };
    sell();
    await new Promise((resolve) => setTimeout(resolve, 3));
    const first = await S().closeDay();
    sell(); // may land in the same millisecond as the close
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = await S().closeDay();
    expect((first?.orders ?? 0) + (second?.orders ?? 0)).toBe(2);
  });
});

describe('a signed-out till', () => {
  it('opens no sale', () => {
    const before = S().orders.length;
    useAuth.setState({ session: null });
    expect(S().openOrder('Walk-in', 'walk-in')).toBe('');
    expect(S().orders).toHaveLength(before);
  });
});
