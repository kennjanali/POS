import { describe, expect, it } from 'vitest';

import { cents } from './money';
import { formatQty, lineTotal, parseQty, qty, type Qty } from './qty';

describe('lineTotal', () => {
  it('prices 2.5 m at ₱38.40 as ₱96.00', () => {
    expect(lineTotal(cents(3840), parseQty('2.5', true)!)).toBe(9600);
  });

  it('rounds half a centavo up', () => {
    expect(lineTotal(cents(1001), qty(0.5))).toBe(501);
  });
});

describe('parseQty', () => {
  it('refuses a decimal on a whole-number unit', () => {
    expect(parseQty('2.5', false)).toBeNull();
  });

  it('refuses a comma for the decimal point', () => {
    expect(parseQty('2,5', true)).toBeNull();
  });

  it('refuses less than one thousandth', () => {
    expect(parseQty('0.0004', true)).toBeNull();
  });

  it('refuses a negative quantity', () => {
    expect(parseQty('-1', true)).toBeNull();
  });

  it('refuses more than 3 decimals', () => {
    expect(parseQty('1.2345', true)).toBeNull();
  });

  it('refuses zero', () => {
    expect(parseQty('0', true)).toBeNull();
  });

  it('reads a whole number as thousandths', () => {
    expect(parseQty('3', false)).toBe(3000);
  });
});

describe('formatQty', () => {
  it('shows 2500 as 2.5', () => {
    expect(formatQty(2500 as Qty)).toBe('2.5');
  });
});
