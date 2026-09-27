import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { PRESETS } from '@/lib/presets';
import { ROWS, setStorageBackend, type StorageBackend, type WriteBatch } from '@/lib/storage';
import { computeBill } from '@/lib/tax';
import type { AuditEntry, Product, Settings } from '@/lib/types';
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
const kinds = (rows: { id: string }[]) => (rows as AuditEntry[]).map((a) => a.kind);

const entry = (id: string, at: number): AuditEntry =>
  ({ id, at, branchId: null, kind: 'k', message: id, tone: 'info', actorUserId: null });

/** Open a sale, serve one line, pay the bill exactly and close it. */
function sale(): string {
  const id = S().openOrder('T1', 'dine-in');
  S().addLine(id, S().products[0]!.id);
  S().serveAll(id);
  const due = computeBill(orderGross(S().order(id)!), S().settings, { kind: 'none' }).amountDue;
  S().addTender(id, { method: 'cash', amountCents: due, tenderedCents: due, changeCents: cents(0), refNo: null });
  expect(S().closeOrder(id)).toEqual({ ok: true });
  return id;
}

describe('saving', () => {
  beforeEach(async () => {
    setStorageBackend(recording);
    resetStore();
    // A real hydration against the empty backend: the store forgets what an
    // earlier test saved, and `hydrated` comes back true.
    await usePos.persist.rehydrate();
    await settle();
    batches.length = 0;
    await ownerShop();
  });

  afterEach(() => setStorageBackend(null));

  it('saves a sale, its stock moves, its audit rows and the blob in one batch', async () => {
    const before = batches.length;
    const id = sale();
    await Promise.resolve();

    expect(batches.length).toBe(before + 1);
    const last = batches.at(-1);
    expect(rowsIn(last, ROWS.orders).map((o) => o.id)).toEqual([id]);
    expect(rowsIn(last, ROWS.stockMoves).length).toBeGreaterThan(0);
    expect(kinds(rowsIn(last, ROWS.audit))).toEqual(['order.close', 'order.open']);
    expect(last?.kv.map((k) => k.name)).toEqual(['pos034-v7']);
  });

  it('shows a failed save on screen, and retries once rather than spinning', async () => {
    let attempts = 0;
    setStorageBackend({
      ...recording,
      writeBatch: () => {
        attempts++;
        return Promise.reject(new Error('write failed'));
      },
    });
    S().openOrder('T1', 'dine-in');
    await settle();
    await settle();

    expect(S().persistError).toEqual(expect.any(String));
    // The save, then one retry prompted by the error appearing. The next
    // change tries again; nothing does in the meantime.
    expect(attempts).toBe(2);
  });

  it('retries a failed sale with the next batch, and keeps the error up until it lands', async () => {
    const sent: WriteBatch[] = [];
    let errorWhenRetried: string | null = null;
    setStorageBackend({
      ...recording,
      writeBatch: async (batch) => {
        sent.push(batch);
        if (sent.length === 1) throw new Error('write failed');
        if (sent.length === 2) errorWhenRetried = S().persistError;
      },
    });

    const id = sale();
    await settle();

    const retry = sent[1];
    expect(rowsIn(retry, ROWS.orders).map((o) => o.id)).toEqual([id]);
    expect(rowsIn(retry, ROWS.stockMoves).length).toBeGreaterThan(0);
    expect(kinds(rowsIn(retry, ROWS.audit))).toContain('order.close');
    expect(retry?.kv.map((k) => k.name)).toEqual(['pos034-v7']);
    expect(errorWhenRetried).toEqual(expect.any(String));
    expect(S().persistError).toBeNull();
  });

  it('writes nothing for the rest of the session once the saved rows could not be read', async () => {
    let writes = 0;
    setStorageBackend({
      ...recording,
      readRows: () => Promise.reject(new Error('read failed')),
      writeBatch: async () => {
        writes++;
      },
    });
    usePos.setState({ hydrated: false });
    await usePos.persist.rehydrate();
    await settle();

    sale();
    await settle();

    expect(writes).toBe(0);
    expect(S().persistError).toEqual(expect.any(String));
  });

  it('removes the audit row that falls off the 2000-entry cap', async () => {
    const full: AuditEntry[] = Array.from({ length: 2000 }, (_, i) =>
      entry(`a${String(2000 - i).padStart(4, '0')}`, 2000 - i),
    );
    usePos.setState({ audit: full });
    await settle();

    S().openOrder('T1', 'dine-in');
    await settle();

    const audit = batches.at(-1)?.rows.find((r) => r.store === ROWS.audit);
    expect(audit?.changed.map((a) => a.id)).toEqual([S().audit[0]!.id]);
    expect(audit?.removed).toEqual(['a0001']);
  });

  it('moves products and audit out of an old blob in the same batch as the new blob', async () => {
    const product: Product = { ...S().products[0]!, id: 'p-legacy' };
    const entries: AuditEntry[] = [entry('a2', 2), entry('a1', 1)];
    const saved = usePos.persist.getOptions().partialize!(S()) as object;
    const blob = { state: { ...saved, products: [product], audit: entries }, version: 8 };
    setStorageBackend({ ...recording, getItem: async () => JSON.stringify(blob) });
    usePos.setState({ hydrated: false });
    await settle();
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

  /** Rehydrate from this version-8 blob, as a later app start would. */
  async function rehydrateWith(settings: Partial<Settings>) {
    const saved = usePos.persist.getOptions().partialize!(S()) as object;
    const blob = { state: { ...saved, settings }, version: 8 };
    setStorageBackend({ ...recording, getItem: async () => JSON.stringify(blob) });
    usePos.setState({ hydrated: false });
    await usePos.persist.rehydrate();
    await settle();
  }

  it('fills settings a version-8 blob lacks from the defaults, keeping what it has', async () => {
    const older: Partial<Settings> = { ...S().settings };
    delete older.shopType;
    delete older.features;
    delete older.quoteValidDays;

    await rehydrateWith(older);

    expect(S().settings.shopType).toBe('restaurant');
    expect(S().settings.features).toEqual({
      openOrders: true,
      serveStep: true,
      services: false,
      quotes: false,
      vehiclePlate: false,
      measuredUnits: false,
    });
    expect(S().settings.quoteValidDays).toBe(7);
    expect(S().settings.businessName).toBe('Test Shop');
    // What the New order dialog reads first; it threw on the incomplete blob.
    expect(() => PRESETS[S().settings.shopType].orderTypes).not.toThrow();
  });

  it('gives saved settings without features the switches of their own shop type', async () => {
    const older: Partial<Settings> = { ...S().settings, shopType: 'auto' };
    delete older.features;

    await rehydrateWith(older);

    expect(S().settings.features).toEqual(PRESETS.auto.features);
  });

  it('upgrades a v7 install: thousandths, negative stock counted back to 0, all in one batch', async () => {
    const saved = usePos.persist.getOptions().partialize!(S()) as Record<string, unknown>;
    const branchId = S().activeBranchId;
    // What the v7 build kept in the blob: whole units, and products without a kind.
    const products = S().products.slice(0, 2).map(({ id, name, unit, priceCents, costCents }) =>
      ({ id, name, unit, priceCents, costCents, vatExempt: false, active: true }));
    const [short, stocked] = products.map((p) => p.id) as [string, string];
    const blob = {
      state: {
        ...saved,
        rowsNeedV8: undefined,
        settings: { ...S().settings, lowStockAt: 10 },
        stock: { [branchId]: { [short]: -3, [stocked]: 4 } },
        products,
      },
      version: 7,
    };
    const v7Order = {
      id: 'o-v7', invoiceNo: '00000-0000001', branchId, label: 'T1', type: 'dine-in', status: 'closed',
      openedAt: 1, closedAt: 2, tenders: [], discountKind: 'none',
      lines: [{ lineNo: 1, productId: stocked, name: 'x', unitCents: 100, qty: 2, served: true,
        servedAt: 2, voided: false, voidReason: null }],
    };
    const v7Move = { id: 'm-v7', branchId, productId: stocked, delta: -2, reason: 'sale',
      refOrderId: 'o-v7', note: null, at: 2, actorUserId: null };
    setStorageBackend({
      ...recording,
      getItem: async () => JSON.stringify(blob),
      readRows: async <T,>(store: string) =>
        (store === ROWS.orders ? [v7Order] : store === ROWS.stockMoves ? [v7Move] : []) as T[],
    });
    usePos.setState({ hydrated: false });
    await settle();
    batches.length = 0;

    await usePos.persist.rehydrate();
    await settle();

    expect(S().stock[branchId]).toEqual({ [short]: 0, [stocked]: 4000 });
    expect(S().settings.lowStockAt).toBe(10000);
    expect(S().products[0]).toMatchObject({ kind: 'stock', sku: null, category: '', reorderLevel: null });
    // Migrated once, by shape and by the flag together.
    expect(S().order('o-v7')?.lines[0]?.qty).toBe(2000);
    const counts = S().stockMoves.filter((m) => m.reason === 'count');
    expect(counts).toEqual([
      expect.objectContaining({ productId: short, delta: 3000, note: "Reset at upgrade: stock can't be negative" }),
    ]);
    expect(S().stockMoves.find((m) => m.id === 'm-v7')?.delta).toBe(-2000);
    expect(S().audit[0]?.kind).toBe('stock.reset');

    const first = batches[0];
    expect(rowsIn(first, ROWS.orders).map((o) => o.id)).toEqual(['o-v7']);
    expect(rowsIn(first, ROWS.stockMoves).map((m) => m.id).sort()).toEqual([counts[0]!.id, 'm-v7'].sort());
    expect(kinds(rowsIn(first, ROWS.audit))).toContain('stock.reset');
    const written = JSON.parse(first!.kv[0]!.value);
    expect(written.state.rowsNeedV8).toBe(false);
    expect(written.state.stock[branchId][short]).toBe(0);
  });

  it('reads the audit rows back newest first, by time and then by id', async () => {
    // Id order says z-old is newest; its time says it is the oldest.
    const rows = [entry('b-tie', 5), entry('a-tie', 5), entry('a-new', 9), entry('z-old', 1)];
    setStorageBackend({
      ...recording,
      readRows: async <T,>(store: string) => (store === ROWS.audit ? rows : []) as T[],
    });
    usePos.setState({ hydrated: false });

    await usePos.persist.rehydrate();
    await settle();

    expect(S().audit.map((a) => a.id)).toEqual(['a-new', 'b-tie', 'a-tie', 'z-old']);
  });
});
