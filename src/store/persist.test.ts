import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { ROWS, setStorageBackend, type StorageBackend, type WriteBatch } from '@/lib/storage';
import { computeBill } from '@/lib/tax';
import type { AuditEntry, Product } from '@/lib/types';
import { ownerShop, resetStore } from '@/test/store';
import { orderGross, usePos } from './usePos';

const S = () => usePos.getState();

/** Lets every pending promise and microtask run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const batches: WriteBatch[] = [];
const recording: StorageBackend = {
  getItem: async () => null,
  removeItem: async () => {},
  readRows: async () => [],
  writeBatch: async (batch) => {
    batches.push(batch);
  },
};

const rowsIn = (batch: WriteBatch | undefined, store: string) =>
  batch?.rows.find((r) => r.store === store)?.changed ?? [];

describe('saving', () => {
  beforeEach(async () => {
    batches.length = 0;
    setStorageBackend(recording);
    resetStore();
    // resetStore puts `hydrated` back to false, and nothing saves before it is true.
    usePos.setState({ hydrated: true });
    await ownerShop();
  });

  afterEach(() => setStorageBackend(null));

  it('saves a sale, its stock moves and the blob in one batch', async () => {
    const before = batches.length;
    const id = S().openOrder('T1', 'dine-in');
    S().addLine(id, S().products[0]!.id);
    S().serveAll(id);
    const due = computeBill(orderGross(S().order(id)!), S().settings, { kind: 'none' }).amountDue;
    S().addTender(id, { method: 'cash', amountCents: due, tenderedCents: due, changeCents: cents(0), refNo: null });
    expect(S().closeOrder(id)).toBe(true);
    await Promise.resolve();

    expect(batches.length).toBe(before + 1);
    const last = batches.at(-1);
    expect(rowsIn(last, ROWS.orders).map((o) => o.id)).toEqual([id]);
    expect(rowsIn(last, ROWS.stockMoves).length).toBeGreaterThan(0);
    expect(last?.kv.map((k) => k.name)).toEqual(['pos034-v7']);
  });

  it('shows a failed save on screen', async () => {
    setStorageBackend({ ...recording, writeBatch: () => Promise.reject(new Error('write failed')) });
    S().openOrder('T1', 'dine-in');
    await settle();
    expect(S().persistError).toEqual(expect.any(String));
  });

  it('removes the audit row that falls off the 2000-entry cap', async () => {
    const full: AuditEntry[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `a${String(2000 - i).padStart(4, '0')}`,
      at: 2000 - i,
      branchId: null,
      kind: 'k',
      message: 'filler',
      tone: 'info',
      actorUserId: null,
    }));
    usePos.setState({ audit: full });
    await Promise.resolve();

    S().openOrder('T1', 'dine-in');
    await Promise.resolve();

    const audit = batches.at(-1)?.rows.find((r) => r.store === ROWS.audit);
    expect(audit?.changed.map((a) => a.id)).toEqual([S().audit[0]!.id]);
    expect(audit?.removed).toEqual(['a0001']);
  });

  it('moves products and audit out of an old blob in the same batch as the new blob', async () => {
    const product: Product = { ...S().products[0]!, id: 'p-legacy' };
    const entries: AuditEntry[] = [
      { id: 'a2', at: 2, branchId: null, kind: 'k', message: 'newer', tone: 'info', actorUserId: null },
      { id: 'a1', at: 1, branchId: null, kind: 'k', message: 'older', tone: 'info', actorUserId: null },
    ];
    const saved = usePos.persist.getOptions().partialize!(S()) as object;
    const blob = { state: { ...saved, products: [product], audit: entries }, version: 8 };
    setStorageBackend({ ...recording, getItem: async () => JSON.stringify(blob) });
    usePos.setState({ hydrated: false });
    batches.length = 0;

    await usePos.persist.rehydrate();
    await settle();

    expect(S().products).toEqual([product]);
    expect(S().audit.map((a) => a.id)).toEqual(['a2', 'a1']);
    const first = batches[0];
    expect(rowsIn(first, ROWS.products)).toEqual([product]);
    expect(rowsIn(first, ROWS.audit).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    const written = JSON.parse(first!.kv[0]!.value).state;
    expect(written).not.toHaveProperty('products');
    expect(written).not.toHaveProperty('audit');
  });

  it('reads the audit rows back newest first', async () => {
    const entry = (id: string): AuditEntry =>
      ({ id, at: 0, branchId: null, kind: 'k', message: id, tone: 'info', actorUserId: null });
    setStorageBackend({
      ...recording,
      readRows: async <T,>(store: string) => (store === ROWS.audit ? [entry('a1'), entry('a2')] : []) as T[],
    });
    usePos.setState({ hydrated: false });

    await usePos.persist.rehydrate();
    await settle();

    expect(S().audit.map((a) => a.id)).toEqual(['a2', 'a1']);
  });
});
