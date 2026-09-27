import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { applyPreset } from '@/lib/presets';
import { qty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { ownerShop, resetStore } from '@/test/store';
import { usePos } from '@/store/usePos';
import { renderReceipt } from './receipt';

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
