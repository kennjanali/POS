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
 */

import { Capacitor } from '@capacitor/core';

/**
 * Sales do not live in the settings blob.
 *
 * Everything else the app persists is small and changes rarely, so rewriting
 * it wholesale costs nothing. Sales are neither: a year of trading is ~24 MB,
 * and zustand's persist middleware re-serialises whatever it is given after
 * every state change. These row stores hold one record per sale or stock
 * move, written individually, so a tap costs the same after a week or a year.
 */
export const ROWS = {
  orders: 'orders',
  stockMoves: 'stockMoves',
} as const;

export type RowStore = (typeof ROWS)[keyof typeof ROWS];

/** What a backend provides. Failures reject; this module reports them. */
export interface StorageBackend {
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
  /** Every row, oldest first. Read once, at startup. */
  readRows<T>(name: RowStore): Promise<T[]>;
  /** One batch, all or nothing. */
  writeRows<T extends { id: string }>(name: RowStore, changed: T[], removed: string[]): Promise<void>;
}

let backend: Promise<StorageBackend> | null = null;

function getBackend(): Promise<StorageBackend> {
  backend ??= Capacitor.isNativePlatform()
    ? import('./sqlite').then((m) => m.sqliteBackend)
    : import('./idb').then((m) => m.idbBackend);
  return backend;
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
const canStore = (): boolean => typeof window !== 'undefined';

/** zustand's persist storage: the small settings blob. */
export const kvStorage = {
  getItem: async (name: string): Promise<string | null> =>
    canStore() ? (await getBackend()).getItem(name) : null,

  setItem: async (name: string, value: string): Promise<void> => {
    if (!canStore()) return;
    return reported(getBackend().then((b) => b.setItem(name, value)));
  },

  removeItem: async (name: string): Promise<void> => {
    if (!canStore()) return;
    return (await getBackend()).removeItem(name);
  },
};

export async function readRows<T>(name: RowStore): Promise<T[]> {
  return canStore() ? (await getBackend()).readRows<T>(name) : [];
}

export async function writeRows<T extends { id: string }>(
  name: RowStore,
  changed: T[],
  removed: string[],
): Promise<void> {
  if (!canStore() || (changed.length === 0 && removed.length === 0)) return;
  return reported(getBackend().then((b) => b.writeRows(name, changed, removed)));
}
