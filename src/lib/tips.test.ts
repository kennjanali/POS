import { describe, expect, it } from 'vitest';

import { seenTips, takeTip, type TipStorage } from '@/lib/tips';

function memory(): TipStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('first-use tips', () => {
  it('shows a tip once per user, and remembers it under pos034.tips.<userId>', () => {
    const store = memory();
    expect(takeTip(store, 'u1', 'sell')).toBe(true);
    expect(takeTip(store, 'u1', 'sell')).toBe(false);
    expect(store.data.get('pos034.tips.u1')).toBe('["sell"]');
    // Another user has not seen it yet.
    expect(takeTip(store, 'u2', 'sell')).toBe(true);
    expect(seenTips(store, 'u1')).toEqual(['sell']);
  });

  it('shows nothing when storage is missing, throws, or holds junk it cannot keep', () => {
    expect(takeTip(null, 'u1', 'sell')).toBe(false);
    const throwing: TipStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(takeTip(throwing, 'u1', 'sell')).toBe(false);
    const readOnly: TipStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    // A tip that cannot be marked seen would show forever, so it does not show.
    expect(takeTip(readOnly, 'u1', 'sell')).toBe(false);
    const junk = memory();
    junk.data.set('pos034.tips.u1', '{not json');
    expect(takeTip(junk, 'u1', 'sell')).toBe(false);
  });
});
