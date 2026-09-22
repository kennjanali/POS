/**
 * Demo data generator — a month of trading, for looking at the app with
 * something in it. Deliberately not part of any real path:
 *
 *  - Only reachable while `settings.trainingMode` is on. Once a POS is
 *    BIR-registered it may not be switched back into training mode, so a
 *    registered install can never seed fake sales over real ones.
 *  - Every closed order's frozen totals come from `computeBill`, the same
 *    function `closeOrder` uses. If the tax engine changes, this data changes
 *    with it instead of drifting into a second, wrong source of truth.
 *  - Invoice numbers are generated per branch in chronological order, so the
 *    per-branch sequence stays gapless the way BIR requires.
 */

import { businessDate } from './format';
import { uuidv7 } from './id';
import { type Centavos, addC, cents, mulQty } from './money';
import { BRANCH_COLORS, OPENING_STOCK, QUICK_LABELS } from './seed';
import { computeBill, type DiscountKind } from './tax';
import type {
  Branch,
  Order,
  OrderLine,
  OrderType,
  Product,
  Settings,
  StockMove,
  Tender,
  TenderMethod,
} from './types';

export interface DemoOptions {
  products: Product[];
  settings: Settings;
  /** The install's own first branch. Kept as-is; demo branches are added beside it. */
  mainBranch: Branch;
  days?: number;
  ordersPerDay?: number;
  /** End of the generated window. Defaults to now. */
  now?: number;
}

export interface DemoDataset {
  branches: Branch[];
  orders: Order[];
  stock: Record<string, Record<string, number>>;
  stockMoves: StockMove[];
  invoiceSeq: Record<string, number>;
}

/** Added alongside the install's own branch, so the switcher has something to switch. */
const DEMO_BRANCHES: Omit<Branch, 'color'>[] = [
  {
    id: 'BR002',
    name: 'Mall Branch',
    address: 'SM City Bacolod, Reclamation Area',
    branchCode: '00001',
    active: true,
  },
  {
    id: 'BR003',
    name: 'Terminal Branch',
    address: 'Ceres Bus Terminal, Bacolod City',
    branchCode: '00002',
    active: true,
  },
];

/**
 * mulberry32. Seeded so a demo month is reproducible — two people looking at
 * the same numbers is worth more here than fresh randomness.
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

const ORDER_TYPES: readonly [OrderType, number][] = [
  ['dine-in', 55],
  ['takeout', 20],
  ['grab', 15],
  ['panda', 10],
];

const DISCOUNTS: readonly [DiscountKind, number][] = [
  ['none', 85],
  ['senior', 7],
  ['pwd', 4],
  ['custom', 4],
];

const TENDERS: readonly [TenderMethod, number][] = [
  ['cash', 55],
  ['gcash', 20],
  ['maya', 10],
  ['card', 10],
  ['bank', 3],
  ['other', 2],
];

const WALK_IN_NAMES = [
  'Aling Nena',
  'Kuya Boy',
  'Ate Mheg',
  'Tito Ram',
  'Sir Dodong',
  'Maam Inday',
];

const VOID_REASONS = [
  'Wrong table',
  'Customer walked out',
  'Rung up twice',
  'Kitchen could not serve',
];

export function buildDemoData(options: DemoOptions): DemoDataset {
  const {
    products,
    settings,
    mainBranch,
    days = 30,
    ordersPerDay = 40,
    now = Date.now(),
  } = options;

  const sellable = products.filter((p) => p.active);
  if (sellable.length === 0) {
    return {
      branches: [mainBranch],
      orders: [],
      stock: {},
      stockMoves: [],
      invoiceSeq: {},
    };
  }

  const rand = rng(0x4b52414d); // "KRAM"

  const branches: Branch[] = [
    mainBranch,
    ...DEMO_BRANCHES.map((b, i) => ({
      ...b,
      color: BRANCH_COLORS[(i + 1) % BRANCH_COLORS.length]!,
    })),
  ];

  const orders: Order[] = [];
  const stockMoves: StockMove[] = [];
  const invoiceSeq: Record<string, number> = {};
  const stock: Record<string, Record<string, number>> = {};

  // Opening count, one move per product per branch, dated before the window.
  const windowStart = startOfDay(now - (days - 1) * 86_400_000);
  for (const branch of branches) {
    const branchStock: Record<string, number> = {};
    stock[branch.id] = branchStock;
    for (const product of sellable) {
      branchStock[product.id] = OPENING_STOCK;
      stockMoves.push({
        id: uuidv7(),
        branchId: branch.id,
        productId: product.id,
        delta: OPENING_STOCK,
        reason: 'opening',
        refOrderId: null,
        note: 'Demo opening count',
        at: windowStart - 3_600_000,
        actorUserId: null,
      });
    }
  }

  for (let back = days - 1; back >= 0; back--) {
    const dayStart = startOfDay(now - back * 86_400_000);
    const isToday = back === 0;

    for (const branch of branches) {
      const branchStock = stock[branch.id]!;

      // Weekends run busier, Mondays quieter. A flat 40/day reads as fake at
      // a glance, and the revenue-by-day chart is the point of a demo month.
      const dow = new Date(dayStart).getDay();
      const busy = dow === 0 || dow === 6 ? 1.25 : dow === 1 ? 0.8 : 1;

      // Trading day is 10:00-21:00. Today counts only the part that has
      // actually happened, so a demo loaded at 11am does not claim a full
      // day's takings. The last 45 minutes are left for the live tables.
      const dayOpen = dayStart + 10 * 3_600_000;
      const dayClose = dayStart + 21 * 3_600_000;
      const end = Math.min(dayClose, isToday ? now - 45 * 60_000 : dayClose);
      const traded = isToday
        ? Math.min(1, Math.max(0, (end - dayOpen) / (dayClose - dayOpen)))
        : 1;
      const count = Math.round(ordersPerDay * busy * (0.85 + rand() * 0.3) * traded);

      const built: Order[] = [];
      const demand = new Map<string, number>();
      const record = (order: Order) => {
        for (const line of order.lines) {
          demand.set(line.productId, (demand.get(line.productId) ?? 0) + line.qty);
        }
        built.push(order);
      };

      for (let i = 0; i < count; i++) {
        const openedAt = dayOpen + Math.floor(((i + rand()) / count) * (end - dayOpen));
        const order = newOrder(rand, branch, invoiceSeq, openedAt, sellable);
        settleOrder(rand, order, settings);
        // A handful get voided after the fact, so that path has data too.
        if (rand() < 0.015) {
          order.status = 'voided';
          order.voidedReason = pick(rand, VOID_REASONS);
          order.voidedAt = (order.closedAt ?? openedAt) + 300_000;
        }
        record(order);
      }

      // Live tables. Generated off the clock rather than off the trading-day
      // window, so the POS floor is never empty however early the demo loads.
      if (isToday) {
        const live = 3 + Math.floor(rand() * 2);
        for (let i = 0; i < live; i++) {
          // Oldest first, so the invoice sequence still tracks the clock.
          const minutesAgo = 40 - Math.round((i * 36) / Math.max(1, live - 1));
          const openedAt = Math.max(dayStart, now - minutesAgo * 60_000);
          const order = newOrder(rand, branch, invoiceSeq, openedAt, sellable);
          leaveOpen(rand, order);
          record(order);
        }
      }

      // Restock at open to cover the day plus what is left on the shelf at
      // close. Done after generating the day because that is the only way to
      // know demand. The closing buffer clears the low-stock threshold so the
      // warning means something when it does fire.
      for (const product of sellable) {
        const closing = settings.lowStockAt + 5 + Math.floor(rand() * 25);
        const onHand = branchStock[product.id] ?? 0;
        const needed = (demand.get(product.id) ?? 0) + closing;
        const delta = Math.max(0, needed - onHand);
        if (delta === 0) continue;
        branchStock[product.id] = onHand + delta;
        stockMoves.push({
          id: uuidv7(),
          branchId: branch.id,
          productId: product.id,
          delta,
          reason: 'restock',
          refOrderId: null,
          note: `Delivery ${businessDate(dayStart)}`,
          at: dayStart + 8 * 3_600_000,
          actorUserId: null,
        });
      }

      // Serving deducts, voiding returns — the same bookkeeping the store does.
      for (const order of built) {
        for (const line of order.lines) {
          if (!line.served) continue;
          branchStock[line.productId] = (branchStock[line.productId] ?? 0) - line.qty;
          stockMoves.push({
            id: uuidv7(),
            branchId: order.branchId,
            productId: line.productId,
            delta: -line.qty,
            reason: 'sale',
            refOrderId: order.id,
            note: null,
            at: line.servedAt ?? order.openedAt,
            actorUserId: null,
          });
          if (order.status !== 'voided') continue;
          branchStock[line.productId] = (branchStock[line.productId] ?? 0) + line.qty;
          stockMoves.push({
            id: uuidv7(),
            branchId: order.branchId,
            productId: line.productId,
            delta: line.qty,
            reason: 'void',
            refOrderId: order.id,
            note: order.voidedReason,
            at: order.voidedAt ?? order.openedAt,
            actorUserId: null,
          });
        }
        orders.push(order);
      }
    }
  }

  // Two items per branch came up short on the closing count. A restock can
  // only add, so this has to be its own correction — which is also the honest
  // way to model it, and gives the low-stock warning something to warn about.
  for (const branch of branches) {
    const branchStock = stock[branch.id]!;
    const short = new Set<string>();
    while (short.size < Math.min(2, sellable.length)) {
      short.add(pick(rand, sellable).id);
    }
    for (const productId of short) {
      const onHand = branchStock[productId] ?? 0;
      const counted = Math.floor(rand() * 4);
      if (onHand <= counted) continue;
      branchStock[productId] = counted;
      stockMoves.push({
        id: uuidv7(),
        branchId: branch.id,
        productId,
        delta: counted - onHand,
        reason: 'count',
        refOrderId: null,
        note: 'Short on closing count',
        at: now - 20 * 60_000,
        actorUserId: null,
      });
    }
  }

  stockMoves.sort((a, b) => b.at - a.at);
  return { branches, orders, stock, stockMoves, invoiceSeq };
}

/** A fresh order with the branch's next invoice number. Mutates `invoiceSeq`. */
function newOrder(
  rand: () => number,
  branch: Branch,
  invoiceSeq: Record<string, number>,
  openedAt: number,
  products: Product[],
): Order {
  const seq = (invoiceSeq[branch.id] ?? 0) + 1;
  invoiceSeq[branch.id] = seq;
  const type = weighted(rand, ORDER_TYPES);
  return {
    id: uuidv7(),
    invoiceNo: `${branch.branchCode}-${String(seq).padStart(7, '0')}`,
    branchId: branch.id,
    label: labelFor(rand, type),
    type,
    status: 'closed',
    openedAt,
    closedAt: null,
    lines: buildLines(rand, products),
    tenders: [],
    discountKind: 'none',
    customPercent: 20,
    diners: 1,
    eligibleDiners: 1,
    discountIdNo: null,
    discountIdName: null,
    grossCents: cents(0),
    vatableCents: cents(0),
    vatExemptCents: cents(0),
    vatCents: cents(0),
    discountCents: cents(0),
    netCents: cents(0),
    voidedReason: null,
    voidedAt: null,
    // Demo trading predates any user account, and inventing actors would put
    // names on the audit trail that never touched the till.
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

function labelFor(rand: () => number, type: OrderType): string {
  if (type === 'grab') return 'GrabFood';
  if (type === 'panda') return 'FoodPanda';
  if (type === 'takeout') return rand() < 0.5 ? 'Takeout' : pick(rand, WALK_IN_NAMES);
  return pick(rand, QUICK_LABELS);
}

/** 1-4 distinct items, quantities 1-3. Rice goes with almost everything. */
function buildLines(rand: () => number, products: Product[]): OrderLine[] {
  const wanted = 1 + Math.floor(rand() * 4);
  const chosen: Product[] = [];
  const rice = products.find((p) => /kanin|rice/i.test(p.name));
  if (rice && rand() < 0.7) chosen.push(rice);

  let guard = 0;
  while (chosen.length < wanted && guard++ < 40) {
    const candidate = pick(rand, products);
    if (!chosen.some((p) => p.id === candidate.id)) chosen.push(candidate);
  }

  return chosen.map((product, i) => ({
    lineNo: i + 1,
    productId: product.id,
    name: product.name,
    unitCents: product.priceCents,
    costCents: product.costCents,
    qty: 1 + Math.floor(rand() * 3),
    served: true,
    servedAt: null,
    voided: false,
    voidReason: null,
  }));
}

/** An order still on the floor: first line served, the rest with the kitchen. */
function leaveOpen(rand: () => number, order: Order) {
  order.status = 'open';
  order.lines = order.lines.map((line, i) => {
    const served = i === 0 || rand() < 0.4;
    return { ...line, served, servedAt: served ? order.openedAt + 360_000 : null };
  });
}

/** Close the order: freeze the bill exactly as `closeOrder` does, then pay it. */
function settleOrder(rand: () => number, order: Order, settings: Settings) {
  const servedAt = order.openedAt + (4 + Math.floor(rand() * 9)) * 60_000;
  order.lines = order.lines.map((line) => ({ ...line, servedAt }));

  const kind = weighted(rand, DISCOUNTS);
  order.discountKind = kind;
  if (kind === 'custom') {
    order.customPercent = pick(rand, [5, 10, 15, 20]);
  }
  if (kind === 'senior' || kind === 'pwd') {
    // A shared bill some of the time — the RR 7-2010 path deserves coverage.
    const diners = rand() < 0.35 ? 2 + Math.floor(rand() * 3) : 1;
    order.diners = diners;
    order.eligibleDiners = diners > 1 ? 1 + Math.floor(rand() * 2) : 1;
    order.discountIdNo = `${kind === 'senior' ? 'SC' : 'PWD'}-${
      100_000 + Math.floor(rand() * 899_999)
    }`;
    order.discountIdName = pick(rand, WALK_IN_NAMES);
  }

  const gross = order.lines.reduce<Centavos>(
    (sum, line) => addC(sum, mulQty(line.unitCents, line.qty)),
    cents(0),
  );
  const bill = computeBill(gross, settings, {
    kind: order.discountKind,
    customPercent: order.customPercent,
    diners: order.diners,
    eligibleDiners: order.eligibleDiners,
  });

  order.grossCents = bill.gross;
  order.vatableCents = bill.vatableSale;
  order.vatExemptCents = bill.vatExemptSale;
  order.vatCents = bill.vat;
  order.discountCents = bill.discount;
  order.netCents = bill.amountDue;
  order.closedAt = servedAt + (2 + Math.floor(rand() * 20)) * 60_000;
  order.tenders = [buildTender(rand, bill.amountDue, order.closedAt)];
}

function buildTender(rand: () => number, due: Centavos, at: number): Tender {
  const method = weighted(rand, TENDERS);
  if (method === 'cash') {
    // Cashiers get handed round money. Round up to the next 20 pesos.
    const handed = cents(Math.ceil(due / 2000) * 2000);
    return {
      id: uuidv7(),
      method,
      amountCents: due,
      tenderedCents: handed,
      changeCents: cents(handed - due),
      refNo: null,
      takenAt: at,
    };
  }
  const referenced =
    method === 'gcash' || method === 'maya' || method === 'card' || method === 'bank';
  return {
    id: uuidv7(),
    method,
    amountCents: due,
    tenderedCents: null,
    changeCents: null,
    refNo: referenced
      ? String(1_000_000_000 + Math.floor(rand() * 9_000_000_000))
      : null,
    takenAt: at,
  };
}
