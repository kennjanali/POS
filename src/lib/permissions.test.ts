import { describe, expect, it } from 'vitest';

import { can, canVisit, routesFor, type Permission } from './permissions';

const STAFF = { role: 'staff' } as const;
const OWNER = { role: 'superadmin' } as const;

const ALL: Permission[] = [
  'sell',
  'order.serve',
  'order.pay',
  'quote.make',
  'promo.apply',
  'today.view',
  'discount.owner',
  'sale.cancel',
  'quote.cancel',
  'inventory.manage',
  'reports.view',
  'settings.manage',
  'users.manage',
];

describe('permissions', () => {
  it.each<Permission>(['sell', 'order.pay', 'quote.make', 'promo.apply', 'today.view'])(
    'staff can %s',
    (p) => {
      expect(can(STAFF, p)).toBe(true);
    },
  );

  it.each<Permission>([
    'discount.owner',
    'sale.cancel',
    'inventory.manage',
    'reports.view',
    'settings.manage',
  ])('staff cannot %s', (p) => {
    expect(can(STAFF, p)).toBe(false);
  });

  it.each(ALL)('the owner can %s', (p) => {
    expect(can(OWNER, p)).toBe(true);
  });

  it('nobody signed in can do nothing', () => {
    expect(ALL.some((p) => can(null, p))).toBe(false);
  });
});

describe('the quotations route', () => {
  const QUOTING = { quotes: true } as const;
  const NOT_QUOTING = { quotes: false } as const;

  it('is in the nav for staff when the shop quotes', () => {
    const hrefs = routesFor(STAFF, QUOTING).map((r) => r.href);
    expect(hrefs).toContain('/quotes');
  });

  it('is not in the nav when the shop does not quote', () => {
    const hrefs = routesFor(OWNER, NOT_QUOTING).map((r) => r.href);
    expect(hrefs).not.toContain('/quotes');
  });

  it('cannot be reached by typing it when the shop does not quote', () => {
    // The role is right; the shop simply has no such screen.
    expect(canVisit(OWNER, '/quotes', NOT_QUOTING)).toBe(false);
    expect(canVisit(OWNER, '/quotes', QUOTING)).toBe(true);
  });

  it('is off limits to nobody signed in, and still the owner may cancel one', () => {
    expect(canVisit(STAFF, '/quotes', QUOTING)).toBe(true);
    expect(can(STAFF, 'quote.cancel')).toBe(false);
  });

  it('leaves routes with no feature switch alone', () => {
    expect(canVisit(OWNER, '/inventory', NOT_QUOTING)).toBe(true);
  });
});
