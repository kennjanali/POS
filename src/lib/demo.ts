/**
 * Demo businesses — a few weeks of trading for one kind of shop, for practice
 * mode and the web demo. POS-034 is one general POS; these four show what it
 * does for a restaurant, a hardware store, an auto shop and a car wash, each
 * with its own items, switches and name for an open sale. Deliberately not
 * part of any real path:
 *
 *  - Only reachable while practice mode is on. A live install can never be
 *    switched back, so fake sales can never land over real books.
 *  - Every closed sale's frozen totals come from `computeBill`, the same
 *    function `closeOrder` uses, so this data cannot drift from the tax engine.
 *  - Invoice numbers are issued in time order, so the sequence stays gapless.
 *    Open tickets have no number yet, like any open sale.
 *  - Stock never goes below zero, and the ledger adds up to the stock map.
 *  - Nothing is dated after `now`.
 *
 * One install is one shop, so the demo is one branch: the install's own.
 */

import { byOpening, seedCatalog, stockLine, type CatalogItem } from './catalogs';
import { buildClose, signClose } from './closes';
import { businessDate } from './format';
import { uuidv7 } from './id';
import { discountRequest } from './migrate';
import { type Centavos, addC, cents } from './money';
import { orderTypesFor, type Features } from './features';
import { addDays, nextQuoteNo } from './quotes';
import { decimalsAllowed, lineTotal, qty, type Qty } from './qty';
import { QUICK_LABELS } from './seed';
import { computeBill } from './tax';
import type {
  Branch,
  DailyClose,
  Order,
  OrderLine,
  OrderType,
  Product,
  Promo,
  Quote,
  QuoteLine,
  SaleDiscount,
  Settings,
  StockMove,
  Tender,
  TenderMethod,
} from './types';

export type DemoId = 'restaurant' | 'hardware' | 'auto' | 'carwash';

export interface DemoBusiness {
  id: DemoId;
  label: string;
  items: CatalogItem[];
  /** The switches this kind of shop would turn on; loading the demo applies them. */
  features: Features;
  /** What its open sales are called. */
  ticketLabel: string;
  /** The random seed, so each business has its own, stable weeks. */
  seed: number;
}

export interface DemoOptions {
  business: DemoId;
  /** The install's settings; the demo's switches and ticket word are laid over them. */
  settings: Settings;
  /** The install's own branch. */
  branch: Branch;
  days?: number;
  salesPerDay?: number;
  /** End of the generated window. Defaults to now. */
  now?: number;
  /** The last sale and quote numbers already issued, so none is issued twice. */
  invoiceSeq?: number;
  quoteSeq?: number;
}

export interface DemoDataset {
  products: Product[];
  orders: Order[];
  stock: Record<string, Record<string, Qty>>;
  stockMoves: StockMove[];
  quotes: Quote[];
  promos: Promo[];
  invoiceSeq: Record<string, number>;
  quoteSeq: number;
}

/** The promo code every demo business runs, used on some of its sales. */
export const DEMO_PROMO_CODE = 'DEMO10';

const RESTAURANT_ITEMS: CatalogItem[] = [
  { name: 'Chicken Paa', category: '', price: 89, cost: 50, unit: 'pcs', opening: 30 },
  { name: 'Chicken Pecho', category: '', price: 99, cost: 55, unit: 'pcs', opening: 30 },
  { name: 'Half Chicken', category: '', price: 175, cost: 95, unit: 'pcs', opening: 20 },
  { name: 'Pork BBQ', category: '', price: 35, cost: 18, unit: 'pcs', opening: 100 },
  { name: 'Pork Chop BBQ', category: '', price: 120, cost: 65, unit: 'pcs', opening: 30 },
  { name: 'Liempo', category: '', price: 150, cost: 80, unit: 'pcs', opening: 20 },
  { name: 'Kanin (1 cup)', category: '', price: 15, cost: 6, unit: 'cup', opening: 60 },
  { name: 'Garlic Rice', category: '', price: 25, cost: 10, unit: 'cup', opening: 60 },
  { name: 'Coke 1.5L', category: '', price: 85, cost: 45, unit: 'btl', opening: 24 },
  { name: 'Softdrinks', category: '', price: 35, cost: 18, unit: 'pcs', opening: 60 },
  { name: 'Atchara', category: '', price: 20, cost: 8, unit: 'serving', opening: 40 },
  { name: 'Sawsawan Set', category: '', price: 15, cost: 5, unit: 'set', opening: 40 },
].map(stockLine);

/** A hardware store sells by the piece and by the measure. */
const HARDWARE_ITEMS: CatalogItem[] = [
  { name: 'Wire 1.0mm', category: 'Electrical', price: 18, cost: 11, unit: 'm', opening: 500 },
  { name: 'Wire 2.0mm', category: 'Electrical', price: 28, cost: 19, unit: 'm', opening: 300 },
  { name: 'Insulation Tape', category: 'Electrical', price: 35, cost: 20, unit: 'roll', opening: 80 },
  { name: 'Nails 1 inch', category: 'Fasteners', price: 95, cost: 62, unit: 'kg', opening: 50 },
  { name: 'Nails 2 inch', category: 'Fasteners', price: 110, cost: 74, unit: 'kg', opening: 40 },
  { name: 'Common Nails 3 inch', category: 'Fasteners', price: 125, cost: 85, unit: 'kg', opening: 40 },
  { name: 'Screw Assortment', category: 'Fasteners', price: 90, cost: 52, unit: 'box', opening: 30 },
  { name: 'Cutting Disc 4"', category: 'Hardware', price: 55, cost: 28, unit: 'pcs', opening: 50 },
  { name: 'Sandpaper 80 grit', category: 'Paint', price: 25, cost: 12, unit: 'pcs', opening: 60 },
  { name: 'Paint (white, 1L)', category: 'Paint', price: 380, cost: 290, unit: 'btl', opening: 24 },
  { name: 'Paint (white, 4L)', category: 'Paint', price: 1350, cost: 1050, unit: 'pail', opening: 10 },
  { name: 'Cement', category: 'Building', price: 65, cost: 48, unit: 'kg', opening: 200 },
  { name: 'Sand', category: 'Building', price: 35, cost: 22, unit: 'kg', opening: 300 },
  { name: 'PVC Pipe 1/2"', category: 'Plumbing', price: 75, cost: 52, unit: 'm', opening: 60 },
].map(stockLine);

/** Tires by size, mags, and the work done to fit them. */
const AUTO_ITEMS: CatalogItem[] = [
  { name: 'Tire 185/65 R14', category: 'Tires', price: 3200, cost: 2450, unit: 'pcs', opening: 20 },
  { name: 'Tire 195/65 R15', category: 'Tires', price: 3850, cost: 3000, unit: 'pcs', opening: 16 },
  { name: 'Tire 205/55 R16', category: 'Tires', price: 4600, cost: 3600, unit: 'pcs', opening: 12 },
  { name: 'Tire 215/60 R17', category: 'Tires', price: 5800, cost: 4550, unit: 'pcs', opening: 8 },
  { name: 'Alloy Mag 14"', category: 'Wheels', price: 8500, cost: 6200, unit: 'pcs', opening: 6 },
  { name: 'Alloy Mag 15"', category: 'Wheels', price: 9800, cost: 7200, unit: 'pcs', opening: 4 },
  { name: 'Steel Mag 14"', category: 'Wheels', price: 3200, cost: 2100, unit: 'pcs', opening: 6 },
  { name: 'Tire Vulcanization (small)', category: 'Service', price: 350, cost: 120, unit: 'pcs', opening: 0 },
  { name: 'Tire Vulcanization (large)', category: 'Service', price: 500, cost: 180, unit: 'pcs', opening: 0 },
  { name: 'Wheel Alignment', category: 'Service', price: 800, cost: 250, unit: 'pcs', opening: 0 },
  { name: 'Wheel Balancing', category: 'Service', price: 300, cost: 80, unit: 'pcs', opening: 0 },
  { name: 'Labor (per hour)', category: 'Service', price: 200, cost: 0, unit: 'hr', opening: 0 },
  { name: 'Engine Oil 10W-40', category: 'Supplies', price: 380, cost: 290, unit: 'L', opening: 40 },
  { name: 'Oil Filter', category: 'Supplies', price: 250, cost: 160, unit: 'pcs', opening: 30 },
].map(byOpening);

/** Wash sizes, wax, and the inside of the car. */
const CARWASH_ITEMS: CatalogItem[] = [
  { name: 'Regular Wash', category: 'Wash', price: 250, cost: 60, unit: 'pcs', opening: 0 },
  { name: 'SUV Wash', category: 'Wash', price: 350, cost: 90, unit: 'pcs', opening: 0 },
  { name: 'Van Wash', category: 'Wash', price: 450, cost: 120, unit: 'pcs', opening: 0 },
  { name: 'Engine Wash', category: 'Wash', price: 600, cost: 180, unit: 'pcs', opening: 0 },
  { name: 'Underbody Wash', category: 'Wash', price: 500, cost: 160, unit: 'pcs', opening: 0 },
  { name: 'Wax (car)', category: 'Wax', price: 700, cost: 200, unit: 'pcs', opening: 0 },
  { name: 'Wax (SUV)', category: 'Wax', price: 950, cost: 280, unit: 'pcs', opening: 0 },
  { name: 'Tire Shine', category: 'Wax', price: 150, cost: 40, unit: 'pcs', opening: 0 },
  { name: 'Interior Vacuum', category: 'Interior', price: 200, cost: 50, unit: 'pcs', opening: 0 },
  { name: 'Interior Detailing', category: 'Interior', price: 1200, cost: 350, unit: 'pcs', opening: 0 },
  { name: 'Dashboard Wax', category: 'Interior', price: 400, cost: 110, unit: 'pcs', opening: 0 },
  { name: 'Shampoo', category: 'Supplies', price: 120, cost: 70, unit: 'L', opening: 40 },
  { name: 'Microfiber Towel', category: 'Supplies', price: 80, cost: 35, unit: 'pcs', opening: 60 },
].map(byOpening);

/** The four businesses the Settings screen offers. */
export const DEMO_BUSINESSES: DemoBusiness[] = [
  {
    id: 'restaurant',
    label: 'Restaurant',
    items: RESTAURANT_ITEMS,
    features: { openOrders: true, serveStep: true, quotes: false, vehiclePlate: false, measuredUnits: false },
    ticketLabel: 'Table',
    seed: 0x4b52414d,
  },
  {
    id: 'hardware',
    label: 'Hardware Store',
    items: HARDWARE_ITEMS,
    features: { openOrders: false, serveStep: false, quotes: true, vehiclePlate: false, measuredUnits: true },
    ticketLabel: 'Sale',
    seed: 0x48415244,
  },
  {
    id: 'auto',
    label: 'Auto Parts & Service',
    items: AUTO_ITEMS,
    features: { openOrders: true, serveStep: false, quotes: true, vehiclePlate: true, measuredUnits: false },
    ticketLabel: 'Job',
    seed: 0x4155544f,
  },
  {
    id: 'carwash',
    label: 'Car Wash',
    items: CARWASH_ITEMS,
    features: { openOrders: true, serveStep: false, quotes: false, vehiclePlate: true, measuredUnits: false },
    ticketLabel: 'Queue',
    seed: 0x57415348,
  },
];

export function demoBusiness(id: DemoId): DemoBusiness {
  return DEMO_BUSINESSES.find((b) => b.id === id)!;
}

/**
 * mulberry32. Seeded so a demo is reproducible — two people looking at the
 * same numbers is worth more here than fresh randomness.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/** Pick from [value, weight] pairs. Weights need not sum to 1. */
function weighted<T>(rand: () => number, table: readonly [T, number][]): T {
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of table) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return table[table.length - 1]![0];
}

const TENDERS: readonly [TenderMethod, number][] = [
  ['cash', 60],
  ['gcash', 25],
  ['maya', 8],
  ['card', 5],
  ['bank', 2],
];

const CUSTOMERS = ['Aling Nena', 'Kuya Boy', 'Ate Mheg', 'Tito Ram', 'Sir Dodong', 'Maam Inday'];

const VOID_REASONS = ['Rung up twice', 'Customer changed their mind', 'Wrong item'];

export function buildDemoData(options: DemoOptions): DemoDataset {
  const { branch, days = 21, salesPerDay = 30, now = Date.now(), invoiceSeq = 0, quoteSeq = 1 } = options;
  const business = demoBusiness(options.business);
  const { features, ticketLabel } = business;
  const settings: Settings = { ...options.settings, features, ticketLabel };
  const rand = rng(business.seed);
  const bid = branch.id;

  const { products, opening } = seedCatalog(business.items);
  const stocked = products.filter((p) => p.kind === 'stock');
  const onHand: Record<string, Qty> = {};
  const stockMoves: StockMove[] = [];
  const move = (m: Omit<StockMove, 'id' | 'branchId' | 'actorUserId' | 'supplier' | 'docNo' | 'unitCostCents'>) =>
    stockMoves.push({
      id: uuidv7(),
      branchId: bid,
      actorUserId: null,
      supplier: null,
      docNo: null,
      unitCostCents: null,
      ...m,
    });
  const shift = (productId: string, delta: number) => {
    onHand[productId] = ((onHand[productId] ?? 0) + delta) as Qty;
  };

  // The catalog's opening count, dated before the window.
  const windowStart = startOfDay(now - (days - 1) * 86_400_000);
  for (const product of stocked) {
    const q = opening[product.id] ?? qty(0);
    onHand[product.id] = q;
    if (q > 0) {
      move({ productId: product.id, delta: q, reason: 'opening', refOrderId: null, note: 'Demo opening count', at: windowStart - 3_600_000 });
    }
  }

  const promo: Promo = {
    id: uuidv7(),
    code: DEMO_PROMO_CODE,
    percent: 10,
    note: 'Demo: 10% off',
    active: true,
    startsOn: null,
    endsOn: null,
    // Made before anything that uses it, quotes included.
    createdAt: Math.min(windowStart, now - 4 * 86_400_000) - 7_200_000,
    firstUsedAt: null,
  };
  const promoDiscount: SaleDiscount = { kind: 'promo', promoId: promo.id, code: promo.code, percent: promo.percent };

  const orders: Order[] = [];
  let invoiceNo = invoiceSeq;
  const plates = features.vehiclePlate;
  const orderTypes = orderTypesFor(features);

  for (let back = days - 1; back >= 0; back--) {
    const dayStart = startOfDay(now - back * 86_400_000);
    const isToday = back === 0;

    // Weekends busier, Mondays quieter; a flat count reads as fake at a glance.
    const dow = new Date(dayStart).getDay();
    const busy = dow === 0 || dow === 6 ? 1.25 : dow === 1 ? 0.8 : 1;

    // Trading day 08:00-19:00. Today counts only what has happened, ending
    // 45 minutes before now so nothing a sale needs lands in the future.
    const dayOpen = dayStart + 8 * 3_600_000;
    const dayClose = dayStart + 19 * 3_600_000;
    let from = dayOpen;
    let end = dayClose;
    let share = 1;
    if (isToday) {
      end = Math.min(dayClose, now - 45 * 60_000);
      // Loaded before the doors would open: spread a few sales over the hours
      // that have passed, so Today is not blank against weeks of history.
      if (end <= dayOpen + 30 * 60_000) {
        from = Math.max(dayStart, now - 5 * 3_600_000);
        end = now - 45 * 60_000;
      }
      // Just after midnight nothing has had time to happen yet today.
      share = end > from ? Math.min(1, Math.max(0.1, (end - from) / (dayClose - dayOpen))) : 0;
    }
    const count =
      share === 0 ? 0 : Math.max(isToday ? 2 : 1, Math.round(salesPerDay * busy * (0.85 + rand() * 0.3) * share));

    // Build the day first to know the demand, restock before the doors open,
    // then settle each sale in time order.
    const day: { order: Order; closedAt: number }[] = [];
    const demand = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const openedAt = from + Math.floor(((i + rand()) / count) * (end - from));
      const lines = buildLines(rand, products, settings);
      for (const l of lines) if (l.kind === 'stock') demand.set(l.productId, (demand.get(l.productId) ?? 0) + l.qty);
      const order = blankOrder(rand, bid, openedAt, lines, pick(rand, orderTypes), business.id, plates);
      day.push({ order, closedAt: openedAt + (5 + Math.floor(rand() * 25)) * 60_000 });
    }

    // A delivery each morning covers the day and leaves the shelf healthy.
    for (const product of stocked) {
      const buffer = settings.lowStockAt * 2 + qty(Math.floor(rand() * 20));
      const needed = (demand.get(product.id) ?? 0) + buffer - (onHand[product.id] ?? 0);
      if (needed <= 0) continue;
      const delta = roundUpToWhole(needed) as Qty;
      shift(product.id, delta);
      // Before the doors open, and before the first sale however early today began.
      const at = Math.min(dayStart + 7 * 3_600_000, from - 60_000);
      move({ productId: product.id, delta, reason: 'restock', refOrderId: null, note: `Delivery ${businessDate(dayStart)}`, at });
    }

    for (const { order, closedAt } of day.sort((a, b) => a.closedAt - b.closedAt)) {
      if (rand() < 0.08) order.discount = promoDiscount;
      else if (rand() < 0.03) order.discount = { kind: 'owner', percent: pick(rand, [5, 10, 15]), fixedCents: null, by: null };
      settle(rand, order, settings, closedAt);
      invoiceNo += 1;
      order.invoiceNo = `${branch.branchCode}-${String(invoiceNo).padStart(7, '0')}`;
      if (order.discount.kind === 'promo' && promo.firstUsedAt === null) promo.firstUsedAt = closedAt;
      for (const line of order.lines) {
        if (line.kind !== 'stock') continue;
        shift(line.productId, -line.qty);
        move({ productId: line.productId, delta: -line.qty as Qty, reason: 'sale', refOrderId: order.id, note: null, at: closedAt });
      }
      // A few are cancelled after the fact, so that path has data too.
      if (rand() < 0.015) {
        order.status = 'voided';
        order.voidedReason = pick(rand, VOID_REASONS);
        order.voidedAt = closedAt + 5 * 60_000;
        for (const line of order.lines) {
          if (line.kind !== 'stock') continue;
          shift(line.productId, line.qty);
          move({ productId: line.productId, delta: line.qty, reason: 'void', refOrderId: order.id, note: order.voidedReason, at: order.voidedAt });
        }
      }
      orders.push(order);
    }
  }

  // Open tickets on the floor right now, where the shop keeps tickets. They
  // hold stock rather than take it, unless a line was already served.
  if (features.openOrders) {
    const live = 2 + Math.floor(rand() * 2);
    let opened = 0;
    for (let i = 0; i < live; i++) {
      const openedAt = now - (35 - i * 12) * 60_000;
      const lines = buildLines(rand, products, settings).filter(
        (l) => l.kind !== 'stock' || available(onHand, orders, l.productId) >= l.qty,
      );
      if (lines.length === 0) continue;
      const order = blankOrder(rand, bid, openedAt, lines, pick(rand, orderTypes), business.id, plates);
      order.status = 'open';
      opened += 1;
      order.label = `${ticketLabel} ${opened}`;
      order.lines = order.lines.map((line, n) => {
        // With a serve step the first line has gone out; served stock is taken.
        const served = features.serveStep && n === 0;
        if (served && line.kind === 'stock') {
          shift(line.productId, -line.qty);
          move({ productId: line.productId, delta: -line.qty as Qty, reason: 'sale', refOrderId: order.id, note: null, at: openedAt + 5 * 60_000 });
        }
        return { ...line, served, servedAt: served ? openedAt + 5 * 60_000 : null };
      });
      orders.push(order);
    }
  }

  // Two items came up short on a shelf count just now, so the low-stock list has
  // something on it. Counted down to at or below the reorder level, never
  // below what the open tickets are holding.
  // Low the way the app judges it: what is left after open tickets' holds is
  // at or under the reorder level. The count keeps the holds on the shelf.
  const held = holds(orders);
  const level = settings.lowStockAt;
  const candidates = stocked.filter((p) => (onHand[p.id] ?? 0) - (held.get(p.id) ?? 0) > level);
  const short = new Set<string>();
  while (short.size < Math.min(2, candidates.length)) short.add(pick(rand, candidates).id);
  for (const productId of short) {
    // Whole units left over, rounded down, so a part-unit level is still met.
    const counted = ((held.get(productId) ?? 0) + Math.floor((rand() * level) / 1000) * 1000) as Qty;
    const delta = counted - (onHand[productId] ?? 0);
    if (delta >= 0) continue;
    shift(productId, delta);
    move({ productId, delta: delta as Qty, reason: 'count', refOrderId: null, note: 'Short on the shelf count', at: now - 60_000 });
  }

  // Three quotations still open, where the shop makes quotes: customers who
  // asked and have not come back. Oldest first, so the numbers run in time order.
  const quotes: Quote[] = [];
  for (let i = features.quotes ? 2 : -1; i >= 0; i--) {
    const createdAt = now - (i + 1) * 86_400_000 - Math.floor(rand() * 3_600_000);
    const lines: QuoteLine[] = buildLines(rand, products, settings).map((l) => ({
      lineNo: l.lineNo,
      productId: l.productId,
      name: l.name,
      kind: l.kind,
      unitCents: l.unitCents,
      unit: l.unit,
      qty: l.qty,
    }));
    const gross = lines.reduce<Centavos>((sum, l) => addC(sum, lineTotal(l.unitCents, l.qty)), cents(0));
    const discount: SaleDiscount = i === 2 ? promoDiscount : { kind: 'none' };
    const bill = computeBill(gross, settings, discountRequest(discount));
    quotes.push({
      id: uuidv7(),
      quoteNo: nextQuoteNo(quoteSeq + quotes.length),
      status: 'open',
      lines,
      discount,
      grossCents: bill.gross,
      discountCents: bill.discount,
      netCents: bill.amountDue,
      customerName: pick(rand, CUSTOMERS),
      customerPhone: `0917${String(1_000_000 + Math.floor(rand() * 8_999_999))}`,
      validUntil: addDays(businessDate(createdAt), settings.quoteValidDays),
      createdAt,
      createdBy: null,
      convertedSaleId: null,
      cancelledReason: null,
    });
  }

  stockMoves.sort((a, b) => b.at - a.at);
  return {
    products,
    orders,
    stock: { [bid]: onHand },
    stockMoves,
    quotes,
    promos: [promo],
    invoiceSeq: { [bid]: invoiceNo },
    quoteSeq: quoteSeq + quotes.length,
  };
}

/**
 * Today's summary for every past day of a demo, chained and signed the way
 * the till does it at 23:59. Without them the first summary after loading
 * would cover the whole demo in one day.
 */
export async function closeDemoDays(orders: Order[], now: number): Promise<DailyClose[]> {
  const paid = orders.filter((o) => o.closedAt !== null).map((o) => o.closedAt!);
  if (paid.length === 0) return [];
  const closes: DailyClose[] = [];
  const today = startOfDay(now);
  for (let day = startOfDay(Math.min(...paid)); day < today; day = startOfDay(day + 36 * 3_600_000)) {
    const at = day + (23 * 60 + 59) * 60_000;
    const previous = closes.at(-1) ?? null;
    closes.push(await signClose(buildClose({ id: uuidv7(), orders, previous, now: at, actor: null })));
  }
  return closes;
}

/** What open tickets hold, by product: unserved stock lines. */
function holds(orders: Order[]): Map<string, number> {
  const held = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== 'open') continue;
    for (const l of o.lines) {
      if (l.kind === 'stock' && !l.served) held.set(l.productId, (held.get(l.productId) ?? 0) + l.qty);
    }
  }
  return held;
}

function available(onHand: Record<string, Qty>, orders: Order[], productId: string): number {
  return (onHand[productId] ?? 0) - (holds(orders).get(productId) ?? 0);
}

/** Deliveries and counts come in whole units. */
function roundUpToWhole(q: number): number {
  return Math.ceil(q / 1000) * 1000;
}

function blankOrder(
  rand: () => number,
  branchId: string,
  openedAt: number,
  lines: OrderLine[],
  type: OrderType,
  business: DemoId,
  plates: boolean,
): Order {
  return {
    id: uuidv7(),
    invoiceNo: null,
    branchId,
    label: labelFor(rand, type, business),
    type,
    status: 'closed',
    customerName: null,
    customerPhone: null,
    vehiclePlate: plates ? plate(rand) : null,
    fromQuoteId: null,
    openedAt,
    closedAt: null,
    lines,
    tenders: [],
    discount: { kind: 'none' },
    grossCents: cents(0),
    vatableCents: cents(0),
    vatExemptCents: cents(0),
    vatCents: cents(0),
    discountCents: cents(0),
    netCents: cents(0),
    voidedReason: null,
    voidedAt: null,
    // Demo trading predates any user account, and inventing actors would put
    // names on the log that never touched the till.
    openedBy: null,
    servedBy: null,
    paidBy: null,
    voidedBy: null,
  };
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function labelFor(rand: () => number, type: OrderType, business: DemoId): string {
  if (type === 'delivery') return business === 'restaurant' ? pick(rand, ['GrabFood', 'FoodPanda']) : 'Delivery';
  if (type === 'dine-in') return pick(rand, QUICK_LABELS);
  return rand() < 0.5 ? 'Walk-in' : pick(rand, CUSTOMERS);
}

function plate(rand: () => number): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const three = Array.from({ length: 3 }, () => letters[Math.floor(rand() * letters.length)]).join('');
  return `${three} ${1000 + Math.floor(rand() * 9000)}`;
}

/** 1-4 distinct items. Measured items come in part-units, others whole. */
function buildLines(rand: () => number, products: Product[], settings: Settings): OrderLine[] {
  const wanted = 1 + Math.floor(rand() * 4);
  const chosen: Product[] = [];
  const rice = products.find((p) => /kanin|rice/i.test(p.name));
  if (rice && rand() < 0.6) chosen.push(rice);
  let guard = 0;
  while (chosen.length < wanted && guard++ < 40) {
    const candidate = pick(rand, products);
    if (!chosen.some((p) => p.id === candidate.id)) chosen.push(candidate);
  }
  return chosen.map((product, i) => {
    const measured = decimalsAllowed(product.unit, settings.features);
    // 0.5 to 5 of a metre or a kilo, in half steps; 1 to 3 of anything else.
    const q = measured ? (500 * (1 + Math.floor(rand() * 10))) as Qty : qty(1 + Math.floor(rand() * 3));
    return {
      lineNo: i + 1,
      productId: product.id,
      name: product.name,
      unitCents: product.priceCents,
      costCents: product.costCents,
      kind: product.kind,
      unit: product.unit,
      qty: q,
      served: false,
      servedAt: null,
      voided: false,
      voidReason: null,
    };
  });
}

/** Close the sale: freeze the bill exactly as `closeOrder` does, then pay it. */
function settle(rand: () => number, order: Order, settings: Settings, closedAt: number) {
  const servedAt = closedAt - 60_000;
  order.lines = order.lines.map((line) => ({ ...line, served: true, servedAt }));
  const gross = order.lines.reduce<Centavos>((sum, l) => addC(sum, lineTotal(l.unitCents, l.qty)), cents(0));
  const bill = computeBill(gross, settings, discountRequest(order.discount));
  order.grossCents = bill.gross;
  order.vatableCents = bill.vatableSale;
  order.vatCents = bill.vat;
  order.discountCents = bill.discount;
  order.netCents = bill.amountDue;
  order.closedAt = closedAt;
  order.tenders = bill.amountDue > 0 ? [tender(rand, bill.amountDue, closedAt)] : [];
}

function tender(rand: () => number, due: Centavos, at: number): Tender {
  const method = weighted(rand, TENDERS);
  if (method === 'cash') {
    // Cashiers get handed round money: up to the next 20 pesos.
    const handed = cents(Math.ceil(due / 2000) * 2000);
    return { id: uuidv7(), method, amountCents: due, tenderedCents: handed, changeCents: cents(handed - due), refNo: null, takenAt: at };
  }
  return {
    id: uuidv7(),
    method,
    amountCents: due,
    tenderedCents: null,
    changeCents: null,
    refNo: String(1_000_000_000 + Math.floor(rand() * 9_000_000_000)),
    takenAt: at,
  };
}
