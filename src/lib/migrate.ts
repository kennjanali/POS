/**
 * Stored data, v7 → v8. The single place old data changes shape: the persisted
 * blob, order rows and backup files all go through the steps below. Each step
 * is a small named function, so later changes to v8 add a step here rather
 * than a second migration somewhere else.
 */

import { applyPreset } from './presets';
import type { DiscountRequest } from './tax';
import type { DataSnapshot, Order, OrderType, SaleDiscount, Settings, User } from './types';

/** What the tax engine gets for a sale's discount. A legacy discount is frozen
 *  history and takes nothing off a new bill. */
export function discountRequest(d: SaleDiscount): DiscountRequest {
  if (d.kind === 'promo') return { kind: 'percent', percent: d.percent };
  if (d.kind === 'owner') {
    if (d.percent !== null) return { kind: 'percent', percent: d.percent };
    if (d.fixedCents !== null) return { kind: 'fixed', cents: d.fixedCents };
  }
  return { kind: 'none' };
}

// ── orders ───────────────────────────────────────────────────────────────

/** The discount fields a v7 order carried. None of them survive into v8. */
interface OrderDiscountV7 {
  discountKind?: 'none' | 'senior' | 'pwd' | 'custom';
  customPercent?: number;
}

const ORDER_FIELDS_V7 = [
  'discountKind',
  'customPercent',
  'diners',
  'eligibleDiners',
  'discountIdNo',
  'discountIdName',
];

function discountV7({ discountKind, customPercent }: OrderDiscountV7): SaleDiscount {
  // Senior/PWD is gone. Those sales keep their frozen totals as they were.
  if (discountKind === 'senior' || discountKind === 'pwd') return { kind: 'legacy' };
  if (discountKind === 'custom') {
    return { kind: 'owner', percent: customPercent ?? 0, fixedCents: null, by: null };
  }
  return { kind: 'none' };
}

/** GrabFood and FoodPanda became one delivery type. */
function orderTypeV7(type: string): OrderType {
  return type === 'grab' || type === 'panda' ? 'delivery' : (type as OrderType);
}

/** A v7 order as v8 stores it. Frozen totals are untouched. */
export function migrateOrderV7(o: unknown): Order {
  const order: Record<string, unknown> = {
    ...(o as Record<string, unknown>),
    type: orderTypeV7((o as { type: string }).type),
    discount: discountV7(o as OrderDiscountV7),
  };
  for (const field of ORDER_FIELDS_V7) delete order[field];
  return order as unknown as Order;
}

// ── settings ─────────────────────────────────────────────────────────────

/**
 * Prices always include VAT now, so the old switch has nothing to say. Every
 * v7 install was a restaurant, the only shop the app knew, so it keeps the
 * restaurant switches.
 */
function migrateSettingsV7(settings: Settings): Settings {
  const next: Settings & { pricesIncludeVat?: boolean } = {
    ...settings,
    shopType: 'restaurant',
    features: applyPreset('restaurant'),
    contactNumber: '',
    quoteValidDays: 7,
    checklistDismissed: [],
  };
  delete next.pricesIncludeVat;
  return next;
}

// ── users ────────────────────────────────────────────────────────────────

/** Waiter and purchaser merged into one Staff role. The owner is unchanged. */
function migrateUserV7(user: User): User {
  const role: string = user.role;
  return role === 'waiter' || role === 'purchaser' ? { ...user, role: 'staff' } : user;
}

// ── the persisted blob and backup files ──────────────────────────────────

/**
 * The persisted blob (see `partialize` in usePos.ts). Orders are not migrated
 * here: `loadRows` migrates them as they load, from the row store or from an
 * old blob that still holds them.
 */
export function migrateBlobV7(blob: unknown): unknown {
  const b = { ...(blob as { settings?: Settings; users?: User[] }) };
  if (b.settings) b.settings = migrateSettingsV7(b.settings);
  if (b.users) b.users = b.users.map(migrateUserV7);
  return b;
}

/** A backup file, whichever version wrote it, as v8. */
export function migrateSnapshot(s: DataSnapshot): DataSnapshot {
  if (s.version === 8) return s;
  return {
    ...s,
    version: 8,
    settings: s.settings && migrateSettingsV7(s.settings),
    users: s.users?.map(migrateUserV7),
    orders: s.orders?.map(migrateOrderV7),
  };
}
