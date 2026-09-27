import { beforeEach, describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { migrateBlobV7, migrateSnapshot } from '@/lib/migrate';
import type { DataSnapshot, Product, User } from '@/lib/types';
import { ownerShop, resetStore, signInAs } from '@/test/store';
import { usePos } from './usePos';

const S = () => usePos.getState();

const PRODUCT: Product = {
  id: 'p-new',
  name: 'New item',
  unit: 'pc',
  priceCents: cents(10000),
  costCents: cents(4000),
  vatExempt: false,
  active: true,
};

function user(role: string): User {
  return {
    id: `u-${role}`,
    name: role,
    role,
    active: true,
    pin: { salt: '', hash: '', iterations: 1 },
    createdAt: 1,
    lastLoginAt: null,
  } as unknown as User;
}

describe('store guards', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
  });

  it('refuses a product change from staff and leaves the products alone', () => {
    const before = S().products;
    signInAs('staff');
    expect(S().upsertProduct(PRODUCT)).toEqual({ ok: false, error: 'Only the owner can do that.' });
    expect(S().products).toBe(before);
  });

  it('refuses a cancel from staff and leaves the sale alone', () => {
    const id = S().openOrder('T1', 'dine-in');
    signInAs('staff');
    expect(S().voidOrder(id, 'wrong table')).toEqual({ ok: false, error: 'Only the owner can do that.' });
    expect(S().order(id)?.status).toBe('open');
  });

  it('lets the owner do both', () => {
    expect(S().upsertProduct(PRODUCT)).toEqual({ ok: true });
    const id = S().openOrder('T1', 'dine-in');
    expect(S().voidOrder(id, 'wrong table')).toEqual({ ok: true });
    expect(S().order(id)?.status).toBe('voided');
  });
});

describe('role migration', () => {
  it('turns a purchaser in a backup into staff', () => {
    const snapshot = {
      version: 7,
      products: [PRODUCT],
      users: [user('superadmin'), user('purchaser')],
    } as unknown as DataSnapshot;
    expect(migrateSnapshot(snapshot).users?.map((u) => u.role)).toEqual(['superadmin', 'staff']);
  });

  it('turns a waiter in the saved blob into staff', () => {
    const blob = migrateBlobV7({ users: [user('waiter')] }) as { users: User[] };
    expect(blob.users[0]?.role).toBe('staff');
  });
});
