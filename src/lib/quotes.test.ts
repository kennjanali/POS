import { describe, expect, it } from 'vitest';

import { cents } from './money';
import { addDays, nextQuoteNo, quoteStatus } from './quotes';
import type { Quote } from './types';

function quote(over: Partial<Quote> = {}): Quote {
  return {
    id: 'q1',
    quoteNo: 'Q-0001',
    status: 'open',
    lines: [],
    discount: { kind: 'none' },
    grossCents: cents(0),
    discountCents: cents(0),
    netCents: cents(0),
    customerName: null,
    customerPhone: null,
    validUntil: '2026-10-05',
    createdAt: 0,
    createdBy: null,
    convertedSaleId: null,
    cancelledReason: null,
    ...over,
  };
}

describe('nextQuoteNo', () => {
  it('pads to four digits', () => {
    expect(nextQuoteNo(1)).toBe('Q-0001');
    expect(nextQuoteNo(42)).toBe('Q-0042');
    expect(nextQuoteNo(9999)).toBe('Q-9999');
  });

  it('grows past four digits rather than wrapping', () => {
    expect(nextQuoteNo(10000)).toBe('Q-10000');
  });
});

describe('quoteStatus', () => {
  it('is open on the last day it is valid', () => {
    expect(quoteStatus(quote(), '2026-10-05')).toBe('open');
  });

  it('expires the day after', () => {
    expect(quoteStatus(quote(), '2026-10-06')).toBe('expired');
  });

  it('reports a closed quote as itself, never as expired', () => {
    expect(quoteStatus(quote({ status: 'converted' }), '2026-11-01')).toBe('converted');
    expect(quoteStatus(quote({ status: 'cancelled' }), '2026-11-01')).toBe('cancelled');
  });
});

describe('addDays', () => {
  it('crosses a month end', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
  });

  it('crosses a year end', () => {
    expect(addDays('2026-12-30', 7)).toBe('2027-01-06');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
