import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  blobStorage,
  onPersistWrite,
  setStorageBackend,
  takePendingBlob,
  writeBatch,
  type StorageBackend,
} from './storage';

function fake(overrides: Partial<StorageBackend> = {}): StorageBackend {
  return {
    getItem: vi.fn(async () => 'stored'),
    removeItem: vi.fn(async () => {}),
    readRows: vi.fn(async () => []),
    writeBatch: vi.fn(async () => {}),
    ...overrides,
  };
}

const BATCH = { kv: [{ name: 'k', value: 'v' }], rows: [] };

describe('storage', () => {
  afterEach(() => setStorageBackend(null));

  it('holds the blob for the next batch instead of writing it', async () => {
    const backend = fake();
    setStorageBackend(backend);
    blobStorage.setItem('pos034-v7', '{"a":1}');
    blobStorage.setItem('pos034-v7', '{"a":2}');

    expect(backend.writeBatch).not.toHaveBeenCalled();
    expect(takePendingBlob()).toEqual({ name: 'pos034-v7', value: '{"a":2}' });
    expect(takePendingBlob()).toBeNull();
    expect(await blobStorage.getItem('pos034-v7')).toBe('stored');
  });

  it('reports every batch, and never rejects', async () => {
    const outcomes: (string | null)[] = [];
    onPersistWrite((error) => outcomes.push(error));

    setStorageBackend(fake());
    await writeBatch(BATCH);
    setStorageBackend(fake({ writeBatch: () => Promise.reject(new Error('boom')) }));
    await writeBatch(BATCH);

    expect(outcomes).toEqual([null, expect.stringContaining('Could not save')]);
  });

  it('stores nothing with neither a window nor a backend', async () => {
    expect(await blobStorage.getItem('pos034-v7')).toBeNull();
    await expect(writeBatch(BATCH)).resolves.toBeUndefined();
  });
});
