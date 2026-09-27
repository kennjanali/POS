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
