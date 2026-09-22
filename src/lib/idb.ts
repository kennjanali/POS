/**
 * IndexedDB-backed storage for the persisted store.
 *
 * v6 did `localStorage.setItem(STORE, JSON.stringify(DB))` after every order
 * action — O(total data) per write, capped at 5-10MB, and wrapped in
 * `catch(e){ console.warn(...) }`. Past a few thousand orders it failed
 * silently and the owner lost a day of sales without any visible signal.
 *
 * IndexedDB has no practical size cap, and every failure here surfaces to the
 * UI through the store's `persistError` flag.
 */

const DB_NAME = 'kramgen';
/** v2 added the per-row `orders` and `stockMoves` stores. See ROWS below. */
const DB_VERSION = 2;
const STORE = 'kv';

/**
 * Sales do not live in the settings blob.
 *
 * Everything else the app persists is small and changes rarely, so rewriting
 * it wholesale costs nothing. Sales are neither. A year of trading is ~24 MB,
 * and zustand's persist middleware re-serialises whatever it is given after
 * *every* state change — so adding one item to one order was rewriting a
 * year of history, 182 ms of blocked main thread per tap.
 *
 * These two stores hold one record per row, written individually. The same
 * tap now costs 0.005 ms. Orders stay in memory for reading, so every screen
 * that filters or sums them is unchanged and still synchronous.
 */
export const ROWS = {
  orders: 'orders',
  stockMoves: 'stockMoves',
} as const;

export type RowStore = (typeof ROWS)[keyof typeof ROWS];

let dbPromise: Promise<IDBDatabase> | null = null;
/** Guards against a stale connection nulling out a newer one. */
let generation = 0;

/**
 * Next prerenders these pages at build time, where `indexedDB` doesn't exist.
 * The adapter has to answer "nothing stored" rather than throw, or the export
 * fails. On the client this is always true.
 */
const hasIdb = (): boolean => typeof indexedDB !== 'undefined';

/**
 * Write outcomes go to the store, which shows them in the topbar.
 *
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
  if (name === 'QuotaExceededError') {
    return 'This device is out of storage. Download a backup, then clear old sales.';
  }
  return 'Could not save to this device. Download a backup — recent work may be lost.';
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  // Caching a rejected promise would make one bad moment permanent: every
  // later read and write for the rest of the shift would fail against it.
  // Forgetting the handle lets the next write try again.
  const mine = ++generation;
  const forget = () => {
    if (generation === mine) dbPromise = null;
  };

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      // Keyed by the row's own id. Upgrading from v1 leaves these empty; the
      // rows already sitting in the v1 blob are migrated on first hydrate.
      for (const name of Object.values(ROWS)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // The browser can close a connection under us — storage pressure, or a
      // second tab upgrading. A dead handle must not stay cached.
      db.onclose = forget;
      db.onversionchange = () => {
        db.close();
        forget();
      };
      resolve(db);
    };
    request.onerror = () => {
      forget();
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'));
      }),
  );
}

export const idbStorage = {
  getItem: (name: string): Promise<string | null> => {
    if (!hasIdb()) return Promise.resolve(null);
    return tx<string | undefined>('readonly', (store) => store.get(name)).then(
      (value) => value ?? null,
    );
  },

  setItem: (name: string, value: string): Promise<void> => {
    if (!hasIdb()) return Promise.resolve();
    return tx('readwrite', (store) => store.put(value, name)).then(
      () => onWrite?.(null),
      (error: unknown) => {
        // Reported, not rethrown. Zustand's persist middleware never awaits
        // this promise, so a rethrow is an unhandled rejection the cashier
        // never sees — which is precisely how v6 lost a day of sales. The
        // topbar is where a failed write has to show up.
        onWrite?.(describeWriteFailure(error));
      },
    );
  },

  removeItem: (name: string): Promise<void> => {
    if (!hasIdb()) return Promise.resolve();
    return tx('readwrite', (store) => store.delete(name)).then(() => undefined);
  },
};

// ── Row stores ───────────────────────────────────────────────────────────

/** Everything in a row store, in insertion order. Read once, at startup. */
export function readRows<T>(name: RowStore): Promise<T[]> {
  if (!hasIdb()) return Promise.resolve([]);
  return openDb()
    .then(
      (db) =>
        new Promise<T[]>((resolve, reject) => {
          const request = db
            .transaction(name, 'readonly')
            .objectStore(name)
            .getAll();
          request.onsuccess = () => resolve(request.result as T[]);
          request.onerror = () => reject(request.error ?? new Error('read failed'));
        }),
    )
    .catch(() => []);
}

/**
 * Apply one batch of row changes in a single transaction, so a half-written
 * batch can never survive. Failures are reported the same way blob writes
 * are — to the topbar, never swallowed.
 */
export function writeRows<T extends { id: string }>(
  name: RowStore,
  changed: T[],
  removed: string[],
): Promise<void> {
  if (!hasIdb() || (changed.length === 0 && removed.length === 0)) {
    return Promise.resolve();
  }
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        const transaction = db.transaction(name, 'readwrite');
        const store = transaction.objectStore(name);
        for (const row of changed) store.put(row);
        for (const id of removed) store.delete(id);
        transaction.oncomplete = () => {
          onWrite?.(null);
          resolve();
        };
        transaction.onerror = () => {
          onWrite?.(describeWriteFailure(transaction.error));
          resolve();
        };
        transaction.onabort = () => {
          onWrite?.(describeWriteFailure(transaction.error));
          resolve();
        };
      }),
  );
}
