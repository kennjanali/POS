import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { applyPreset } from '@/lib/presets';
import { qty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore } from '@/test/store';
import { usePos } from '@/store/usePos';
import { renderQuote, renderReceipt } from './receipt';

const S = () => usePos.getState();

const TIRE: Product = {
  id: 'tire',
  name: 'Tire 185/65 R15',
  kind: 'stock',
  sku: null,
  category: 'Tires',
  unit: 'pcs',
  priceCents: cents(112000),
  costCents: cents(80000),
  vatExempt: false,
  active: true,
  reorderLevel: null,
};

/** A closed ₱1,120 sale; returns its slip. */
function sellTire(extra?: { vehiclePlate?: string }): string {
  const id = S().openOrder('Walk-in', 'walk-in', extra);
  S().addLine(id, 'tire');
  const paid = S().payExact(id, 'cash');
  if (!paid.ok) throw new Error(paid.error);
  return renderReceipt(S().order(id)!, S().settings);
}

describe('the slip', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    usePos.setState((s) => ({ settings: { ...s.settings, shopType: 'auto', features: applyPreset('auto') } }));
    S().upsertProduct(TIRE);
    S().receiveStock({ lines: [{ productId: 'tire', qty: qty(4) }] });
  });

  it('shows the VAT included under TOTAL on a VAT-registered shop', () => {
    S().updateSettings({ vatRegistered: true });
    const lines = sellTire().split('\n');
    const vat = lines.findIndex((l) => l.includes('VAT (12%) included'));
    expect(vat).toBeGreaterThan(-1);
    expect(lines[vat]).toContain('120.00');
    expect(lines[vat - 1]).toMatch(/^TOTAL\s+1,120\.00$/);
    expect(lines.some((l) => l.includes('VATable'))).toBe(false);
  });

  it('says nothing about VAT on a non-VAT shop', () => {
    expect(sellTire()).not.toContain('VAT');
  });

  it('keeps the VAT a sale was closed with when the shop changes its registration', () => {
    const before = S().orders.length;
    sellTire();
    const unregistered = S().orders[before]!;
    S().updateSettings({ vatRegistered: true });
    // Closed before registering: a reprint does not grow a VAT line.
    expect(renderReceipt(unregistered, S().settings)).not.toContain('VAT');

    sellTire();
    const registered = S().orders[before + 1]!;
    S().updateSettings({ vatRegistered: false });
    // Closed while registered: its VAT stays on the reprint.
    expect(renderReceipt(registered, S().settings)).toContain('VAT (12%) included');
  });

  it('prints the plate', () => {
    expect(sellTire({ vehiclePlate: 'ABC 1234' })).toMatch(/Plate\s+ABC 1234/);
  });

  it('labels each kind of discount', () => {
    const id = S().openOrder('Walk-in', 'walk-in');
    S().addLine(id, 'tire');
    S().payExact(id, 'cash');
    const closed = { ...S().order(id)!, discountCents: cents(11200) };
    const slip = (discount: typeof closed.discount) =>
      renderReceipt({ ...closed, discount }, S().settings);

    expect(slip({ kind: 'legacy' })).toContain('Discount (legacy)');
    expect(slip({ kind: 'owner', percent: 10, fixedCents: null, by: null })).toMatch(/^Discount\s+-112\.00$/m);
    expect(slip({ kind: 'promo', promoId: 'p', code: 'GRAND10', percent: 10 })).toContain('Promo GRAND10 (10%)');
  });
});

describe('the quotation', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
    usePos.setState((s) => ({ settings: { ...s.settings, shopType: 'auto', features: applyPreset('auto') } }));
    S().upsertProduct(TIRE);
    S().receiveStock({ lines: [{ productId: 'tire', qty: qty(4) }] });
  });

  /** Quotes four tires, and returns the slip as printed. */
  function quoteTire(extra?: { customerName?: string }): string {
    const id = S().openOrder('Job', 'walk-in', extra);
    S().addLine(id, 'tire', qty(4));
    const saved = S().saveOrderAsQuote(id);
    if (!saved.ok) throw new Error(saved.error);
    return renderQuote(S().quotes[0]!, S().settings);
  }

  it('says it is not a receipt, and never says RECEIPT', () => {
    const slip = quoteTire();
    expect(slip).toContain('QUOTATION');
    expect(slip).toContain('QUOTATION — not a receipt');
    expect(slip).not.toContain('RECEIPT OR INVOICE');
  });

  it('prints the number, the date it holds to, and the customer', () => {
    const slip = quoteTire({ customerName: 'Maria Santos' });
    expect(slip).toMatch(/Quote no\.\s+Q-0001/);
    expect(slip).toMatch(/Valid until\s+\d{4}-\d{2}-\d{2}/);
    expect(slip).toMatch(/Customer\s+Maria Santos/);
  });

  it('shows the quantity with its unit and the quoted total', () => {
    const slip = quoteTire();
    expect(slip).toMatch(/^4 pcs Tire 185\/65 R15\s+4,480\.00$/m);
    expect(slip).toMatch(/^QUOTED TOTAL\s+4,480\.00$/m);
  });

  it('keeps every line inside the printer width', () => {
    usePos.setState((s) => ({ settings: { ...s.settings, businessName: 'Sampalok Auto Shop and Parts Depot' } }));
    for (const line of quoteTire().split('\n')) {
      expect(line.length).toBeLessThanOrEqual(58);
    }
  });
});
