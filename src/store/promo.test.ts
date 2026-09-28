import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { applyPreset, type ShopType } from '@/lib/presets';
import { qty } from '@/lib/qty';
import { renderReceipt } from '@/lib/receipt';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore, signInAs } from '@/test/store';
import { useAuth } from './useAuth';
import { usePos } from './usePos';

const S = () => usePos.getState();

/** A ₱500 padlock, five on the shelf. */
const ITEM: Product = {
  id: 'item',
  name: 'Padlock',
  kind: 'stock',
  sku: 'PL-500',
  category: 'Hardware',
  unit: 'pcs',
  priceCents: cents(50000),
  costCents: cents(20000),
  vatExempt: false,
  active: true,
  reorderLevel: null,
};

function preset(shopType: ShopType) {
  usePos.setState((s) => ({
    settings: { ...s.settings, shopType, features: applyPreset(shopType) },
  }));
}

function setup() {
  S().upsertProduct(ITEM);
  S().receiveStock({ lines: [{ productId: 'item', qty: qty(5) }] });
}

function grand10() {
  const r = S().createPromo({ code: 'GRAND10', percent: 10 });
  if (!r.ok) throw new Error(r.error);
}

function freeOne() {
  const r = S().createPromo({ code: 'FREEONE', percent: 100 });
  if (!r.ok) throw new Error(r.error);
}

function promoIdOf(code: string): string {
  const found = S().promos.find((p) => p.code === code);
  if (!found) throw new Error(`${code} is missing`);
  return found.id;
}

/** Back to the owner, for the actions only they may take. */
function asOwner() {
  signInAs('superadmin');
}

function cart(): string {
  const id = S().openOrder('Walk-in', 'walk-in');
  S().addLine(id, 'item');
  return id;
}

function onHand(): number {
  return S().stock[S().branches[0]!.id]?.['item'] ?? 0;
}

describe('createPromo', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('retail');
  });

  it('lets the owner create GRAND10 at 10%', () => {
    grand10();
    expect(S().promos).toHaveLength(1);
    expect(S().promos[0]).toMatchObject({ code: 'GRAND10', percent: 10, active: true });
  });

  it('refuses a bad format, a duplicate, and a percent outside 1-100', () => {
    expect(S().createPromo({ code: 'AB', percent: 10 }).ok).toBe(false);
    expect(S().createPromo({ code: 'GRAND-10', percent: 10 }).ok).toBe(false);
    expect(S().createPromo({ code: 'GRAND10', percent: 0 }).ok).toBe(false);
    expect(S().createPromo({ code: 'GRAND10', percent: 101 }).ok).toBe(false);
    grand10();
    expect(S().createPromo({ code: ' grand10 ', percent: 20 }).ok).toBe(false);
    expect(S().promos).toHaveLength(1);
  });

  it('refuses staff', () => {
    signInAs('staff');
    expect(S().createPromo({ code: 'GRAND10', percent: 10 }).ok).toBe(false);
  });

  it('audits the create', () => {
    grand10();
    expect(S().audit.some((a) => a.kind === 'promo.create')).toBe(true);
  });

  it('carries codes through a backup, and an older backup without them loads empty', () => {
    grand10();
    const snapshot = S().exportSnapshot();
    expect(snapshot.promos).toHaveLength(1);

    const older: Partial<typeof snapshot> = { ...snapshot };
    delete older.promos;
    expect(S().importSnapshot(older as typeof snapshot).ok).toBe(true);
    expect(S().promos).toEqual([]);
  });
});

describe('applyPromo', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('retail');
    setup();
    grand10();
    freeOne();
    signInAs('staff');
  });

  it('lets staff apply a typed code to a ₱500 sale; it closes 10% off', () => {
    const id = cart();
    expect(S().applyPromo(id, ' grand10 ').ok).toBe(true);
    expect(S().order(id)!.discount).toMatchObject({ kind: 'promo', code: 'GRAND10', percent: 10 });
    expect(S().payExact(id, 'cash').ok).toBe(true);
    const closed = S().order(id)!;
    expect(closed.grossCents).toBe(50000);
    expect(closed.discountCents).toBe(5000);
    expect(closed.netCents).toBe(45000);
  });

  it('prints the promo on the slip', () => {
    const id = cart();
    S().applyPromo(id, 'GRAND10');
    S().payExact(id, 'cash');
    expect(renderReceipt(S().order(id)!, S().settings)).toContain('Promo GRAND10 (10%)');
  });

  it('refuses an unknown code and changes nothing', () => {
    const id = cart();
    const r = S().applyPromo(id, 'NOPE');
    expect(r).toEqual({ ok: false, error: 'That code is not valid today.' });
    expect(S().order(id)!.discount.kind).toBe('none');
  });

  it('locks the code once a sale has closed with it', () => {
    const id = cart();
    S().applyPromo(id, 'GRAND10');
    S().payExact(id, 'cash');
    asOwner();
    const locked = S().updatePromo(promoIdOf('GRAND10'), { code: 'GRAND10', percent: 20 });
    expect(locked).toEqual({
      ok: false,
      error: 'This code has been used. Turn it off and make a new one.',
    });
    expect(S().promos.find((p) => p.code === 'GRAND10')!.percent).toBe(10);
  });

  it('turning the code off leaves the closed sale alone and blocks new use', () => {
    const id = cart();
    S().applyPromo(id, 'GRAND10');
    S().payExact(id, 'cash');
    asOwner();
    expect(S().setPromoActive(promoIdOf('GRAND10'), false).ok).toBe(true);

    const closed = S().order(id)!;
    expect(closed.discount).toMatchObject({ kind: 'promo', code: 'GRAND10', percent: 10 });
    expect(closed.discountCents).toBe(5000);

    const second = cart();
    expect(S().applyPromo(second, 'GRAND10').ok).toBe(false);
    expect(S().order(second)!.discount.kind).toBe('none');
  });

  it('counts the sales that used a code', () => {
    const id = cart();
    S().applyPromo(id, 'GRAND10');
    S().payExact(id, 'cash');
    expect(S().promoUses(promoIdOf('GRAND10'))).toBe(1);
  });

  it('does not count a sale still open, or one cancelled, as a use', () => {
    const open = cart();
    S().applyPromo(open, 'GRAND10');
    const cancelled = cart();
    S().applyPromo(cancelled, 'GRAND10');
    asOwner();
    S().voidOrder(cancelled, 'customer left');
    expect(S().promoUses(promoIdOf('GRAND10'))).toBe(0);
  });

  it('refuses a code from a signed-out till', () => {
    const id = cart();
    useAuth.setState({ session: null });
    expect(S().applyPromo(id, 'GRAND10').ok).toBe(false);
    expect(S().order(id)!.discount.kind).toBe('none');
  });

  it('closes a 100% code at zero and still takes the item off the shelf', () => {
    const id = cart();
    S().applyPromo(id, 'FREEONE');
    const before = onHand();
    // Nothing to hand over: the code takes the whole amount off.
    expect(S().closeOrder(id).ok).toBe(true);
    const closed = S().order(id)!;
    expect(closed.discountCents).toBe(50000);
    expect(closed.netCents).toBe(0);
    expect(onHand()).toBe(before - qty(1));
  });

  it('clears a payment entered before the promo was applied', () => {
    const id = cart();
    S().addTender(id, {
      method: 'cash',
      amountCents: cents(50000),
      tenderedCents: cents(50000),
      changeCents: cents(0),
      refNo: null,
    });
    expect(S().order(id)!.tenders).toHaveLength(1);

    const r = S().applyPromo(id, 'GRAND10');
    expect(r).toEqual({ ok: true, notice: 'Discount changed — enter the payment again.' });
    expect(S().order(id)!.tenders).toHaveLength(0);
  });
});

describe('one discount per sale', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    preset('retail');
    setup();
    grand10();
  });

  it('a code replaces an owner discount', () => {
    const id = cart();
    S().applyOwnerDiscount(id, { percent: 20 });
    expect(S().order(id)!.discount.kind).toBe('owner');
    S().applyPromo(id, 'GRAND10');
    expect(S().order(id)!.discount.kind).toBe('promo');
  });

  it('an owner discount replaces a code', () => {
    const id = cart();
    S().applyPromo(id, 'GRAND10');
    expect(S().order(id)!.discount.kind).toBe('promo');
    S().applyOwnerDiscount(id, { fixedCents: cents(5000) });
    expect(S().order(id)!.discount).toMatchObject({ kind: 'owner', percent: null });
  });

  it('lets only the owner take an owner discount off', () => {
    const id = cart();
    S().applyOwnerDiscount(id, { percent: 20 });
    signInAs('staff');
    expect(S().clearDiscount(id).ok).toBe(false);
    expect(S().order(id)!.discount.kind).toBe('owner');
    // A promo code staff may take off, as they may put one on.
    expect(S().applyPromo(id, 'GRAND10').ok).toBe(true);
    expect(S().clearDiscount(id).ok).toBe(true);
    expect(S().order(id)!.discount.kind).toBe('none');
  });

  it('keeps an entered payment when the same code is applied again', () => {
    const id = cart();
    S().applyPromo(id, 'GRAND10');
    S().addTender(id, {
      method: 'cash',
      amountCents: cents(45000),
      tenderedCents: cents(45000),
      changeCents: cents(0),
      refNo: null,
    });
    expect(S().applyPromo(id, ' grand10 ')).toEqual({ ok: true });
    expect(S().order(id)!.tenders).toHaveLength(1);
  });

  it('refuses an owner discount of nothing, or of more than the sale', () => {
    const id = cart();
    expect(S().applyOwnerDiscount(id, { percent: 0 }).ok).toBe(false);
    expect(S().applyOwnerDiscount(id, { fixedCents: cents(0) }).ok).toBe(false);
    expect(S().applyOwnerDiscount(id, { fixedCents: cents(50001) })).toEqual({
      ok: false,
      error: 'That is more than the sale.',
    });
    expect(S().order(id)!.discount.kind).toBe('none');
  });

  it('refuses staff an owner discount', () => {
    signInAs('staff');
    const id = cart();
    const r = S().applyOwnerDiscount(id, { percent: 20 });
    expect(r.ok).toBe(false);
    expect(S().order(id)!.discount.kind).toBe('none');
  });
});
