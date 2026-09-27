import { describe, expect, it } from 'vitest';

import { findUsablePromo, isValidCode, normalizeCode, promoStatus } from './promo';
import type { Promo } from './types';

function promo(over: Partial<Promo> = {}): Promo {
  return {
    id: 'p1',
    code: 'GRAND10',
    percent: 10,
    note: '',
    active: true,
    startsOn: null,
    endsOn: null,
    createdAt: 0,
    firstUsedAt: null,
    ...over,
  };
}

describe('normalizeCode', () => {
  it('trims and uppercases, so " grand10 " is GRAND10', () => {
    expect(normalizeCode(' grand10 ')).toBe('GRAND10');
  });
});

describe('isValidCode', () => {
  it('rejects two characters', () => {
    expect(isValidCode('AB')).toBe(false);
  });

  it('rejects punctuation', () => {
    expect(isValidCode('GRAND-10')).toBe(false);
  });

  it('accepts letters and digits of 3 to 12', () => {
    expect(isValidCode('ABC')).toBe(true);
    expect(isValidCode('GRAND10')).toBe(true);
    expect(isValidCode('ABCDEFGHIJKL')).toBe(true);
    expect(isValidCode('ABCDEFGHIJKLM')).toBe(false);
  });
});

describe('promoStatus', () => {
  it('is active on the last day, because endsOn is inclusive', () => {
    expect(promoStatus(promo({ endsOn: '2026-10-05' }), '2026-10-05')).toBe('active');
  });

  it('is expired the day after endsOn', () => {
    expect(promoStatus(promo({ endsOn: '2026-10-05' }), '2026-10-06')).toBe('expired');
  });

  it('is scheduled before startsOn', () => {
    expect(promoStatus(promo({ startsOn: '2026-10-10' }), '2026-10-05')).toBe('scheduled');
  });

  it('is off when deactivated, whatever the dates say', () => {
    expect(promoStatus(promo({ active: false }), '2026-10-05')).toBe('off');
  });
});

describe('findUsablePromo', () => {
  it('matches a typed code with spaces and lower case', () => {
    expect(findUsablePromo([promo()], ' grand10 ', '2026-10-05')?.id).toBe('p1');
  });

  it('returns null for an unknown, off, scheduled or expired code', () => {
    const day = '2026-10-05';
    expect(findUsablePromo([promo()], 'NOPE', day)).toBeNull();
    expect(findUsablePromo([promo({ active: false })], 'GRAND10', day)).toBeNull();
    expect(findUsablePromo([promo({ startsOn: '2026-10-10' })], 'GRAND10', day)).toBeNull();
    expect(findUsablePromo([promo({ endsOn: '2026-10-04' })], 'GRAND10', day)).toBeNull();
  });
});
