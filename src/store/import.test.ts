import { beforeEach, describe, expect, it } from 'vitest';

import { CSV_COLUMNS, previewImport } from '@/lib/csv';
import { qty } from '@/lib/qty';
import type { Product } from '@/lib/types';
import { usePos } from '@/store/usePos';
import { ownerShop, resetStore, signInAs } from '@/test/store';

const S = () => usePos.getState();
const HEADER = CSV_COLUMNS.join(',');

function file(...rows: string[]): string {
  return `${HEADER}\r\n${rows.map((r) => `${r}\r\n`).join('')}`;
}

/** Preview the file against what is on the shelf right now, as the screen does. */
function preview(text: string) {
  const state = S();
  return previewImport(text, state.products, state.settings.features);
}

const byName = (name: string): Product => {
  const found = S().products.find((p) => p.name === name);
  if (!found) throw new Error(`no product called ${name}`);
  return found;
};

const onHand = (id: string): number => S().stock[S().activeBranchId]?.[id] ?? 0;

describe('applyImport', () => {
  beforeEach(resetStore);

  it('adds the new items, updates the matched one, and leaves the matched stock alone', async () => {
    await ownerShop();
    // An item already on the shelf, with stock that came from counting.
    S().upsertProduct({
      id: 'p-nails',
      name: 'Nails 2 inch',
      kind: 'stock',
      sku: 'NA-01',
      category: 'Hardware',
      unit: 'pcs',
      priceCents: 1500 as Product['priceCents'],
      costCents: 900 as Product['costCents'],
      vatExempt: false,
      active: true,
      reorderLevel: null,
    });
    S().countStock('p-nails', qty(12), 'first count');

    // A restaurant, so nothing is sold by measure: every quantity is whole.
    const before = S().products.length;
    const result = S().applyImport(
      preview(
        file(
          'Nails 2 inch,NA-01,Hardware,stock,pcs,18,9,,99',
          'Cement,CE-01,Hardware,stock,pcs,70,60,10,40',
          'Rice,RI-01,Grains,stock,kg,45,30,,3',
        ),
      ),
    );

    expect(result.ok).toBe(true);
    expect(S().products).toHaveLength(before + 2);

    // The match updated the price and kept the stock it was counted at.
    expect(byName('Nails 2 inch').priceCents).toBe(1800);
    expect(onHand('p-nails')).toBe(qty(12));

    // The new items landed with the opening quantity the file gave.
    expect(onHand(byName('Cement').id)).toBe(qty(40));
    expect(onHand(byName('Rice').id)).toBe(qty(3));
  });

  it('books the opening quantities as opening moves, so the ledger starts at a real number', async () => {
    await ownerShop();
    S().applyImport(preview(file('Cement,CE-01,Hardware,stock,pcs,70,60,10,40')));
    const cement = byName('Cement');
    const moves = S().stockMoves.filter((m) => m.productId === cement.id);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.reason).toBe('opening');
    expect(moves[0]?.delta).toBe(qty(40));
    expect(moves[0]?.branchId).toBe(S().activeBranchId);
  });

  it('writes no stock at all for a service, and no move for it either', async () => {
    await ownerShop();
    S().applyImport(preview(file('Wash,WA-01,Care,service,job,250,0,,3')));
    const wash = byName('Wash');
    expect(wash.kind).toBe('service');
    expect(onHand(wash.id)).toBe(0);
    expect(S().stockMoves.filter((m) => m.productId === wash.id)).toEqual([]);
  });

  it('is one entry in the log, not one per line', async () => {
    await ownerShop();
    S().applyImport(
      preview(
        file(
          'Cement,CE-01,Hardware,stock,pcs,70,60,10,40',
          'Rice,RI-01,Grains,stock,kg,45,30,,3',
        ),
      ),
    );
    const entries = S().audit.filter((e) => e.kind === 'inventory.import');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toContain('2');
  });

  it('leaves a file with nothing but errors alone', async () => {
    await ownerShop();
    const before = S().products;
    const result = S().applyImport(preview(file(',CE-01,Hardware,stock,pcs,70,60,10,40')));
    expect(result.ok).toBe(false);
    expect(S().products).toBe(before);
  });

  it('refuses staff, whatever the screen let them reach', async () => {
    await ownerShop();
    signInAs('staff');
    const result = S().applyImport(preview(file('Cement,CE-01,Hardware,stock,pcs,70,60,10,40')));
    expect(result).toEqual({ ok: false, error: 'Only the owner can do that.' });
    expect(S().products.some((p) => p.name === 'Cement')).toBe(false);
  });
});
