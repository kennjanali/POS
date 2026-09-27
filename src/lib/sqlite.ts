/**
 * SQLite backend — the Android app's storage. See storage.ts for the
 * interface and for how failures reach the screen.
 *
 * One file in the app's private sandbox. Rows are stored as JSON under their
 * id, the same shape IndexedDB holds, so both backends read back identical
 * data. WAL journaling keeps a closed sale intact through a crash or a flat
 * battery mid-write.
 */

import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';

import type { RowStore, StorageBackend } from './storage';

/** Frozen: renaming this hides every sale already on a customer's tablet. */
const DB_NAME = 'pos034';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS stockMoves (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS closes (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS promos (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
`;

const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbPromise: Promise<SQLiteDBConnection> | null = null;

async function connect(): Promise<SQLiteDBConnection> {
  // A WebView reload keeps the native connection alive, so reuse it rather
  // than create a second one, which the plugin refuses.
  const consistent = (await sqlite.checkConnectionsConsistency()).result;
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const db =
    consistent && exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

  if (!(await db.isDBOpen()).result) await db.open();
  // PRAGMA journal_mode cannot run inside a transaction.
  await db.query('PRAGMA journal_mode = WAL;');
  await db.execute(SCHEMA, false);
  return db;
}

function openDb(): Promise<SQLiteDBConnection> {
  // As in idb.ts: never cache a failed open for the rest of the shift.
  dbPromise ??= connect().catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export const sqliteBackend: StorageBackend = {
  getItem: async (name) => {
    const db = await openDb();
    const result = await db.query('SELECT value FROM kv WHERE key = ?;', [name]);
    return (result.values?.[0]?.value as string | undefined) ?? null;
  },

  removeItem: async (name) => {
    const db = await openDb();
    await db.run('DELETE FROM kv WHERE key = ?;', [name]);
  },

  readRows: async <T>(name: RowStore): Promise<T[]> => {
    const db = await openDb();
    // Ids are UUIDv7, so id order is creation order.
    const result = await db.query(`SELECT json FROM ${name} ORDER BY id;`);
    return (result.values ?? []).map((row) => JSON.parse(row.json as string) as T);
  },

  // One transaction per batch, so a half-written batch can never survive.
  writeBatch: async (batch) => {
    const db = await openDb();
    await db.executeSet(
      [
        ...batch.kv.map(({ name, value }) => ({
          statement:
            'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
          values: [name, value],
        })),
        ...batch.rows.flatMap(({ store, changed, removed }) => [
          ...changed.map((row) => ({
            statement: `INSERT INTO ${store} (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json;`,
            values: [row.id, JSON.stringify(row)],
          })),
          ...removed.map((id) => ({
            statement: `DELETE FROM ${store} WHERE id = ?;`,
            values: [id],
          })),
        ]),
      ],
      true,
    );
  },
};
