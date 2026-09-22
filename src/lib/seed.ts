import { cents } from './money';
import type { Branch, Product, Settings, User } from './types';

export const QUICK_LABELS = [
  'Table 1',
  'Table 2',
  'Table 3',
  'Table 4',
  'Table 5',
  'Table 6',
  'Bar Seat',
  'Walk-in',
  'Takeout',
];

export const BRANCH_COLORS = [
  '#ff5c1a',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#db2777',
];

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'KRAMGEN',
  address: 'Carinderia Row, Bacolod City',
  tin: '',
  currency: '\u20b1',
  receiptFooter: 'Salamat! Come again',
  showStock: true,
  lowStockAt: 10,
  trainingMode: true,

  // A carinderia under PHP 3M annual gross is a percentage-tax filer, not a
  // VAT filer. v6 hard-coded VAT on. The honest default is off — switch it on
  // in Settings once the business is actually VAT-registered.
  vatRegistered: false,
  pricesIncludeVat: true,
  vatRate: 0.12,
  vatLabel: 'VAT',
};

export const DEFAULT_BRANCH: Branch = {
  id: 'BR001',
  name: 'Main Branch',
  address: 'Carinderia Row, Bacolod City',
  branchCode: '00000',
  color: '#ff5c1a',
  active: true,
};

interface SeedProduct {
  id: string;
  name: string;
  price: number;
  cost: number;
  unit: string;
}

const SEED_PRODUCTS: SeedProduct[] = [
  { id: 'p1', name: 'Chicken Paa', price: 89, cost: 50, unit: 'pc' },
  { id: 'p2', name: 'Chicken Pecho', price: 99, cost: 55, unit: 'pc' },
  { id: 'p3', name: 'Half Chicken', price: 175, cost: 95, unit: 'pc' },
  { id: 'p4', name: 'Pork BBQ', price: 35, cost: 18, unit: 'stick' },
  { id: 'p5', name: 'Pork Chop BBQ', price: 120, cost: 65, unit: 'pc' },
  { id: 'p6', name: 'Liempo', price: 150, cost: 80, unit: 'pc' },
  { id: 'p7', name: 'Kanin (1 cup)', price: 15, cost: 6, unit: 'cup' },
  { id: 'p8', name: 'Garlic Rice', price: 25, cost: 10, unit: 'cup' },
  { id: 'p9', name: 'Coke 1.5L', price: 85, cost: 45, unit: 'btl' },
  { id: 'p10', name: 'Softdrinks', price: 35, cost: 18, unit: 'can' },
  { id: 'p11', name: 'Atchara', price: 20, cost: 8, unit: 'serving' },
  { id: 'p12', name: 'Sawsawan Set', price: 15, cost: 5, unit: 'set' },
];

export const DEFAULT_PRODUCTS: Product[] = SEED_PRODUCTS.map((p) => ({
  id: p.id,
  name: p.name,
  unit: p.unit,
  priceCents: cents(p.price * 100),
  costCents: cents(p.cost * 100),
  vatExempt: false,
  active: true,
}));

export const OPENING_STOCK = 30;

// ── The account that ships with the till ─────────────────────────────────
//
// A POS you cannot sign in to is useless, and there is no server here to
// reset a forgotten PIN against. So every fresh install starts with one
// superadmin whose PIN is 000000, printed below in plain sight because it is
// meant to be public — it is a way in, not a secret.
//
// It is also a wide-open door on a till that handles cash, so the app nags
// about it on every screen until the PIN is changed, and the nag only clears
// when the credential stops being this one.

export const DEFAULT_PIN = '000000';

/**
 * PBKDF2-HMAC-SHA256 of DEFAULT_PIN, 210k iterations, with a fixed salt.
 *
 * Precomputed because hashing is async and the store's initial state is not.
 * A fixed, published salt is worthless for a PIN that is already published;
 * the moment the owner sets their own, `setUserPin` generates a fresh random
 * one like every other credential.
 */
export const DEFAULT_PIN_CREDENTIAL = {
  salt: 'hxRzD6XAW5G58j3SvP9tFg==',
  hash: 'ENXUQFRiYGBFGugQc0ZaJHIN5JTDkBj4LGr86lPyirE=',
  iterations: 210_000,
} as const;

export const DEFAULT_SUPERADMIN: User = {
  id: '00000000-0000-7000-8000-000000000001',
  name: 'Owner',
  role: 'superadmin',
  active: true,
  pin: { ...DEFAULT_PIN_CREDENTIAL },
  createdAt: 0,
  lastLoginAt: null,
};

/** True while this account can still be opened with 000000. */
export function hasDefaultPin(user: { pin: { salt: string } }): boolean {
  return user.pin.salt === DEFAULT_PIN_CREDENTIAL.salt;
}
