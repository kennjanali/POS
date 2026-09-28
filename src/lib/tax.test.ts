import { describe, expect, it } from 'vitest';

import { cents } from './money';
import { computeBill, type TaxProfile } from './tax';

const VAT: TaxProfile = { vatRegistered: true, vatRate: 0.12, vatLabel: 'VAT' };
const NONVAT: TaxProfile = { ...VAT, vatRegistered: false };

describe('computeBill', () => {
  it('none, non-VAT', () => {
    const bill = computeBill(cents(50000), NONVAT);
    expect(bill.amountDue).toBe(50000);
    expect(bill.vat).toBe(0);
  });

  it('none, VAT inclusive', () => {
    const bill = computeBill(cents(50000), VAT);
    expect(bill.vatableSale).toBe(44643);
    expect(bill.vat).toBe(5357);
    expect(bill.amountDue).toBe(50000);
  });

  it('percent 10, non-VAT', () => {
    const bill = computeBill(cents(50000), NONVAT, { kind: 'percent', percent: 10 });
    expect(bill.discount).toBe(5000);
    expect(bill.amountDue).toBe(45000);
  });

  it('percent 10, VAT inclusive', () => {
    const bill = computeBill(cents(50000), VAT, { kind: 'percent', percent: 10 });
    expect(bill.discount).toBe(5000);
    expect(bill.amountDue).toBe(45000);
    expect(bill.vatableSale).toBe(40179);
    expect(bill.vat).toBe(4821);
  });

  it('percent rounds half-up', () => {
    // 10% of 1005 centavos is 100.5.
    const bill = computeBill(cents(1005), NONVAT, { kind: 'percent', percent: 10 });
    expect(bill.discount).toBe(101);
  });

  it('percent rounds half-up where floating point would round it down', () => {
    // 29% of 50 is exactly 14.5, but 50 × 0.29 is 14.4999… in floating point.
    expect(computeBill(cents(50), NONVAT, { kind: 'percent', percent: 29 }).discount).toBe(15);
    expect(computeBill(cents(750), NONVAT, { kind: 'percent', percent: 29 }).discount).toBe(218);
    // Every exact half-centavo from 1 to 20000 centavos, at every whole percent.
    for (let gross = 1; gross <= 20000; gross += 1) {
      for (let pct = 1; pct <= 100; pct += 1) {
        const exact = Math.floor((gross * pct + 50) / 100);
        const got = computeBill(cents(gross), NONVAT, { kind: 'percent', percent: pct }).discount;
        if (got !== exact) throw new Error(`${pct}% of ${gross}: ${got}, not ${exact}`);
      }
    }
  });

  it('strips VAT half-up at the half-centavo', () => {
    // 14 / 1.12 is exactly 12.5.
    const bill = computeBill(cents(14), VAT);
    expect(bill.vatableSale).toBe(13);
    expect(bill.vat).toBe(1);
  });

  it('percent 100', () => {
    const bill = computeBill(cents(50000), NONVAT, { kind: 'percent', percent: 100 });
    expect(bill.amountDue).toBe(0);
  });

  it('fixed ₱50, non-VAT', () => {
    const bill = computeBill(cents(50000), NONVAT, { kind: 'fixed', cents: cents(5000) });
    expect(bill.discount).toBe(5000);
    expect(bill.amountDue).toBe(45000);
  });

  it('fixed larger than the bill', () => {
    const bill = computeBill(cents(3000), NONVAT, { kind: 'fixed', cents: cents(5000) });
    expect(bill.discount).toBe(3000);
    expect(bill.amountDue).toBe(0);
  });

  it('percent is clamped', () => {
    expect(computeBill(cents(50000), NONVAT, { kind: 'percent', percent: -5 }).discount).toBe(0);
    expect(computeBill(cents(50000), NONVAT, { kind: 'percent', percent: 150 }).discount).toBe(
      50000,
    );
  });

  it('VAT included, ₱1,120', () => {
    const bill = computeBill(cents(112000), VAT);
    expect(bill.vatableSale).toBe(100000);
    expect(bill.vat).toBe(12000);
    expect(bill.amountDue).toBe(112000);
  });

  it('VAT after a 10% promo', () => {
    const bill = computeBill(cents(112000), VAT, { kind: 'percent', percent: 10 });
    expect(bill.discount).toBe(11200);
    expect(bill.amountDue).toBe(100800);
    expect(bill.vat).toBe(10800);
  });
});
