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
const DB_VERSION = 1;
const STORE = 'kv';

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

/** False in private-mode browsers that block IndexedDB. Surfaced in the topbar. */
export const storageAvailable = hasIdb;
