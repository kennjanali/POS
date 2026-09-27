import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import { idbBackend } from './idb';
import { ROWS } from './storage';

type Row = { id: string; n?: number };

describe('IndexedDB batches', () => {
  it('writes nothing when any part of a batch fails', async () => {
    await expect(
      idbBackend.writeBatch({
        kv: [{ name: 'blob', value: 'new' }],
        rows: [
          { store: ROWS.orders, changed: [{ id: 'o-bad' }], removed: [] },
          { store: ROWS.stockMoves, changed: [{} as Row], removed: [] },
        ],
      }),
    ).rejects.toBeDefined();

    const orders = await idbBackend.readRows<Row>(ROWS.orders);
    expect(orders.map((o) => o.id)).not.toContain('o-bad');
    expect(await idbBackend.getItem('blob')).toBeNull();
  });

  it('round-trips a good batch through readRows', async () => {
    const orders: Row[] = [{ id: 'o2', n: 2 }, { id: 'o1', n: 1 }];
    await idbBackend.writeBatch({
      kv: [{ name: 'blob', value: 'saved' }],
      rows: [
        { store: ROWS.orders, changed: orders, removed: [] },
        { store: ROWS.products, changed: [{ id: 'p1' }], removed: [] },
      ],
    });
    expect(await idbBackend.readRows<Row>(ROWS.orders)).toEqual([{ id: 'o1', n: 1 }, { id: 'o2', n: 2 }]);
    expect(await idbBackend.readRows<Row>(ROWS.products)).toEqual([{ id: 'p1' }]);
    expect(await idbBackend.getItem('blob')).toBe('saved');

    await idbBackend.writeBatch({ kv: [], rows: [{ store: ROWS.orders, changed: [], removed: ['o1'] }] });
    expect(await idbBackend.readRows<Row>(ROWS.orders)).toEqual([{ id: 'o2', n: 2 }]);
  });
});
