/**
 * Monthly sales archives.
 *
 * Sales stay in IndexedDB while they are current. At the end of a month the
 * whole month is written out as one JSON file, and once that file has been
 * read back and verified the month is removed from the device. The live store
 * therefore holds the current month rather than every month ever traded, which
 * is what keeps the app fast years in.
 *
 * An archive is self-contained on purpose. It carries the products, branches
 * and staff names as they were, so a file opened two years from now still
 * renders correctly even if the menu has been rewritten since.
 */

import { businessDate } from './format';
import { addC, cents, type Centavos } from './money';
import {
  TENDER_METHODS,
  type Branch,
  type Order,
  type Product,
  type StockMove,
  type TenderMethod,
  type User,
} from './types';

export const ARCHIVE_VERSION = 1;

/** Staff are reduced to what a receipt or report needs. PINs never go in. */
export interface ArchivedStaff {
  id: string;
  name: string;
  role: string;
}

export interface MonthTotals {
  orders: number;
  voided: number;
  gross: Centavos;
  discount: Centavos;
  vat: Centavos;
  net: Centavos;
  cost: Centavos;
  grossProfit: Centavos;
  byTender: Record<TenderMethod, Centavos>;
  byBranch: { branchId: string; name: string; orders: number; net: Centavos }[];
  byProduct: { productId: string; name: string; qty: number; revenue: Centavos }[];
  busiestDay: { date: string; net: Centavos } | null;
}

export interface MonthlyArchive {
  version: typeof ARCHIVE_VERSION;
  /** "2026-09". The month these sales belong to. */
  month: string;
  exportedAt: string;
  businessName: string;
  /** Precomputed so opening a file answers "how did we do" without a rescan. */
  totals: MonthTotals;
  branches: Branch[];
  products: Product[];
  staff: ArchivedStaff[];
  orders: Order[];
  stockMoves: StockMove[];
}

/** "2026-09" for a timestamp. Local time, matching businessDate. */
export function monthOf(ts: number): string {
  return businessDate(ts).slice(0, 7);
}

/** The month an order belongs to: when it was settled, else when it opened. */
export function orderMonth(order: Order): string {
  return monthOf(order.closedAt ?? order.openedAt);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

/** `kramgen-2026-09.json` — sorts chronologically in a folder listing. */
export function archiveFileName(month: string): string {
  return `kramgen-${month}.json`;
}

/**
 * Every month present on the device, newest first. The current month is
 * excluded: it is still being traded and is not finished being written.
 */
export function archivableMonths(
  orders: Order[],
  now: number = Date.now(),
): { month: string; orders: number; net: Centavos }[] {
  const current = monthOf(now);
  const byMonth = new Map<string, { orders: number; net: number }>();

  for (const order of orders) {
    if (order.status === 'open') continue;
    const month = orderMonth(order);
    if (month >= current) continue;
    const entry = byMonth.get(month) ?? { orders: 0, net: 0 };
    entry.orders += 1;
    if (order.status === 'closed') entry.net += order.netCents;
    byMonth.set(month, entry);
  }

  return [...byMonth.entries()]
    .map(([month, v]) => ({ month, orders: v.orders, net: cents(v.net) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

function emptyTenders(): Record<TenderMethod, Centavos> {
  return Object.fromEntries(TENDER_METHODS.map((m) => [m, cents(0)])) as Record<
    TenderMethod,
    Centavos
  >;
}

export function summarise(
  orders: Order[],
  products: Product[],
  branches: Branch[],
): MonthTotals {
  const byTender = emptyTenders();
  const byBranch = new Map<string, { orders: number; net: number }>();
  const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
  const byDay = new Map<string, number>();

  let gross = 0;
  let discount = 0;
  let vat = 0;
  let net = 0;
  let cost = 0;
  let voided = 0;
  let closed = 0;

  for (const order of orders) {
    if (order.status === 'voided') {
      voided += 1;
      continue;
    }
    if (order.status !== 'closed') continue;
    closed += 1;

    gross += order.grossCents;
    discount += order.discountCents;
    vat += order.vatCents;
    net += order.netCents;

    const day = businessDate(order.closedAt ?? order.openedAt);
    byDay.set(day, (byDay.get(day) ?? 0) + order.netCents);

    const branch = byBranch.get(order.branchId) ?? { orders: 0, net: 0 };
    branch.orders += 1;
    branch.net += order.netCents;
    byBranch.set(order.branchId, branch);

    for (const tender of order.tenders) {
      byTender[tender.method] = cents(byTender[tender.method] + tender.amountCents);
    }

    for (const line of order.lines) {
      if (!line.served || line.voided) continue;
      // Cost frozen on the line; older lines fall back to the product.
      const unitCost =
        line.costCents ?? products.find((p) => p.id === line.productId)?.costCents ?? 0;
      cost += unitCost * line.qty;

      const entry = byProduct.get(line.productId) ?? {
        name: line.name,
        qty: 0,
        revenue: 0,
      };
      entry.qty += line.qty;
      entry.revenue += line.unitCents * line.qty;
      byProduct.set(line.productId, entry);
    }
  }

  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    orders: closed,
    voided,
    gross: cents(gross),
    discount: cents(discount),
    vat: cents(vat),
    net: cents(net),
    cost: cents(cost),
    grossProfit: cents(net - vat - cost),
    byTender,
    byBranch: [...byBranch.entries()]
      .map(([branchId, v]) => ({
        branchId,
        name: branches.find((b) => b.id === branchId)?.name ?? branchId,
        orders: v.orders,
        net: cents(v.net),
      }))
      .sort((a, b) => b.net - a.net),
    byProduct: [...byProduct.entries()]
      .map(([productId, v]) => ({
        productId,
        name: v.name,
        qty: v.qty,
        revenue: cents(v.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue),
    busiestDay: busiest ? { date: busiest[0], net: cents(busiest[1]) } : null,
  };
}

export interface ArchiveSource {
  month: string;
  businessName: string;
  branches: Branch[];
  products: Product[];
  users: User[];
  orders: Order[];
  stockMoves: StockMove[];
}

export function buildArchive(source: ArchiveSource): MonthlyArchive {
  const orders = source.orders.filter(
    (o) => o.status !== 'open' && orderMonth(o) === source.month,
  );
  const ids = new Set(orders.map((o) => o.id));
  const stockMoves = source.stockMoves.filter(
    (m) => monthOf(m.at) === source.month || (m.refOrderId && ids.has(m.refOrderId)),
  );

  return {
    version: ARCHIVE_VERSION,
    month: source.month,
    exportedAt: new Date().toISOString(),
    businessName: source.businessName,
    totals: summarise(orders, source.products, source.branches),
    branches: source.branches,
    products: source.products,
    // Names only. A credential has no business sitting in a sales report.
    staff: source.users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    orders,
    stockMoves,
  };
}

/**
 * Why a file is not a usable archive, or null if it is. Pruning a month from
 * the device depends on this answering null, so it checks the sales are
 * actually present rather than just that the shape looks right.
 */
export function describeBadArchive(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'That file is not a monthly archive.';
  const a = value as Partial<MonthlyArchive>;

  if (a.version !== ARCHIVE_VERSION) {
    return `That archive is version ${a.version ?? 'unknown'}; this app reads version ${ARCHIVE_VERSION}.`;
  }
  if (typeof a.month !== 'string' || !/^\d{4}-\d{2}$/.test(a.month)) {
    return 'That archive does not say which month it covers.';
  }
  for (const key of ['orders', 'stockMoves', 'products', 'branches'] as const) {
    if (!Array.isArray(a[key])) return `That archive is damaged — "${key}" is not a list.`;
  }
  if (!a.totals || typeof a.totals !== 'object') {
    return 'That archive is damaged — its totals are missing.';
  }
  if (a.orders!.some((o) => orderMonth(o) !== a.month)) {
    return 'That archive contains sales from another month.';
  }
  return null;
}

/**
 * Does this file actually hold the month it claims, in full? Compared against
 * what is still on the device before anything is deleted.
 */
export function archiveCoversDevice(
  archive: MonthlyArchive,
  deviceOrders: Order[],
): { ok: true } | { ok: false; error: string } {
  const onDevice = deviceOrders.filter(
    (o) => o.status !== 'open' && orderMonth(o) === archive.month,
  );
  const archived = new Set(archive.orders.map((o) => o.id));
  const missing = onDevice.filter((o) => !archived.has(o.id));

  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `That archive is missing ${missing.length} sale(s) still on this device ` +
        `— export ${monthLabel(archive.month)} again before removing it.`,
    };
  }

  const deviceNet = onDevice
    .filter((o) => o.status === 'closed')
    .reduce<Centavos>((s, o) => addC(s, o.netCents), cents(0));
  if (deviceNet !== archive.totals.net) {
    return {
      ok: false,
      error:
        `That archive totals ${archive.totals.net / 100} but this device has ` +
        `${deviceNet / 100} for ${monthLabel(archive.month)}. Export it again.`,
    };
  }
  return { ok: true };
}
