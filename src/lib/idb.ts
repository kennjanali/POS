/**
 * IndexedDB backend — the web demo's storage. See storage.ts for the
 * interface and for how failures reach the screen.
 *
 * v6 did `localStorage.setItem(STORE, JSON.stringify(DB))` after every order
 * action — O(total data) per write, capped at 5-10MB. IndexedDB has no
 * practical size cap, and sales are written one row at a time.
 */

import { ROWS, type RowStore, type StorageBackend } from './storage';

/** Frozen: renaming this hides every sale already on a customer's device. */
const DB_NAME = 'pos034';
/** v2 added the `orders` and `stockMoves` row stores; v3 added `closes`. */
const DB_VERSION = 3;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;
/** Guards against a stale connection nulling out a newer one. */
let generation = 0;

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

export const idbBackend: StorageBackend = {
  getItem: (name) =>
    tx<string | undefined>('readonly', (store) => store.get(name)).then((value) => value ?? null),

  setItem: (name, value) => tx('readwrite', (store) => store.put(value, name)).then(() => undefined),

  removeItem: (name) => tx('readwrite', (store) => store.delete(name)).then(() => undefined),

  readRows: <T>(name: RowStore) =>
    openDb()
      .then(
        (db) =>
          new Promise<T[]>((resolve, reject) => {
            const request = db.transaction(name, 'readonly').objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error ?? new Error('read failed'));
          }),
      )
      .catch(() => []),

  // One transaction per batch, so a half-written batch can never survive.
  writeRows: (name, changed, removed) =>
    openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(name, 'readwrite');
          const store = transaction.objectStore(name);
          for (const row of changed) store.put(row);
          for (const id of removed) store.delete(id);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        }),
    ),
};
