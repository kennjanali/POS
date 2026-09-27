import { describe, expect, it } from 'vitest';

import { can, type Permission } from './permissions';

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
