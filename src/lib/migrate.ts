/**
 * Stored data, v7 → v8. The single place old data changes shape: the persisted
 * blob, order rows and backup files all go through the steps below. Each step
 * is a small named function, so later changes to v8 add a step here rather
 * than a second migration somewhere else.
 */

import { withDefaults } from './features';
import { qty, type Qty } from './qty';
import type { DiscountRequest } from './tax';
import type {
  DataSnapshot,
  Order,
  OrderLine,
  OrderType,
  Product,
  SaleDiscount,
  Settings,
  StockMove,
  User,
} from './types';

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

/** Every v7 line was a stock item, counted in whole units, and carried no unit. */
function migrateLineV7(line: { qty: number }): OrderLine {
  return { ...line, kind: 'stock', unit: '', qty: qty(line.qty) } as OrderLine;
}

/** A v7 order as v8 stores it. Frozen totals are untouched. */
export function migrateOrderV7(o: unknown): Order {
  const v7 = o as { type: string; lines?: { qty: number }[] };
  const order: Record<string, unknown> = {
    // v7 asked nothing about the customer and had no quotations.
    customerName: null,
    customerPhone: null,
    vehiclePlate: null,
    fromQuoteId: null,
    ...(o as Record<string, unknown>),
    type: orderTypeV7(v7.type),
    discount: discountV7(o as OrderDiscountV7),
    lines: v7.lines?.map(migrateLineV7),
  };
  for (const field of ORDER_FIELDS_V7) delete order[field];
  return order as unknown as Order;
}

// ── stock ────────────────────────────────────────────────────────────────

/** A v7 stock move, counted in thousandths. */
export function migrateMoveV7(m: unknown): StockMove {
  const move = m as Omit<StockMove, 'supplier' | 'docNo' | 'unitCostCents'>;
  return { supplier: null, docNo: null, unitCostCents: null, ...move, delta: qty(move.delta) };
}

/** On hand per branch, counted in thousandths. */
function migrateStockV7(
  stock: Record<string, Record<string, number>>,
): Record<string, Record<string, Qty>> {
  return Object.fromEntries(
    Object.entries(stock).map(([branchId, onHand]) => [
      branchId,
      Object.fromEntries(Object.entries(onHand).map(([id, units]) => [id, qty(units)])),
    ]),
  );
}

/** Every v7 product was a stock item, with no SKU, category or level of its own. */
function migrateProductV7(product: Product): Product {
  return { ...product, kind: 'stock', sku: null, category: '', reorderLevel: null };
}

// ── settings ─────────────────────────────────────────────────────────────

/**
 * Settings as this build reads them, from a blob or a backup: every field
 * present, only the switches this build knows, and nothing left from the
 * shop-type presets that came before the general POS. `base` supplies what
 * the saved copy lacks.
 */
export function settingsFromSaved(saved: Partial<Settings> | undefined, base: Settings): Settings {
  const kept = { ...(saved ?? {}) } as Partial<Settings> & { shopType?: unknown };
  delete kept.shopType;
  return { ...base, ...kept, features: withDefaults(saved?.features ?? base.features) };
}

/**
 * Prices always include VAT now, so the old switch has nothing to say. Every
 * v7 install was a restaurant, the only shop the app knew, so it keeps
 * working as one: tickets called tables, served before they are paid.
 */
function migrateSettingsV7(settings: Settings): Settings {
  const next: Settings & { pricesIncludeVat?: boolean } = {
    ...settings,
    features: { openOrders: true, serveStep: true, quotes: false, vehiclePlate: false, measuredUnits: false },
    ticketLabel: 'Table',
    contactNumber: '',
    quoteValidDays: 7,
    checklistDismissed: [],
  };
  // A partial backup may leave it out; the current setting then stands.
  if (settings.lowStockAt !== undefined) next.lowStockAt = qty(settings.lowStockAt);
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
 * The persisted blob (see `partialize` in usePos.ts). Orders and stock moves
 * are not migrated here: they live in row stores, which the blob cannot see.
 * `rowsNeedV8` tells `loadRows` to migrate them as they load, from the row
 * store or from an old blob that still holds them. A v7 blob also held the
 * products.
 */
export function migrateBlobV7(blob: unknown): unknown {
  const b = {
    ...(blob as {
      settings?: Settings;
      users?: User[];
      products?: Product[];
      stock?: Record<string, Record<string, number>>;
    }),
    rowsNeedV8: true,
  };
  if (b.settings) b.settings = migrateSettingsV7(b.settings);
  if (b.users) b.users = b.users.map(migrateUserV7);
  if (b.products) b.products = b.products.map(migrateProductV7);
  if (b.stock) b.stock = migrateStockV7(b.stock);
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
    products: s.products?.map(migrateProductV7),
    orders: s.orders?.map(migrateOrderV7),
    stock: s.stock && migrateStockV7(s.stock),
    stockMoves: s.stockMoves?.map(migrateMoveV7),
  };
}
