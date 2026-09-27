/**
 * Where the persisted store lives. The one storage boundary in the app.
 *
 * Two backends, one interface: SQLite in the Android app (a real file on the
 * tablet, crash-safe, easy to back up), IndexedDB in the browser (the web
 * demo). Chosen once, at first use. The store never knows which it has.
 *
 * Every write outcome is reported to the topbar through `onPersistWrite`.
 * v6 swallowed a failed write with console.warn and lost a day of sales; a
 * failure here always ends up on screen.
 *
 * Each change is saved as one batch, in one transaction: the settings blob
 * and every row that changed with it. A sale is never on disk without its
 * stock moves, or without the invoice counter that numbered it.
 */

import { Capacitor } from '@capacitor/core';

/**
 * Sales, the menu and the audit log do not live in the settings blob.
 *
 * Everything else the app persists is small and changes rarely, so rewriting
 * it wholesale costs nothing. These are neither: a year of trading is ~24 MB,
 * and zustand's persist middleware re-serialises whatever it is given after
 * every state change. These row stores hold one record per sale, stock move,
 * daily close, product, audit entry, promo or quote, and only changed records
 * are written, so a tap costs the same after a week or a year.
 *
 * The names are frozen: renaming one hides every row already on a device.
 */
export const ROWS = {
  orders: 'orders',
  stockMoves: 'stockMoves',
  closes: 'closes',
  products: 'products',
  audit: 'audit',
  promos: 'promos',
  quotes: 'quotes',
} as const;

export type RowStore = (typeof ROWS)[keyof typeof ROWS];

/** Everything one change saves. Written in one transaction, all or nothing. */
export interface WriteBatch {
  kv: { name: string; value: string }[];
  rows: { store: RowStore; changed: { id: string }[]; removed: string[] }[];
}

/** What a backend provides. Failures reject; this module reports them. */
export interface StorageBackend {
  getItem(name: string): Promise<string | null>;
  removeItem(name: string): Promise<void>;
  /** Every row, oldest first. Read once, at startup. */
  readRows<T>(name: RowStore): Promise<T[]>;
  /** One transaction: all of the batch lands, or none of it. */
  writeBatch(batch: WriteBatch): Promise<void>;
}

let backend: Promise<StorageBackend> | null = null;

function getBackend(): Promise<StorageBackend> {
  backend ??= Capacitor.isNativePlatform()
    ? import('./sqlite').then((m) => m.sqliteBackend)
    : import('./idb').then((m) => m.idbBackend);
  return backend;
}

/** Set by tests, which run without a window. Used in place of the platform's. */
let testBackend: StorageBackend | null = null;

/** Tests only. With a backend set, storage works without a window. */
export function setStorageBackend(b: StorageBackend | null): void {
  testBackend = b;
}

/** A test's backend is called in the same tick, so one await sees the write. */
function withBackend<T>(run: (b: StorageBackend) => Promise<T>): Promise<T> {
  return testBackend ? run(testBackend) : getBackend().then(run);
}

// ── Write reporting ──────────────────────────────────────────────────────

/**
 * A listener rather than an import: the store imports this module, so it
 * cannot import the store back. Registered once, at store construction.
 */
type WriteListener = (error: string | null) => void;
let onWrite: WriteListener | null = null;

export function onPersistWrite(listener: WriteListener): void {
  onWrite = listener;
}

function describeWriteFailure(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError' || /full|SQLITE_FULL|no space/i.test(message)) {
    return 'This device is out of storage. Download a backup, then clear old sales.';
  }
  return 'Could not save to this device. Download a backup — recent work may be lost.';
}

/**
 * Report, never rethrow. Zustand's persist middleware never awaits a write,
 * so a rethrow is an unhandled rejection the cashier never sees — exactly how
 * v6 lost a day of sales. The topbar is where a failed write has to show up.
 */
function reported(write: Promise<void>): Promise<void> {
  return write.then(
    () => onWrite?.(null),
    (error: unknown) => onWrite?.(describeWriteFailure(error)),
  );
}

// ── The interface the store uses ─────────────────────────────────────────

/**
 * Next prerenders pages at build time, where there is no storage at all. The
 * adapter answers "nothing stored" rather than throwing, or the export fails.
 */
const canStore = (): boolean => testBackend !== null || typeof window !== 'undefined';

let pendingBlob: { name: string; value: string } | null = null;

/**
 * zustand's persist storage: the small settings blob. Reads go to the
 * backend; writes do not. persist calls `setItem` right after every change,
 * but the blob has to land in the same transaction as the rows that changed
 * with it, so it is held here until the store's next batch takes it.
 */
export const blobStorage = {
  getItem: async (name: string): Promise<string | null> =>
    canStore() ? withBackend((b) => b.getItem(name)) : null,

  setItem: (name: string, value: string): void => {
    pendingBlob = { name, value };
  },

  removeItem: async (name: string): Promise<void> => {
    if (!canStore()) return;
    return withBackend((b) => b.removeItem(name));
  },
};

/** The latest blob persist handed over, once. Null when nothing changed since. */
export function takePendingBlob(): { name: string; value: string } | null {
  const blob = pendingBlob;
  pendingBlob = null;
  return blob;
}

export async function readRows<T>(name: RowStore): Promise<T[]> {
  return canStore() ? withBackend((b) => b.readRows<T>(name)) : [];
}

export function writeBatch(batch: WriteBatch): Promise<void> {
  if (!canStore()) return Promise.resolve();
  return reported(withBackend((b) => b.writeBatch(batch)));
}
