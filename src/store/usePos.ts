'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { APP_VERSION, LICENSE_SERVER_URL, PRODUCT_NAME } from '@/lib/brand';
import { buildClose, inWindow, signClose } from '@/lib/closes';
import { createBackupKey, sealBackup, uploadBackup, type BackupKey } from '@/lib/cloudBackup';
import { buildDemoData, DEMO_BUSINESSES } from '@/lib/demo';
import { deviceFingerprint } from '@/lib/device';
import { verifyLicense, type License } from '@/lib/license';
import {
  hashPin,
  hashRecoveryCode,
  isValidPin,
  verifyPin,
  verifyRecoveryCode,
  PIN_LENGTH,
  type PinCredential,
} from '@/lib/crypto';
import {
  ROWS,
  blobStorage,
  onPersistWrite,
  readRows,
  takePendingBlob,
  writeBatch,
  type WriteBatch,
} from '@/lib/storage';
import { uuidv7 } from '@/lib/id';
import { businessDate } from '@/lib/format';
import {
  archiveCoversDevice,
  archivableMonths,
  buildArchive,
  describeBadArchive,
  monthLabel,
  orderMonth,
  type MonthlyArchive,
} from '@/lib/archive';
import { can, isLastActiveSuperadmin, type Permission } from '@/lib/permissions';
import { type Centavos, addC, cents } from '@/lib/money';
import {
  discountRequest,
  migrateBlobV7,
  migrateMoveV7,
  migrateOrderV7,
  migrateSnapshot,
} from '@/lib/migrate';
import { applyPreset, PRESETS, ticketWord, type ShopType } from '@/lib/presets';
import { findUsablePromo, isValidCode, normalizeCode } from '@/lib/promo';
import { addDays, nextQuoteNo, quoteStatus } from '@/lib/quotes';
import { QTY_ONE, formatQty, lineTotal, type Qty } from '@/lib/qty';
import { computeBill, type BillBreakdown } from '@/lib/tax';
import { UPGRADE_RESET_NOTE } from '@/lib/stockHistory';
import { DEFAULT_BRANCH, DEFAULT_SETTINGS } from '@/lib/seed';
import { OPENING_STOCK, seedCatalog } from '@/lib/catalogs';
import { dismissed } from '@/lib/checklist';
import { nameKey, type ImportPreview } from '@/lib/csv';
import { actorId, useAuth } from './useAuth';
import { REFERENCED_METHODS, TENDER_LABELS } from '@/lib/types';
import type {
  AuditEntry,
  Branch,
  DailyClose,
  Order,
  OrderLine,
  OrderType,
  Product,
  ProductKind,
  Promo,
  Quote,
  QuoteLine,
  SaleDiscount,
  Settings,
  StockMove,
  Tender,
  TenderMethod,
  DataSnapshot,
  Role,
  User,
} from '@/lib/types';

/** Every user mutation can fail on a rule the UI has to explain. */
export type UserResult =
  | { ok: true; /** Something the screen should say, e.g. a cleared payment. */
      notice?: string }
  | { ok: false; error: string };

/** A quotation that was made or copied. */
export type QuoteResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string };

/** A quote turned into a real, open order. */
export type ConvertQuoteResult =
  | { ok: true; orderId: string }
  | { ok: false; error: string };

/** What the owner types to make or change a promo code. */
export interface PromoInput {
  code: string;
  percent: number;
  note?: string;
  startsOn?: string | null;
  endsOn?: string | null;
}

/**
 * The store's own permission check. Screens hide what staff may not do; this
 * refuses it anyway, so a missed button or a stale screen cannot void a sale
 * or change a price. Null means go ahead.
 */
function guard(p: Permission): { ok: false; error: string } | null {
  return can(useAuth.getState().session, p)
    ? null
    : { ok: false, error: 'Only the owner can do that.' };
}

/** Who the order is for, when the shop asks. */
export interface OrderExtra {
  customerName?: string;
  customerPhone?: string;
  vehiclePlate?: string;
}

/** What the first-run wizard collects. Four questions, and the recovery code
 *  it shows on the way out. The address and the VAT question are deliberately
 *  not here: they are a new owner's to answer, on the Today checklist. */
export interface SetupInput {
  shopType: ShopType;
  businessName: string;
  ownerName: string;
  pin: string;
  /** Generated and shown by the wizard; only its hash is kept. */
  recoveryCode: string;
  /** 'sample' loads the shop type's catalog; 'none' starts empty. */
  catalog: 'sample' | 'none';
}

interface PosState {
  branches: Branch[];
  /** Who may sign in. Business data, so it lives here and in the snapshot —
   *  the *session* is separate and never persists past the tab. */
  users: User[];
  products: Product[];
  promos: Promo[];
  /** Quotations. Paper promises of a price: they never move stock. */
  quotes: Quote[];
  /** The next number in the Q- series, kept so numbering is gapless. */
  quoteSeq: number;
  orders: Order[];
  /** branchId -> productId -> on hand */
  stock: Record<string, Record<string, Qty>>;
  stockMoves: StockMove[];
  /** Daily closes, oldest first. Written once, never changed. */
  closes: DailyClose[];
  /** Encrypts the cloud backup. Derived from the recovery code while it was on
   *  screen. Stays on this tablet: never in a snapshot or a backup file. */
  backupKey: BackupKey | null;
  /** When the last encrypted backup reached the license server. */
  lastCloudBackupAt: number | null;
  audit: AuditEntry[];
  settings: Settings;
  /** branchId -> last issued invoice number */
  invoiceSeq: Record<string, number>;
  /** Hash of the owner's recovery code. Null until the wizard has run. */
  recovery: PinCredential | null;
  /** This install's identity, generated once by the wizard. Licensing and
   *  every backup refer to it. A restore never overwrites it. */
  installId: string | null;
  /** The signed license as issued by the server. Kept in backups. */
  license: string | null;
  /** `license`, verified for this install on this tablet. Not persisted:
   *  worked out again on every launch, offline. */
  licensed: License | null;

  activeBranchId: string;
  activeOrderId: string | null;
  /** When a backup was last saved. The device is the only copy until then. */
  lastBackupAt: number | null;
  hydrated: boolean;
  persistError: string | null;
  /** Set by the v7 migration: the order and stock-move rows still count whole
   *  units. `loadRows` brings them to thousandths and clears it. */
  rowsNeedV8: boolean;

  // ── selectors ───────────────────────────────────────────────────────
  branch: (id?: string) => Branch | undefined;
  user: (id: string | null) => User | undefined;
  order: (id: string | null) => Order | undefined;
  product: (id: string) => Product | undefined;
  stockOf: (productId: string, branchId?: string) => Qty;
  /** On hand less what open orders hold, in the active branch. Never below zero. */
  available: (productId: string) => Qty;
  openOrders: () => Order[];

  // ── order lifecycle ─────────────────────────────────────────────────
  /** Opens without a number: the number is given at payment. */
  openOrder: (label: string, type: OrderType, extra?: OrderExtra) => string;
  setActiveOrder: (id: string | null) => void;
  addLine: (orderId: string, productId: string, qty?: Qty) => UserResult;
  changeQty: (orderId: string, lineNo: number, delta: Qty) => UserResult;
  voidLine: (orderId: string, lineNo: number, reason: string) => UserResult;
  serveAll: (orderId: string) => UserResult;
  serveLine: (orderId: string, lineNo: number) => UserResult;
  /** Remove an open order that never moved stock or took a number. */
  discardOpenOrder: (orderId: string) => UserResult;

  clearDiscount: (orderId: string) => UserResult;
  /** Anyone may type a promo code; an unusable one is refused and changes nothing. */
  applyPromo: (orderId: string, input: string) => UserResult;
  /** Owner only. A percent or a fixed amount; replaces any promo. */
  applyOwnerDiscount: (
    orderId: string,
    d: { percent: number } | { fixedCents: Centavos },
  ) => UserResult;

  /** Any staff may quote. The cart is thrown away and a quotation replaces it. */
  saveOrderAsQuote: (orderId: string) => QuoteResult;
  /** Opens a real order at the prices written on the quote. Any staff. */
  convertQuote: (
    quoteId: string,
    now?: number,
    options?: { confirmExpired?: boolean },
  ) => ConvertQuoteResult;
  /** Copies a quote at today's prices, under a new number. Any staff. */
  requote: (quoteId: string) => QuoteResult;
  /** The owner alone. A cancelled quote can never be converted. */
  cancelQuote: (quoteId: string, reason: string) => UserResult;

  addTender: (
    orderId: string,
    tender: Omit<Tender, 'id' | 'takenAt'>,
  ) => void;
  removeTender: (orderId: string, tenderId: string) => void;
  closeOrder: (orderId: string) => UserResult;
  /** One payment of whatever is still due, then close. GCash needs its reference. */
  payExact: (orderId: string, method: 'cash' | 'gcash', refNo?: string) => UserResult;
  voidOrder: (orderId: string, reason: string) => UserResult;

  // ── inventory ───────────────────────────────────────────────────────
  /** A delivery: one restock move per line. A new unit cost applies to future sales. */
  receiveStock: (input: {
    lines: { productId: string; qty: Qty; unitCostCents?: Centavos }[];
    supplier?: string;
    docNo?: string;
  }) => UserResult;
  /** What is on the shelf: the difference from on hand is written as a count move. */
  countStock: (productId: string, counted: Qty, note?: string) => UserResult;
  /** Damaged or spoiled stock, never more than is on hand. */
  recordDamage: (productId: string, q: Qty, note: string) => UserResult;
  /** An item added from the sell screen, sold like any other from then on. */
  quickAddProduct: (input: {
    name: string;
    priceCents: Centavos;
    kind: ProductKind;
    unit: string;
    openingQty: Qty;
  }) => { ok: true; id: string } | { ok: false; error: string };
  /** Active stock items at or below their reorder level, most urgent first. */
  lowStock: () => { productId: string; available: Qty; level: Qty }[];
  /** Products a move took to or below their reorder level, until dismissed. */
  lowStockAlerts: string[];
  dismissLowStockAlert: (productId: string) => void;
  upsertProduct: (product: Product) => UserResult;
  removeProduct: (productId: string) => UserResult;
  /** Write a previewed spreadsheet in one go. Owner only. */
  applyImport: (preview: ImportPreview) => UserResult;

  // ── promo codes ──────────────────────────────────────────────────────
  createPromo: (input: PromoInput) => UserResult;
  /** Refused once the code has been used on a closed sale. */
  updatePromo: (id: string, input: PromoInput) => UserResult;
  setPromoActive: (id: string, active: boolean) => UserResult;
  /** How many closed sales used this code. */
  promoUses: (id: string) => number;

  // ── users ───────────────────────────────────────────────────────────
  /** The PIN is the identity, so it has to be unique. Hashing is async, and
   *  so is checking a candidate against every existing hash. */
  addUser: (input: { name: string; role: Role; pin: string }) => Promise<UserResult>;
  setUserPin: (id: string, pin: string) => Promise<UserResult>;
  setUserRole: (id: string, role: Role) => UserResult;
  setUserActive: (id: string, active: boolean) => UserResult;
  recordLogin: (id: string) => void;

  // ── setup and recovery ──────────────────────────────────────────────
  /** The wizard's last step. Refused once anyone exists on this install. */
  setupInstall: (input: SetupInput) => Promise<UserResult>;
  recoveryCodeMatches: (code: string) => Promise<boolean>;
  /** Forgot-PIN path: the recovery code sets a new PIN for a superadmin. */
  resetPinWithRecoveryCode: (code: string, userId: string, pin: string) => Promise<UserResult>;
  /** For when the written copy is lost. The old code stops working. */
  replaceRecoveryCode: (code: string) => Promise<void>;
  /** A new tablet set up from a decrypted cloud backup instead of the wizard. */
  setupFromBackup: (snapshot: DataSnapshot, recoveryCode: string) => Promise<UserResult>;

  // ── license ─────────────────────────────────────────────────────────
  /** Verify the stored license for this install and tablet. Offline. */
  checkLicense: () => Promise<void>;
  /** Exchange a license key for a signed license. Needs internet once. */
  activate: (key: string) => Promise<UserResult>;

  // ── admin ───────────────────────────────────────────────────────────
  setActiveBranch: (id: string) => void;
  upsertBranch: (branch: Branch) => void;
  updateSettings: (patch: Partial<Settings>) => UserResult;
  /**
   * Replace sales history with a generated demo month. Training mode only —
   * returns the number of orders written, or 0 if the install is locked.
   */
  /** Practice mode only: replaces the shop with a demo business of this type.
   *  Returns the number of sales written, or 0 when refused. */
  loadDemoBusiness: (shopType: ShopType, options?: { days?: number; salesPerDay?: number }) => number;
  // ── monthly archive ─────────────────────────────────────────────────
  /** Finished months still held on this device, newest first. */
  archivableMonths: () => { month: string; orders: number; net: Centavos }[];
  /** Build the file for one month. Nothing is removed by this. */
  buildMonthlyArchive: (month: string) => MonthlyArchive;
  /**
   * Remove a month from the device, but only against an archive file that has
   * been read back and proven to hold every sale in it. Export alone is never
   * enough — a download can silently fail or land truncated.
   */
  pruneArchivedMonth: (archive: MonthlyArchive) => UserResult;

  exportSnapshot: () => DataSnapshot;
  importSnapshot: (snapshot: DataSnapshot) => UserResult;
  /** Training mode only. False when the install is locked. */
  resetAll: () => boolean;
  /**
   * Sales not yet in any backup. The device holds them and nothing else does,
   * so this is the number at risk if it is lost tonight.
   */
  unbackedUp: () => number;
  /** Called once a backup file has actually been handed to the browser. */
  recordBackup: () => void;
  /** Seal and upload a backup now. Licensed tablets only; needs internet. */
  uploadCloudBackup: () => Promise<UserResult>;
  /** When the oldest sale settled or opened after `since` happened (any, when null). */
  oldestSaleSince: (since: number | null) => number | null;
  /** Sales settled or voided since the last close — what the next close would cover. */
  unclosedSales: () => number;
  /** When the oldest of those happened, or null when there are none. */
  oldestUnclosed: () => number | null;
  /** Close everything since the last close. Null when there is nothing to close. */
  closeDay: (countedCashCents?: Centavos) => Promise<DailyClose | null>;
  clearPersistError: () => void;
}

// ── helpers (pure, outside the store) ────────────────────────────────

function log(
  audit: AuditEntry[],
  kind: string,
  message: string,
  tone: AuditEntry['tone'],
  branchId: string | null,
): AuditEntry[] {
  const entry: AuditEntry = {
    id: uuidv7(),
    at: Date.now(),
    branchId,
    kind,
    message,
    tone,
    actorUserId: actorId(),
  };
  // Append-only, newest first, retained to 2000. v6 truncated at 150 with an
  // O(n) unshift — this is audit-trail data and goes into the monthly archive.
  return [entry, ...audit].slice(0, 2000);
}

function activeLines(order: Order): OrderLine[] {
  return order.lines.filter((l) => !l.voided);
}

export function orderGross(order: Order): Centavos {
  return activeLines(order).reduce<Centavos>(
    (sum, line) => addC(sum, lineTotal(line.unitCents, line.qty)),
    cents(0),
  );
}

/**
 * What the till actually keeps: everything handed over, less every peso of
 * change given back. This is the figure that has to match the bill — the sum
 * of `amountCents` does not, because a cash tender records the full amount
 * received and hands part of it straight back.
 */
export function keptByTill(order: Order): Centavos {
  return order.tenders.reduce<Centavos>(
    (sum, t) =>
      cents(sum + (t.tenderedCents ?? t.amountCents) - (t.changeCents ?? 0)),
    cents(0),
  );
}

/**
 * What goes on the bill. With a serve step only what was served is charged;
 * without one, every line on the order is.
 */
export function billedLines(order: Order, serveStep: boolean): OrderLine[] {
  return activeLines(order).filter((l) => l.served || !serveStep);
}

/** The bill for an open order, from the current settings. */
function billOf(order: Order, settings: Settings): BillBreakdown {
  const gross = billedLines(order, settings.features.serveStep).reduce<Centavos>(
    (sum, l) => addC(sum, lineTotal(l.unitCents, l.qty)),
    cents(0),
  );
  return computeBill(gross, settings, discountRequest(order.discount));
}

/**
 * An open order stays on the record once stock moved for it, a payment was
 * taken, or it carries a number (opened before numbers waited for payment).
 * Staff can't discard it; only the owner's cancel ends it, and that cancel
 * numbers it. Served service lines move nothing, so they don't count.
 */
export function staysOnRecord(order: Order): boolean {
  return (
    order.invoiceNo !== null ||
    order.tenders.length > 0 ||
    order.lines.some((l) => l.served && l.kind === 'stock')
  );
}

/** Stock lines on open orders in this branch that are not yet off the shelf,
 *  as productId -> quantity held. */
export function heldStock(orders: Order[], branchId: string): Map<string, Qty> {
  const held = new Map<string, Qty>();
  for (const o of orders) {
    if (o.status !== 'open' || o.branchId !== branchId) continue;
    for (const l of o.lines) {
      if (l.kind !== 'stock' || l.served || l.voided) continue;
      held.set(l.productId, ((held.get(l.productId) ?? 0) + l.qty) as Qty);
    }
  }
  return held;
}

function availableIn(
  s: Pick<PosState, 'orders' | 'stock'>,
  branchId: string,
  productId: string,
): Qty {
  const onHand = s.stock[branchId]?.[productId] ?? 0;
  const held = heldStock(s.orders, branchId).get(productId) ?? 0;
  return Math.max(0, onHand - held) as Qty;
}

/** The first line the shelf can't cover, as the refusal; null when all fit.
 *  Takes the little an order line and a quote line have in common, so a
 *  quotation is held to the same stock rule as the sale it becomes. */
function shortLine(
  lines: { productId: string; name: string; kind: ProductKind; qty: Qty }[],
  onHand: Record<string, Qty>,
): string | null {
  const need = new Map<string, number>();
  for (const l of lines) {
    if (l.kind !== 'stock') continue;
    const total = (need.get(l.productId) ?? 0) + l.qty;
    need.set(l.productId, total);
    const have = onHand[l.productId] ?? 0;
    if (total > have) return `${l.name}: only ${formatQty(Math.max(0, have) as Qty)} left.`;
  }
  return null;
}

/** The delivery fields of a move that is not a restock. */
const NO_DELIVERY = { supplier: null, docNo: null, unitCostCents: null } as const;

function reorderLevel(product: Product, settings: Settings): Qty {
  return product.reorderLevel ?? settings.lowStockAt;
}

/**
 * The alerts after a stock change: each product the change took from above its
 * reorder level to at or below it is added, once. Only a dismiss removes one.
 */
function alertCrossings(
  s: Pick<PosState, 'products' | 'settings' | 'lowStockAlerts'>,
  before: Record<string, Qty>,
  after: Record<string, Qty>,
): string[] {
  let alerts = s.lowStockAlerts;
  for (const [productId, now] of Object.entries(after)) {
    const was = before[productId] ?? 0;
    if (now >= was || alerts.includes(productId)) continue;
    const product = s.products.find((p) => p.id === productId);
    if (!product) continue;
    const level = reorderLevel(product, s.settings);
    if (was > level && now <= level) alerts = [...alerts, productId];
  }
  return alerts;
}

/** Take these lines off the shelf: the new on-hand, and a sale move per stock line. */
function deduct(
  onHand: Record<string, Qty>,
  lines: OrderLine[],
  order: Order,
  at: number,
  actor: string | null,
): { onHand: Record<string, Qty>; moves: StockMove[] } {
  const next = { ...onHand };
  const moves: StockMove[] = [];
  for (const line of lines) {
    if (line.kind !== 'stock') continue;
    next[line.productId] = ((next[line.productId] ?? 0) - line.qty) as Qty;
    moves.push({
      id: uuidv7(),
      branchId: order.branchId,
      productId: line.productId,
      delta: -line.qty as Qty,
      reason: 'sale',
      refOrderId: order.id,
      note: null,
      at,
      actorUserId: actor,
      ...NO_DELIVERY,
    });
  }
  return { onHand: next, moves };
}

/** How an order is named in the log: its number, or its label before it has one. */
function orderName(order: Order): string {
  return order.invoiceNo ?? order.label;
}

function nextInvoiceNo(
  seq: Record<string, number>,
  branch: Branch | undefined,
  branchId: string,
): { invoiceNo: string; seq: Record<string, number> } {
  const next = (seq[branchId] ?? 0) + 1;
  const code = branch?.branchCode || branchId;
  return {
    invoiceNo: `${code}-${String(next).padStart(7, '0')}`,
    seq: { ...seq, [branchId]: next },
  };
}

/** The order's number, issuing the branch's next one if it has none yet.
 *  Orders opened by earlier builds were numbered at open and keep that number. */
function numberFor(
  state: Pick<PosState, 'invoiceSeq' | 'branches'>,
  order: Order,
): { invoiceNo: string; seq: Record<string, number> } {
  if (order.invoiceNo !== null) return { invoiceNo: order.invoiceNo, seq: state.invoiceSeq };
  return nextInvoiceNo(
    state.invoiceSeq,
    state.branches.find((b) => b.id === order.branchId),
    order.branchId,
  );
}

function blankOrder(
  id: string,
  branchId: string,
  label: string,
  type: OrderType,
  extra: OrderExtra = {},
): Order {
  return {
    id,
    invoiceNo: null,
    branchId,
    label,
    type,
    status: 'open',
    customerName: extra.customerName?.trim() || null,
    customerPhone: extra.customerPhone?.trim() || null,
    vehiclePlate: extra.vehiclePlate?.trim() || null,
    fromQuoteId: null,
    openedAt: Date.now(),
    closedAt: null,
    lines: [],
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
    openedBy: actorId(),
    servedBy: null,
    paidBy: null,
    voidedBy: null,
  };
}

/** A quotation, numbered and totalled. The caller supplies what the customer
 *  was shown; the shop's own settings decide how long it holds. */
function newQuote(
  state: Pick<PosState, 'quoteSeq' | 'settings'>,
  from: {
    lines: QuoteLine[];
    discount: SaleDiscount;
    customerName: string | null;
    customerPhone: string | null;
  },
): Quote {
  const gross = from.lines.reduce<Centavos>((sum, l) => addC(sum, lineTotal(l.unitCents, l.qty)), cents(0));
  const bill = computeBill(gross, state.settings, discountRequest(from.discount));
  return {
    id: uuidv7(),
    quoteNo: nextQuoteNo(state.quoteSeq),
    status: 'open',
    lines: from.lines,
    discount: from.discount,
    grossCents: bill.gross,
    discountCents: bill.discount,
    netCents: bill.amountDue,
    customerName: from.customerName,
    customerPhone: from.customerPhone,
    validUntil: addDays(businessDate(Date.now()), state.settings.quoteValidDays),
    createdAt: Date.now(),
    createdBy: actorId(),
    convertedSaleId: null,
    cancelledReason: null,
  };
}

/** True if any user — active or not — already answers to this PIN. A
 *  deactivated user keeps their PIN reserved; the audit trail still names them. */
async function pinTaken(users: User[], pin: string, exceptId?: string): Promise<User | null> {
  for (const user of users) {
    if (user.id === exceptId) continue;
    if (await verifyPin(pin, user.pin)) return user;
  }
  return null;
}

const SNAPSHOT_VERSION = 8;

/**
 * Why a restore was refused, or null if the file is usable. Restoring replaces
 * every order on the device, so a half-readable file has to be rejected before
 * it lands rather than diagnosed afterwards.
 */
function describeBadSnapshot(snapshot: DataSnapshot): string | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return `That file is not a ${PRODUCT_NAME} backup.`;
  }
  if (snapshot.version !== 7 && snapshot.version !== SNAPSHOT_VERSION) {
    return (
      `That backup is version ${snapshot.version ?? 'unknown'}; this app reads ` +
      `versions 7 and ${SNAPSHOT_VERSION}.`
    );
  }
  if (!Array.isArray(snapshot.products) || snapshot.products.length === 0) {
    return 'That backup has no menu items in it. It may be truncated.';
  }
  for (const [key, value] of Object.entries({
    branches: snapshot.branches,
    users: snapshot.users,
    orders: snapshot.orders,
    stockMoves: snapshot.stockMoves,
    audit: snapshot.audit,
  })) {
    if (value !== undefined && !Array.isArray(value)) {
      return `That backup is damaged — "${key}" is not a list.`;
    }
  }
  if (snapshot.stock !== undefined && typeof snapshot.stock !== 'object') {
    return 'That backup is damaged — the stock record is unreadable.';
  }
  return null;
}

/** When each sale the next close would cover happened: settled, or (for a
 *  sale from an earlier close) voided. */
function unclosedTimes({ orders, closes }: Pick<PosState, 'orders' | 'closes'>): number[] {
  const since = closes.at(-1)?.closedAt ?? 0;
  const now = Date.now() + 1;
  const times: number[] = [];
  for (const o of orders) {
    if (o.status === 'closed' && inWindow(o.closedAt, since, now)) times.push(o.closedAt as number);
    else if (o.status === 'voided' && inWindow(o.voidedAt, since, now) && (o.closedAt ?? Infinity) < since) {
      times.push(o.voidedAt as number);
    }
  }
  return times;
}

/** Services are never stocked. */
function initialStock(products: Product[]): Record<string, Qty> {
  return Object.fromEntries(
    products.filter((p) => p.kind === 'stock').map((p) => [p.id, OPENING_STOCK]),
  );
}

/**
 * Reading saved data failed. The till keeps working in memory, but nothing is
 * written for the rest of the session: what is in memory is not what is on
 * disk, and saving it would write over the stored books (or, mid-upgrade,
 * mark v8 rows as still needing the v7 migration). The error stays on screen.
 */
let loadFailed = false;

function failLoad(persistError: string): void {
  loadFailed = true;
  usePos.setState({ hydrated: true, persistError });
}

export const usePos = create<PosState>()(
  persist(
    (set, get) => ({
      branches: [DEFAULT_BRANCH],
      // Empty until the first-run wizard names the owner — AuthGate shows the
      // wizard while this list is empty. No account ships with the app.
      users: [],
      products: [],
      promos: [],
      quotes: [],
      quoteSeq: 1,
      orders: [],
      stock: { [DEFAULT_BRANCH.id]: {} },
      stockMoves: [],
      closes: [],
      backupKey: null,
      lastCloudBackupAt: null,
      audit: [],
      settings: DEFAULT_SETTINGS,
      invoiceSeq: {},
      recovery: null,
      installId: null,
      license: null,
      licensed: null,
      activeBranchId: DEFAULT_BRANCH.id,
      activeOrderId: null,
      lastBackupAt: null,
      hydrated: false,
      persistError: null,
      rowsNeedV8: false,
      lowStockAlerts: [],

      // ── selectors ─────────────────────────────────────────────────
      branch: (id) => {
        const target = id ?? get().activeBranchId;
        return get().branches.find((b) => b.id === target);
      },
      user: (id) => (id ? get().users.find((u) => u.id === id) : undefined),
      order: (id) => (id ? get().orders.find((o) => o.id === id) : undefined),
      product: (id) => get().products.find((p) => p.id === id),
      stockOf: (productId, branchId) => {
        const bid = branchId ?? get().activeBranchId;
        return get().stock[bid]?.[productId] ?? (0 as Qty);
      },
      available: (productId) => availableIn(get(), get().activeBranchId, productId),
      openOrders: () =>
        get()
          .orders.filter(
            (o) => o.status === 'open' && o.branchId === get().activeBranchId,
          )
          .sort((a, b) => a.openedAt - b.openedAt),

      // ── order lifecycle ───────────────────────────────────────────
      openOrder: (label, type, extra) => {
        const id = uuidv7();
        set((state) => {
          // No number yet. Numbers are gapless, so one is given only to a sale
          // that is paid, or cancelled after its stock moved.
          const order = blankOrder(id, state.activeBranchId, label, type, extra);
          return {
            orders: [...state.orders, order],
            activeOrderId: id,
            audit: log(state.audit, 'order.open', `Opened ${label}`, 'info', state.activeBranchId),
          };
        });
        return id;
      },

      setActiveOrder: (id) => set({ activeOrderId: id }),

      addLine: (orderId, productId, qty = QTY_ONE) => {
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }
        if (!Number.isSafeInteger(qty) || qty <= 0) {
          return { ok: false, error: 'Enter a quantity greater than zero.' };
        }
        const product = state.products.find((p) => p.id === productId);
        if (!product?.active) return { ok: false, error: 'That item is no longer sold.' };
        if (product.kind === 'stock') {
          const left = availableIn(state, order.branchId, productId);
          if (qty > left) return { ok: false, error: `Only ${formatQty(left)} left.` };
        }

        set((s) => {
          const orders = s.orders.map((o) => {
            if (o.id !== orderId) return o;

            // Merge into an unserved line for the same product at the same
            // price. A line keeps the price it was added at.
            const existing = o.lines.find(
              (l) =>
                l.productId === productId &&
                !l.served &&
                !l.voided &&
                l.unitCents === product.priceCents,
            );
            if (existing) {
              return {
                ...o,
                lines: o.lines.map((l) =>
                  l.lineNo === existing.lineNo ? { ...l, qty: (l.qty + qty) as Qty } : l,
                ),
              };
            }
            const lineNo = o.lines.reduce((max, l) => Math.max(max, l.lineNo), 0) + 1;
            const line: OrderLine = {
              lineNo,
              productId,
              name: product.name,
              unitCents: product.priceCents,
              costCents: product.costCents,
              kind: product.kind,
              unit: product.unit,
              qty,
              served: false,
              servedAt: null,
              voided: false,
              voidReason: null,
            };
            return { ...o, lines: [...o.lines, line] };
          });
          return { ...s, orders };
        });
        return { ok: true };
      },

      changeQty: (orderId, lineNo, delta) => {
        // Thousandths, like every quantity; a fraction or NaN would corrupt the line.
        if (!Number.isSafeInteger(delta) || delta === 0) {
          return { ok: false, error: 'Enter a quantity.' };
        }
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }
        const line = order.lines.find((l) => l.lineNo === lineNo);
        if (!line || line.served || line.voided) {
          return { ok: false, error: 'That line can no longer be changed.' };
        }
        if (delta > 0 && line.kind === 'stock') {
          const left = availableIn(state, order.branchId, line.productId);
          if (delta > left) return { ok: false, error: `Only ${formatQty(left)} left.` };
        }
        set((s) => ({
          ...s,
          orders: s.orders.map((o) => {
            if (o.id !== orderId) return o;
            return {
              ...o,
              lines: o.lines
                .map((l) =>
                  l.lineNo === lineNo ? { ...l, qty: Math.max(0, l.qty + delta) as Qty } : l,
                )
                .filter((l) => l.qty > 0 || l.served || l.voided),
            };
          }),
        }));
        return { ok: true };
      },

      voidLine: (orderId, lineNo, reason) => {
        const refused = guard('sale.cancel');
        if (refused) return refused;
        set((state) => {
          const order = state.orders.find((o) => o.id === orderId);
          const line = order?.lines.find((l) => l.lineNo === lineNo);
          if (!order || !line) return state;
          // A closed order's totals are frozen for the receipt. Moving a line
          // underneath them would put the printed bill and the record out of
          // step; corrections to a settled sale go through voidOrder.
          if (order.status !== 'open') return state;

          // Voiding a served stock line returns its stock.
          const moves: StockMove[] = [];
          let stock = state.stock;
          if (line.served && line.kind === 'stock') {
            const branchStock = { ...(stock[order.branchId] ?? {}) };
            branchStock[line.productId] =
              ((branchStock[line.productId] ?? 0) + line.qty) as Qty;
            stock = { ...stock, [order.branchId]: branchStock };
            moves.push({
              id: uuidv7(),
              branchId: order.branchId,
              productId: line.productId,
              delta: line.qty,
              reason: 'void',
              refOrderId: order.id,
              note: reason,
              at: Date.now(),
              actorUserId: actorId(),
              ...NO_DELIVERY,
            });
          }

          return {
            ...state,
            stock,
            stockMoves: [...moves, ...state.stockMoves],
            orders: state.orders.map((o) =>
              o.id !== orderId
                ? o
                : {
                    ...o,
                    lines: o.lines.map((l) =>
                      l.lineNo === lineNo
                        ? { ...l, voided: true, voidReason: reason }
                        : l,
                    ),
                  },
            ),
            audit: log(
              state.audit,
              'line.void',
              `Voided ${formatQty(line.qty)}x ${line.name} on ${orderName(order)} — ${reason}`,
              'warn',
              order.branchId,
            ),
          };
        });
        return { ok: true };
      },

      serveLine: (orderId, lineNo) => {
        const order = get().order(orderId);
        const line = order?.lines.find((l) => l.lineNo === lineNo);
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }
        if (!line || line.served || line.voided) return { ok: true };
        return serveLines(set, get, order, [line]);
      },

      serveAll: (orderId) => {
        const order = get().order(orderId);
        // Serving after the bill is settled would deduct stock for food that
        // was never charged for.
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }
        const pending = order.lines.filter((l) => !l.served && !l.voided);
        if (pending.length === 0) return { ok: true };
        return serveLines(set, get, order, pending);
      },

      discardOpenOrder: (orderId) => {
        const refused = guard('sell');
        if (refused) return refused;
        const order = get().order(orderId);
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }
        if (staysOnRecord(order)) {
          return { ok: false, error: 'Ask the owner to cancel this sale.' };
        }
        set((s) => ({
          ...s,
          activeOrderId: s.activeOrderId === orderId ? null : s.activeOrderId,
          orders: s.orders.filter((o) => o.id !== orderId),
          quotes: reopenQuote(s.quotes, order),
          audit: log(s.audit, 'order.discard', `Discarded ${order.label}`, 'info', order.branchId),
        }));
        return { ok: true };
      },

      clearDiscount: (orderId) => {
        // Taking a discount off changes the money as much as giving one: an
        // owner discount comes off only by the owner.
        const current = get().order(orderId)?.discount.kind;
        if (current === 'none') return { ok: true };
        const refused = guard(current === 'promo' ? 'promo.apply' : 'discount.owner');
        if (refused) return refused;
        return setOpenDiscount(set, get, orderId, { kind: 'none' });
      },

      applyPromo: (orderId, input) => {
        // A code replaces an owner discount, and only the owner may take one off.
        const replacesOwner = get().order(orderId)?.discount.kind === 'owner';
        const refused = guard('promo.apply') ?? (replacesOwner ? guard('discount.owner') : null);
        if (refused) return refused;
        const promo = findUsablePromo(get().promos, input, businessDate(Date.now()));
        if (!promo) return { ok: false, error: 'That code is not valid today.' };
        return setOpenDiscount(set, get, orderId, {
          kind: 'promo',
          promoId: promo.id,
          code: promo.code,
          percent: promo.percent,
        });
      },

      applyOwnerDiscount: (orderId, d) => {
        const refused = guard('discount.owner');
        if (refused) return refused;
        const discount: SaleDiscount = {
          kind: 'owner',
          percent: 'percent' in d ? d.percent : null,
          fixedCents: 'percent' in d ? null : d.fixedCents,
          by: actorId(),
        };
        if (discount.percent !== null && (!Number.isFinite(discount.percent) || discount.percent <= 0 || discount.percent > 100)) {
          return { ok: false, error: 'Enter a percent from 1 to 100.' };
        }
        if (discount.fixedCents !== null) {
          if (!Number.isSafeInteger(discount.fixedCents) || discount.fixedCents <= 0) {
            return { ok: false, error: 'Enter an amount more than 0.' };
          }
          const order = get().order(orderId);
          if (order && discount.fixedCents > orderGross(order)) {
            return { ok: false, error: 'That is more than the sale.' };
          }
        }
        return setOpenDiscount(set, get, orderId, discount);
      },

      saveOrderAsQuote: (orderId) => {
        const refused = guard('quote.make') ?? quotesOff(get());
        if (refused) return refused;
        const state = get();
        const order = state.order(orderId);
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }
        if (order.lines.length === 0) {
          return { ok: false, error: 'Add something to the cart first.' };
        }
        // Once stock has gone out or money has been taken, it is a sale, not a
        // cart. The owner cancels those; they are not quoted.
        if (staysOnRecord(order)) {
          return { ok: false, error: 'Ask the owner to cancel this sale.' };
        }
        const quote = newQuote(state, {
          lines: order.lines
            .filter((l) => !l.voided)
            .map((l) => ({
              lineNo: l.lineNo,
              productId: l.productId,
              name: l.name,
              kind: l.kind,
              unitCents: l.unitCents,
              unit: l.unit,
              qty: l.qty,
            })),
          discount: order.discount,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
        });
        set((s) => ({
          ...s,
          quotes: [...s.quotes, quote],
          quoteSeq: s.quoteSeq + 1,
          // The cart has become a piece of paper. Throwing it away releases
          // whatever stock it was holding.
          activeOrderId: s.activeOrderId === orderId ? null : s.activeOrderId,
          orders: s.orders.filter((o) => o.id !== orderId),
          audit: log(s.audit, 'quote.create', `Quoted ${quote.quoteNo}`, 'info', order.branchId),
        }));
        return { ok: true, quoteId: quote.id };
      },

      convertQuote: (quoteId, now = Date.now(), options = {}) => {
        const refused = guard('quote.make') ?? quotesOff(get());
        if (refused) return refused;
        const state = get();
        const quote = state.quotes.find((q) => q.id === quoteId);
        if (!quote) return { ok: false, error: 'That quotation is gone.' };
        if (quote.status !== 'open') {
          return { ok: false, error: `That quotation is already ${quote.status}.` };
        }

        // A quote is a promise, but only until it says so. Turning it into a
        // sale is a fresh promise, so an expired one is confirmed, not allowed
        // through quietly.
        const today = businessDate(now);
        if (quoteStatus(quote, today) === 'expired' && options.confirmExpired !== true) {
          return {
            ok: false,
            error: `${quote.quoteNo} expired on ${quote.validUntil}. Convert it anyway?`,
          };
        }

        const branchId = state.activeBranchId;
        const gone: string[] = [];
        for (const l of quote.lines) {
          const product = state.products.find((p) => p.id === l.productId);
          if (!product?.active) gone.push(l.name);
        }
        if (gone.length > 0) {
          return {
            ok: false,
            error: `No longer sold: ${[...new Set(gone)].join(', ')}.`,
          };
        }

        const available: Record<string, Qty> = {};
        for (const l of quote.lines) {
          if (l.kind === 'stock') {
            available[l.productId] = availableIn(state, branchId, l.productId);
          }
        }
        const short = shortLine(quote.lines, available);
        if (short) {
          return { ok: false, error: `Not enough stock to convert. ${short}` };
        }

        // The point of a quotation: the lines are the ones the customer was
        // shown, at the prices they were shown.
        const order = blankOrder(
          uuidv7(),
          branchId,
          ticketWord(state.settings.shopType),
          'walk-in',
          { customerName: quote.customerName ?? undefined, customerPhone: quote.customerPhone ?? undefined },
        );
        order.fromQuoteId = quote.id;
        order.lines = quote.lines.map((l) => ({
          lineNo: l.lineNo,
          productId: l.productId,
          name: l.name,
          unitCents: l.unitCents,
          // Cost is today's, not the quoted one: profit is judged when the
          // goods actually go out.
          costCents: state.products.find((p) => p.id === l.productId)?.costCents,
          kind: l.kind,
          unit: l.unit,
          qty: l.qty,
          served: false,
          servedAt: null,
          voided: false,
          voidReason: null,
        }));
        order.discount = quote.discount;

        set((s) => ({
          ...s,
          orders: [...s.orders, order],
          // The sale being worked on now: a retail cart shows it, ahead of
          // any cart that was already open.
          activeOrderId: order.id,
          quotes: s.quotes.map((q) =>
            q.id === quote.id ? { ...q, status: 'converted', convertedSaleId: order.id } : q,
          ),
          audit: log(s.audit, 'quote.convert', `Converted ${quote.quoteNo}`, 'info', branchId),
        }));
        return { ok: true, orderId: order.id };
      },

      requote: (quoteId) => {
        const refused = guard('quote.make') ?? quotesOff(get());
        if (refused) return refused;
        const source = get().quotes.find((q) => q.id === quoteId);
        if (!source) return { ok: false, error: 'That quotation is gone.' };
        // Any quote can be re-quoted, whatever became of it: it is a new
        // quote for the same items. Same items, today's prices. An item that has since left the catalogue
        // keeps the quoted line: a re-quote is not a stock check.
        const lines: QuoteLine[] = source.lines.map((l) => {
          const product = get().products.find((p) => p.id === l.productId);
          if (!product) return { ...l };
          return { ...l, name: product.name, unit: product.unit, unitCents: product.priceCents };
        });
        // A new quote is made today, so a promo code on it must be valid today,
        // and carries the code as it stands today.
        let discount: SaleDiscount = source.discount;
        if (source.discount.kind === 'promo') {
          const promo = findUsablePromo(get().promos, source.discount.code, businessDate(Date.now()));
          discount = promo
            ? { kind: 'promo', promoId: promo.id, code: promo.code, percent: promo.percent }
            : { kind: 'none' };
        }
        const quote = newQuote(get(), {
          lines,
          discount,
          customerName: source.customerName,
          customerPhone: source.customerPhone,
        });
        set((s) => ({
          ...s,
          quotes: [...s.quotes, quote],
          quoteSeq: s.quoteSeq + 1,
          audit: log(
            s.audit,
            'quote.requote',
            `Re-quoted ${source.quoteNo} as ${quote.quoteNo}`,
            'info',
            s.activeBranchId,
          ),
        }));
        return { ok: true, quoteId: quote.id };
      },

      cancelQuote: (quoteId, reason) => {
        const refused = guard('quote.cancel');
        if (refused) return refused;
        const quote = get().quotes.find((q) => q.id === quoteId);
        if (!quote) return { ok: false, error: 'That quotation is gone.' };
        if (quote.status !== 'open') {
          return { ok: false, error: `That quotation is already ${quote.status}.` };
        }
        set((s) => ({
          ...s,
          quotes: s.quotes.map((q) =>
            q.id === quote.id
              ? { ...q, status: 'cancelled', cancelledReason: reason.trim() || 'No reason given' }
              : q,
          ),
          audit: log(
            s.audit,
            'quote.cancel',
            `Cancelled ${quote.quoteNo}: ${reason.trim() || 'No reason given'}`,
            'warn',
            s.activeBranchId,
          ),
        }));
        return { ok: true };
      },

      createPromo: (input) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        const invalid = badPromoInput(get().promos, input);
        if (invalid) return { ok: false, error: invalid };
        const promo: Promo = {
          id: uuidv7(),
          code: normalizeCode(input.code),
          percent: input.percent,
          note: input.note ?? '',
          active: true,
          startsOn: input.startsOn ?? null,
          endsOn: input.endsOn ?? null,
          createdAt: Date.now(),
          firstUsedAt: null,
        };
        set((s) => ({
          ...s,
          promos: [...s.promos, promo],
          audit: log(
            s.audit,
            'promo.create',
            `Created promo ${promo.code} (${promo.percent}%)`,
            'info',
            null,
          ),
        }));
        return { ok: true };
      },

      updatePromo: (id, input) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        const current = get().promos.find((p) => p.id === id);
        if (!current) return { ok: false, error: 'That code no longer exists.' };
        if (current.firstUsedAt !== null) {
          return { ok: false, error: 'This code has been used. Turn it off and make a new one.' };
        }
        // An open sale carries the code and percent it was given; changing them
        // underneath it would lock the code on values no sale used.
        const holds = (d: SaleDiscount) => d.kind === 'promo' && d.promoId === id;
        if (get().orders.some((o) => o.status === 'open' && holds(o.discount))) {
          return { ok: false, error: 'An open sale is using this code. Finish or clear that sale first.' };
        }
        // An open quote converts at the code and percent written on it.
        if (get().quotes.some((q) => q.status === 'open' && holds(q.discount))) {
          return { ok: false, error: 'An open quotation is using this code. Turn it off and make a new one.' };
        }
        const invalid = badPromoInput(
          get().promos.filter((p) => p.id !== id),
          input,
        );
        if (invalid) return { ok: false, error: invalid };
        const code = normalizeCode(input.code);
        set((s) => ({
          ...s,
          promos: s.promos.map((p) =>
            p.id === id
              ? {
                  ...p,
                  code,
                  percent: input.percent,
                  note: input.note ?? '',
                  startsOn: input.startsOn ?? null,
                  endsOn: input.endsOn ?? null,
                }
              : p,
          ),
          audit: log(
            s.audit,
            'promo.update',
            `Changed promo ${code} to ${input.percent}%`,
            'info',
            null,
          ),
        }));
        return { ok: true };
      },

      setPromoActive: (id, active) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        const current = get().promos.find((p) => p.id === id);
        if (!current) return { ok: false, error: 'That code no longer exists.' };
        set((s) => ({
          ...s,
          promos: s.promos.map((p) => (p.id === id ? { ...p, active } : p)),
          audit: log(
            s.audit,
            'promo.toggle',
            `${active ? 'Turned on' : 'Turned off'} promo ${current.code}`,
            active ? 'success' : 'warn',
            null,
          ),
        }));
        return { ok: true };
      },

      promoUses: (id) =>
        get().orders.filter(
          (o) => o.status === 'closed' && o.discount.kind === 'promo' && o.discount.promoId === id,
        ).length,

      addTender: (orderId, tender) => {
        if (guard('order.pay')) return;
        set((state) => ({
          ...state,
          orders: state.orders.map((o) =>
            o.id === orderId && o.status === 'open'
              ? {
                  ...o,
                  tenders: [
                    ...o.tenders,
                    { ...tender, id: uuidv7(), takenAt: Date.now() },
                  ],
                }
              : o,
          ),
        }));
      },

      removeTender: (orderId, tenderId) => {
        if (guard('order.pay')) return;
        set((state) => ({
          ...state,
          orders: state.orders.map((o) =>
            o.id === orderId && o.status === 'open'
              ? { ...o, tenders: o.tenders.filter((t) => t.id !== tenderId) }
              : o,
          ),
        }));
      },

      closeOrder: (orderId) => {
        const refused = guard('order.pay');
        if (refused) return refused;
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }

        const { serveStep } = state.settings.features;
        const billed = billedLines(order, serveStep);
        if (billed.length === 0) {
          const error = serveStep
            ? 'Serve something before taking payment.'
            : 'Add an item before taking payment.';
          return { ok: false, error };
        }

        const bill = billOf(order, state.settings);

        // Money kept has to equal the bill exactly. Checking the tender total
        // alone was not enough: applying a discount or voiding a line *after*
        // payment was recorded leaves a stale tender behind. Cash change was
        // worked out against the old, higher total, and an e-wallet transfer
        // cannot give change at all — settling either way books money the
        // wallet statement will never show. Re-record the tender instead.
        if (keptByTill(order) !== bill.amountDue) {
          return { ok: false, error: 'Payment does not match the amount due.' };
        }

        // Without a serve step the whole order leaves the shelf now. With one,
        // it left as it was served. The shelf is checked again here: a count
        // since the line was added may have left too little.
        const leaving = billed.filter((l) => !l.served);
        const onHand = state.stock[order.branchId] ?? {};
        const short = shortLine(leaving, onHand);
        if (short) return { ok: false, error: short };

        const now = Date.now();
        const actor = actorId();
        const taken = deduct(onHand, leaving, order, now, actor);
        const paying = new Set(leaving.map((l) => l.lineNo));
        const { invoiceNo, seq } = numberFor(state, order);
        // The first closed sale on a code freezes it: the owner can turn it off
        // and make another, but never rewrite the percent these sales carry.
        const promoId = order.discount.kind === 'promo' ? order.discount.promoId : null;
        const firstUse = Date.now();

        set((s) => ({
          ...s,
          activeOrderId: s.activeOrderId === orderId ? null : s.activeOrderId,
          stock: { ...s.stock, [order.branchId]: taken.onHand },
          lowStockAlerts: alertCrossings(s, onHand, taken.onHand),
          stockMoves: [...taken.moves, ...s.stockMoves],
          invoiceSeq: seq,
          promos: s.promos.map((p) =>
            p.id === promoId && p.firstUsedAt === null ? { ...p, firstUsedAt: firstUse } : p,
          ),
          orders: s.orders.map((o) =>
            o.id !== orderId
              ? o
              : {
                  ...o,
                  invoiceNo,
                  status: 'closed' as const,
                  closedAt: now,
                  paidBy: actor,
                  servedBy: paying.size > 0 ? (o.servedBy ?? actor) : o.servedBy,
                  // Marked served so the slip and a later cancel treat them
                  // like any line that left the shelf.
                  lines: o.lines.map((l) =>
                    paying.has(l.lineNo) ? { ...l, served: true, servedAt: now } : l,
                  ),
                  // Frozen. Later settings changes never rewrite this receipt.
                  grossCents: bill.gross,
                  vatableCents: bill.vatableSale,
                  vatExemptCents: cents(0),
                  vatCents: bill.vat,
                  discountCents: bill.discount,
                  netCents: bill.amountDue,
                },
          ),
          audit: log(
            s.audit,
            'order.close',
            `Closed ${invoiceNo} — ${(bill.amountDue / 100).toFixed(2)}`,
            'success',
            order.branchId,
          ),
        }));
        return { ok: true };
      },

      payExact: (orderId, method, refNo) => {
        const refused = guard('order.pay');
        if (refused) return refused;
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || order.status !== 'open') {
          return { ok: false, error: 'That sale is no longer open.' };
        }
        const ref = refNo?.trim() ?? '';
        if (REFERENCED_METHODS.includes(method) && !ref) {
          return { ok: false, error: `${TENDER_LABELS[method]} needs a reference number.` };
        }
        const due = cents(billOf(order, state.settings).amountDue - keptByTill(order));
        if (due < 0) return { ok: false, error: 'Payment does not match the amount due.' };

        const tender: Tender = {
          id: uuidv7(),
          method,
          amountCents: due,
          tenderedCents: method === 'cash' ? due : null,
          changeCents: method === 'cash' ? cents(0) : null,
          refNo: method === 'cash' ? null : ref,
          takenAt: Date.now(),
        };
        const setTenders = (fn: (tenders: Tender[]) => Tender[]) =>
          set((s) => ({
            ...s,
            orders: s.orders.map((o) => (o.id === orderId ? { ...o, tenders: fn(o.tenders) } : o)),
          }));

        // A ₱0.00 sale (a 100% promo) closes with no payment at all.
        if (due > 0) setTenders((tenders) => [...tenders, tender]);
        const closed = get().closeOrder(orderId);
        // Saving waits for a microtask, so a payment taken back here is never written.
        if (!closed.ok && due > 0) setTenders((tenders) => tenders.filter((t) => t.id !== tender.id));
        return closed;
      },

      /**
       * Void, never delete. v6's removeTable() spliced the order out of the
       * array — a deleted completed sale is indistinguishable from one that
       * never happened, which is exactly the pattern a BIR audit looks for.
       */
      voidOrder: (orderId, reason) => {
        const refused = guard('sale.cancel');
        if (refused) return refused;
        set((state) => {
          const order = state.orders.find((o) => o.id === orderId);
          if (!order || order.status === 'voided') return state;

          // Return stock for every served stock line.
          const branchStock = { ...(state.stock[order.branchId] ?? {}) };
          const moves: StockMove[] = [];
          for (const line of order.lines) {
            if (!line.served || line.voided || line.kind !== 'stock') continue;
            branchStock[line.productId] =
              ((branchStock[line.productId] ?? 0) + line.qty) as Qty;
            moves.push({
              id: uuidv7(),
              branchId: order.branchId,
              productId: line.productId,
              delta: line.qty,
              reason: 'void',
              refOrderId: order.id,
              note: reason,
              at: Date.now(),
              actorUserId: actorId(),
              ...NO_DELIVERY,
            });
          }

          // An open order that stays on the record is numbered like any sale.
          // One that left no trace stays unnumbered.
          const numbered =
            order.invoiceNo === null && staysOnRecord(order)
              ? numberFor(state, order)
              : { invoiceNo: order.invoiceNo, seq: state.invoiceSeq };

          return {
            ...state,
            activeOrderId:
              state.activeOrderId === orderId ? null : state.activeOrderId,
            stock: { ...state.stock, [order.branchId]: branchStock },
            stockMoves: [...moves, ...state.stockMoves],
            invoiceSeq: numbered.seq,
            // Cancelled before it was paid, the quote never became a sale.
            quotes: order.status === 'open' ? reopenQuote(state.quotes, order) : state.quotes,
            orders: state.orders.map((o) =>
              o.id !== orderId
                ? o
                : {
                    ...o,
                    invoiceNo: numbered.invoiceNo,
                    status: 'voided' as const,
                    voidedReason: reason,
                    voidedAt: Date.now(),
                    voidedBy: actorId(),
                  },
            ),
            audit: log(
              state.audit,
              'order.void',
              `Voided ${numbered.invoiceNo ?? order.label} — ${reason}`,
              'danger',
              order.branchId,
            ),
          };
        });
        return { ok: true };
      },

      // ── inventory ─────────────────────────────────────────────────
      receiveStock: ({ lines, supplier, docNo }) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        if (lines.length === 0) return { ok: false, error: 'Add at least one item.' };
        if (new Set(lines.map((l) => l.productId)).size !== lines.length) {
          return { ok: false, error: 'Each item can only be listed once.' };
        }
        for (const line of lines) {
          const product = get().product(line.productId);
          if (product?.kind !== 'stock') return { ok: false, error: 'Only stock items take deliveries.' };
          if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
            return { ok: false, error: `Enter how many ${product.name} came in.` };
          }
          if (line.unitCostCents !== undefined && line.unitCostCents < 0) {
            return { ok: false, error: 'Cost cannot be negative.' };
          }
        }
        const from = supplier?.trim() || null;
        const doc = docNo?.trim() || null;
        const at = Date.now();
        const actor = actorId();
        set((s) => {
          const bid = s.activeBranchId;
          const onHand = { ...(s.stock[bid] ?? {}) };
          const newCost = new Map<string, Centavos>();
          const moves: StockMove[] = lines.map((line) => {
            onHand[line.productId] = ((onHand[line.productId] ?? 0) + line.qty) as Qty;
            if (line.unitCostCents !== undefined) newCost.set(line.productId, line.unitCostCents);
            return {
              id: uuidv7(),
              branchId: bid,
              productId: line.productId,
              delta: line.qty,
              reason: 'restock',
              refOrderId: null,
              note: null,
              at,
              actorUserId: actor,
              supplier: from,
              docNo: doc,
              unitCostCents: line.unitCostCents ?? null,
            };
          });
          return {
            ...s,
            stock: { ...s.stock, [bid]: onHand },
            stockMoves: [...moves, ...s.stockMoves],
            // The new cost is for sales from now on; sold lines keep the cost they froze.
            products: s.products.map((p) => {
              const cost = newCost.get(p.id);
              return cost === undefined || cost === p.costCents ? p : { ...p, costCents: cost };
            }),
            audit: log(
              s.audit,
              'stock.receive',
              `Received ${lines.length} item${lines.length === 1 ? '' : 's'}` +
                (from ? ` from ${from}` : '') +
                (doc ? `, ${doc}` : ''),
              'info',
              bid,
            ),
          };
        });
        return { ok: true };
      },

      countStock: (productId, counted, note) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        const product = get().product(productId);
        if (product?.kind !== 'stock') return { ok: false, error: 'Only stock items are counted.' };
        if (!Number.isSafeInteger(counted) || counted < 0) {
          return { ok: false, error: 'Enter a count of 0 or more.' };
        }
        set((s) => {
          const bid = s.activeBranchId;
          const before = s.stock[bid] ?? {};
          const was = before[productId] ?? (0 as Qty);
          const after = { ...before, [productId]: counted };
          // Written even when the count matches: it records that the shelf was checked.
          const move: StockMove = {
            id: uuidv7(),
            branchId: bid,
            productId,
            delta: (counted - was) as Qty,
            reason: 'count',
            refOrderId: null,
            note: note?.trim() || null,
            at: Date.now(),
            actorUserId: actorId(),
            ...NO_DELIVERY,
          };
          return {
            ...s,
            stock: { ...s.stock, [bid]: after },
            stockMoves: [move, ...s.stockMoves],
            lowStockAlerts: alertCrossings(s, before, after),
            audit: log(
              s.audit,
              'stock.count',
              `Counted ${product.name}: ${formatQty(counted)} (was ${formatQty(was)})`,
              counted === was ? 'info' : 'warn',
              bid,
            ),
          };
        });
        return { ok: true };
      },

      recordDamage: (productId, q, note) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        const product = get().product(productId);
        if (product?.kind !== 'stock') return { ok: false, error: 'Only stock items can be damaged.' };
        if (!Number.isSafeInteger(q) || q <= 0) return { ok: false, error: 'Enter how many were damaged.' };
        if (!note.trim()) return { ok: false, error: 'Say what happened to it.' };
        const have = get().stockOf(productId);
        if (q > have) return { ok: false, error: `Only ${formatQty(Math.max(0, have) as Qty)} on hand.` };
        set((s) => {
          const bid = s.activeBranchId;
          const before = s.stock[bid] ?? {};
          const after = { ...before, [productId]: ((before[productId] ?? 0) - q) as Qty };
          const move: StockMove = {
            id: uuidv7(),
            branchId: bid,
            productId,
            delta: -q as Qty,
            reason: 'spoilage',
            refOrderId: null,
            note: note.trim(),
            at: Date.now(),
            actorUserId: actorId(),
            ...NO_DELIVERY,
          };
          return {
            ...s,
            stock: { ...s.stock, [bid]: after },
            stockMoves: [move, ...s.stockMoves],
            lowStockAlerts: alertCrossings(s, before, after),
            audit: log(
              s.audit,
              'stock.damage',
              `Wrote off ${formatQty(q)} ${product.name} — ${note.trim()}`,
              'warn',
              bid,
            ),
          };
        });
        return { ok: true };
      },

      quickAddProduct: ({ name, priceCents, kind, unit, openingQty }) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: 'Give the item a name.' };
        if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
          return { ok: false, error: 'Price cannot be negative.' };
        }
        const stocked = kind === 'stock';
        if (stocked && (!Number.isSafeInteger(openingQty) || openingQty < 0)) {
          return { ok: false, error: 'Enter an opening quantity of 0 or more.' };
        }
        const product: Product = {
          id: uuidv7(),
          name: trimmed,
          kind,
          sku: null,
          category: '',
          unit,
          priceCents,
          costCents: cents(0),
          vatExempt: false,
          active: true,
          reorderLevel: null,
        };
        set((s) => {
          const bid = s.activeBranchId;
          const opening: StockMove[] =
            stocked && openingQty > 0
              ? [
                  {
                    id: uuidv7(),
                    branchId: bid,
                    productId: product.id,
                    delta: openingQty,
                    reason: 'opening',
                    refOrderId: null,
                    note: 'Added from the sell screen',
                    at: Date.now(),
                    actorUserId: actorId(),
                    ...NO_DELIVERY,
                  },
                ]
              : [];
          return {
            ...s,
            products: [...s.products, product],
            stock: stocked
              ? { ...s.stock, [bid]: { ...(s.stock[bid] ?? {}), [product.id]: openingQty } }
              : s.stock,
            stockMoves: [...opening, ...s.stockMoves],
            audit: log(s.audit, 'product.create', `Added ${trimmed}`, 'info', bid),
          };
        });
        return { ok: true, id: product.id };
      },

      lowStock: () => {
        const s = get();
        const held = heldStock(s.orders, s.activeBranchId);
        const onHand = s.stock[s.activeBranchId] ?? {};
        return s.products
          .filter((p) => p.active && p.kind === 'stock')
          .map((p) => ({
            name: p.name,
            row: {
              productId: p.id,
              available: Math.max(0, (onHand[p.id] ?? 0) - (held.get(p.id) ?? 0)) as Qty,
              level: reorderLevel(p, s.settings),
            },
          }))
          .filter(({ row }) => row.available <= row.level)
          // Out of stock first, then available ÷ level, compared without dividing.
          .sort(
            (a, b) =>
              Number(a.row.available > 0) - Number(b.row.available > 0) ||
              a.row.available * b.row.level - b.row.available * a.row.level ||
              a.name.localeCompare(b.name),
          )
          .map(({ row }) => row);
      },

      dismissLowStockAlert: (productId) =>
        set((s) => ({ ...s, lowStockAlerts: s.lowStockAlerts.filter((id) => id !== productId) })),

      upsertProduct: (product) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        // A SKU names one item, or a spreadsheet import could not tell them apart.
        const { sku } = product;
        if (sku !== null && get().products.some((p) => p.id !== product.id && p.sku === sku)) {
          return { ok: false, error: `Another item already has SKU ${sku}.` };
        }
        set((state) => {
          const exists = state.products.some((p) => p.id === product.id);
          return {
            ...state,
            products: exists
              ? state.products.map((p) => (p.id === product.id ? product : p))
              : [...state.products, product],
            audit: log(
              state.audit,
              exists ? 'product.update' : 'product.create',
              `${exists ? 'Updated' : 'Added'} ${product.name}`,
              'info',
              state.activeBranchId,
            ),
          };
        });
        return { ok: true };
      },

      /** Soft delete — history references these rows. */
      removeProduct: (productId) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        set((state) => ({
          ...state,
          products: state.products.map((p) =>
            p.id === productId ? { ...p, active: false } : p,
          ),
        }));
        return { ok: true };
      },

      /**
       * A spreadsheet, written in one go.
       *
       * One `set`, one log line: a 300-row file is one act by the owner, and a
       * half-written import is worse than none at all. A matched SKU updates
       * what the file says about the item — price, cost, category, unit and
       * reorder level — and nothing else, because the name and the kind are
       * what the history and the stock ledger are filed under. An item already
       * on the shelf has been counted; the file's opening quantity is ignored,
       * or the second import of the same file would double the stock.
       */
      applyImport: (preview) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        if (preview.rows.length === 0) {
          return { ok: false, error: 'There is nothing to import in that file.' };
        }
        // The preview was read against Inventory as it was then. If an item it
        // updates is gone, or a SKU it adds has since been taken, it is stale.
        const { products: shelf } = get();
        const stale = preview.rows.some((row) =>
          row.matchId === null
            ? shelf.some((p) =>
                row.product.sku !== null
                  ? p.sku === row.product.sku
                  : p.sku === null && nameKey(p.name) === nameKey(row.product.name),
              )
            : !shelf.some((p) => p.id === row.matchId),
        );
        if (stale) {
          return { ok: false, error: 'Inventory changed since this file was read. Choose the file again.' };
        }
        set((s) => {
          const bid = s.activeBranchId;
          const now = Date.now();
          const products = [...s.products];
          const before = s.stock[bid] ?? {};
          const after: Record<string, Qty> = { ...before };
          const moves: StockMove[] = [];
          let added = 0;
          let updated = 0;

          for (const row of preview.rows) {
            const at = row.matchId === null ? -1 : products.findIndex((p) => p.id === row.matchId);
            if (at >= 0) {
              const current = products[at]!;
              products[at] = {
                ...current,
                // A file that names a removed item brings it back.
                active: true,
                // A SKU filled in for an item that had none is kept; one it
                // already has is what the row was matched by.
                sku: current.sku ?? row.product.sku,
                category: row.product.category,
                unit: row.product.unit,
                priceCents: row.product.priceCents,
                costCents: row.product.costCents,
                reorderLevel: row.product.reorderLevel,
              };
              updated += 1;
              continue;
            }
            const product: Product = { id: uuidv7(), active: true, ...row.product };
            products.push(product);
            added += 1;
            if (row.openingQty > 0) {
              after[product.id] = row.openingQty;
              moves.push({
                id: uuidv7(),
                branchId: bid,
                productId: product.id,
                delta: row.openingQty,
                reason: 'opening',
                refOrderId: null,
                note: 'From a spreadsheet',
                at: now,
                actorUserId: actorId(),
                ...NO_DELIVERY,
              });
            }
          }

          return {
            ...s,
            products,
            stock: { ...s.stock, [bid]: after },
            stockMoves: [...moves, ...s.stockMoves],
            lowStockAlerts: alertCrossings(s, before, after),
            audit: log(
              s.audit,
              'inventory.import',
              `Imported ${preview.rows.length} items from a spreadsheet: ${added} added, ${updated} updated`,
              'info',
              bid,
            ),
          };
        });
        return { ok: true };
      },

      // ── users ─────────────────────────────────────────────────────
      addUser: async ({ name, role, pin }) => {
        const refused = guard('users.manage');
        if (refused) return refused;
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: 'Give this person a name.' };
        if (!isValidPin(pin)) {
          return { ok: false, error: `The PIN has to be ${PIN_LENGTH} digits.` };
        }
        const clash = await pinTaken(get().users, pin);
        if (clash) {
          return {
            ok: false,
            error: `That PIN already belongs to ${clash.name}. Pick another one.`,
          };
        }

        const user: User = {
          id: uuidv7(),
          name: trimmed,
          role,
          active: true,
          pin: await hashPin(pin),
          createdAt: Date.now(),
          lastLoginAt: null,
        };
        set((state) => ({
          ...state,
          users: [...state.users, user],
          audit: log(
            state.audit,
            'user.create',
            `Added ${user.name} as ${role}`,
            'info',
            state.activeBranchId,
          ),
        }));
        return { ok: true };
      },

      setUserPin: async (id, pin) => {
        const refused = guard('users.manage');
        if (refused) return refused;
        return writePin(set, get, id, pin);
      },

      setUserRole: (id, role) => {
        const refused = guard('users.manage');
        if (refused) return refused;
        const state = get();
        const target = state.users.find((u) => u.id === id);
        if (!target) return { ok: false, error: 'That user no longer exists.' };
        if (target.role === role) return { ok: true };
        if (role !== 'superadmin' && isLastActiveSuperadmin(state.users, id)) {
          return {
            ok: false,
            error: 'This is the only active superadmin. Promote someone else first.',
          };
        }
        set((s) => ({
          ...s,
          users: s.users.map((u) => (u.id === id ? { ...u, role } : u)),
          audit: log(
            s.audit,
            'user.role',
            `${target.name} is now ${role}`,
            'warn',
            s.activeBranchId,
          ),
        }));
        return { ok: true };
      },

      /** Deactivate, never delete — orders, stock moves and audit rows point
       *  at these ids and a dangling actor is worse than an inactive one. */
      setUserActive: (id, active) => {
        const refused = guard('users.manage');
        if (refused) return refused;
        const state = get();
        const target = state.users.find((u) => u.id === id);
        if (!target) return { ok: false, error: 'That user no longer exists.' };
        if (!active && isLastActiveSuperadmin(state.users, id)) {
          return {
            ok: false,
            error: 'This is the only active superadmin. You would lock yourself out.',
          };
        }
        set((s) => ({
          ...s,
          users: s.users.map((u) => (u.id === id ? { ...u, active } : u)),
          audit: log(
            s.audit,
            active ? 'user.enable' : 'user.disable',
            `${active ? 'Reactivated' : 'Deactivated'} ${target.name}`,
            active ? 'info' : 'warn',
            s.activeBranchId,
          ),
        }));
        return { ok: true };
      },

      recordLogin: (id) =>
        set((state) => ({
          ...state,
          users: state.users.map((u) =>
            u.id === id ? { ...u, lastLoginAt: Date.now() } : u,
          ),
        })),

      // ── setup and recovery ────────────────────────────────────────
      setupInstall: async (input) => {
        if (get().users.length > 0) {
          return { ok: false, error: 'This device is already set up.' };
        }
        const businessName = input.businessName.trim();
        const ownerName = input.ownerName.trim();
        if (!businessName) return { ok: false, error: 'Give the business a name.' };
        if (!ownerName) return { ok: false, error: 'Give the owner a name.' };
        if (!isValidPin(input.pin)) {
          return { ok: false, error: `The PIN has to be ${PIN_LENGTH} digits.` };
        }

        const [pin, recovery, backupKey] = await Promise.all([
          hashPin(input.pin),
          hashRecoveryCode(input.recoveryCode),
          createBackupKey(input.recoveryCode),
        ]);
        const owner: User = {
          id: uuidv7(),
          name: ownerName,
          role: 'superadmin',
          active: true,
          pin,
          createdAt: Date.now(),
          lastLoginAt: null,
        };
        // 'none' is a shop with nothing on the shelf yet: no products, and so
        // no opening count to book.
        const { products, opening } =
          input.catalog === 'sample' ? seedCatalog(input.shopType) : { products: [], opening: {} };
        const at = Date.now();

        set((state) => {
          const branch: Branch = { ...(state.branches[0] ?? DEFAULT_BRANCH) };
          return {
            ...state,
            settings: {
              ...state.settings,
              businessName,
              shopType: input.shopType,
              features: applyPreset(input.shopType),
              // A brand-new till is in practice until the owner turns it off.
              trainingMode: true,
              // The checklist is a new owner's to work through, not one carried
              // over from a previous life on this device.
              checklistDismissed: [],
            },
            branches: [branch],
            activeBranchId: branch.id,
            products,
            stock: { [branch.id]: opening },
            // The first count is on the record like any other: the stock ledger
            // starts with what the shop says it already has, and every later
            // number is a movement away from it. Nobody is signed in yet, so
            // the wizard is the actor.
            stockMoves: [
              ...Object.entries(opening).map(([productId, delta]) => ({
                id: uuidv7(),
                branchId: branch.id,
                productId,
                delta,
                reason: 'opening' as const,
                refOrderId: null,
                note: 'Opening stock from the sample catalog',
                at,
                actorUserId: null,
                supplier: null,
                docNo: null,
                unitCostCents: null,
              })),
              ...state.stockMoves,
            ],
            users: [owner],
            recovery,
            backupKey,
            installId: uuidv7(),
            audit: log(
              state.audit,
              'install.setup',
              `Set up ${businessName} as a ${PRESETS[input.shopType].label} shop, ` +
                `with ${ownerName} as superadmin and ${products.length} items on the shelf`,
              'info',
              branch.id,
            ),
          };
        });
        return { ok: true };
      },

      recoveryCodeMatches: async (code) => {
        const { recovery } = get();
        return recovery ? verifyRecoveryCode(code, recovery) : false;
      },

      resetPinWithRecoveryCode: async (code, userId, pin) => {
        if (!(await get().recoveryCodeMatches(code))) {
          return { ok: false, error: 'That recovery code is not right.' };
        }
        const target = get().users.find((u) => u.id === userId);
        if (!target?.active || target.role !== 'superadmin') {
          return { ok: false, error: 'Only an active superadmin can be recovered this way.' };
        }
        const result = await writePin(set, get, userId, pin);
        if (result.ok) {
          set((s) => ({
            ...s,
            audit: log(
              s.audit,
              'user.recover',
              `Reset the PIN for ${target.name} with the recovery code`,
              'warn',
              s.activeBranchId,
            ),
          }));
        }
        return result;
      },

      replaceRecoveryCode: async (code) => {
        // Backups from now on need the new code; older ones still open with the old one.
        const [recovery, backupKey] = await Promise.all([hashRecoveryCode(code), createBackupKey(code)]);
        set((s) => ({
          ...s,
          recovery,
          backupKey,
          audit: log(
            s.audit,
            'recovery.replace',
            'Issued a new recovery code — the old one no longer works',
            'warn',
            s.activeBranchId,
          ),
        }));
      },

      setupFromBackup: async (snapshot, recoveryCode) => {
        if (get().users.length > 0) return { ok: false, error: 'This device is already set up.' };
        const restored = get().importSnapshot(snapshot);
        if (!restored.ok) return restored;
        const backupKey = await createBackupKey(recoveryCode);
        set((s) => ({
          ...s,
          // A new tablet is a new install; the license is activated again.
          installId: uuidv7(),
          backupKey,
          audit: log(s.audit, 'install.restore', 'Set up this tablet from a cloud backup', 'warn', s.activeBranchId),
        }));
        return { ok: true };
      },

      // ── license ───────────────────────────────────────────────────
      checkLicense: async () => {
        const device = await deviceFingerprint();
        const { license, installId } = get();
        set({ licensed: verifyLicense(license, { installId, device }) });
      },

      activate: async (key) => {
        const device = await deviceFingerprint();
        const { installId, settings } = get();
        if (!device || !installId) {
          return { ok: false, error: 'Licenses are activated in the Android app.' };
        }
        let reply: { license?: string; error?: string };
        try {
          const response = await fetch(`${LICENSE_SERVER_URL}/api/activate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: key.trim(), installId, device, businessName: settings.businessName }),
          });
          reply = await response.json();
        } catch {
          return { ok: false, error: 'Could not reach the license server. Check the internet connection.' };
        }
        if (!reply.license) return { ok: false, error: reply.error ?? 'Activation failed.' };

        const licensed = verifyLicense(reply.license, { installId, device });
        if (!licensed) return { ok: false, error: 'The server sent a license that does not match this tablet.' };
        set((s) => ({
          ...s,
          license: reply.license ?? null,
          licensed,
          audit: log(s.audit, 'license.activate', `Activated license ${licensed.licenseId}`, 'success', s.activeBranchId),
        }));
        return { ok: true };
      },

      // ── admin ─────────────────────────────────────────────────────
      setActiveBranch: (id) =>
        set((state) => ({
          ...state,
          activeBranchId: id,
          activeOrderId: null,
          stock: state.stock[id]
            ? state.stock
            : { ...state.stock, [id]: initialStock(state.products) },
        })),

      upsertBranch: (branch) =>
        set((state) => {
          const exists = state.branches.some((b) => b.id === branch.id);
          return {
            ...state,
            branches: exists
              ? state.branches.map((b) => (b.id === branch.id ? branch : b))
              : [...state.branches, branch],
            stock: state.stock[branch.id]
              ? state.stock
              : { ...state.stock, [branch.id]: initialStock(state.products) },
          };
        }),

      updateSettings: (patch) => {
        const refused = guard('settings.manage');
        if (refused) return refused;
        set((state) => {
          const settings = { ...state.settings, ...patch };
          // Setting the VAT switch either way answers the checklist's question.
          if ('vatRegistered' in patch) settings.checklistDismissed = dismissed(settings, 'vat');

          // Leaving training mode is a one-way door. A POS that has gone live
          // must not be able to re-enter it: training mode unlocks the demo
          // loader and the reset, either of which would write fabricated sales
          // over registered books. types.ts has always claimed this; until now
          // the Settings toggle handed it straight back.
          if (settings.trainingMode && !state.settings.trainingMode) {
            settings.trainingMode = false;
          }
          // Going live needs a license. Unlicensed, the till keeps working in
          // training mode, where its slips say so.
          if (!settings.trainingMode && state.settings.trainingMode && !state.licensed) {
            settings.trainingMode = true;
          }

          const audit =
            settings.vatRegistered !== state.settings.vatRegistered
              ? log(
                  state.audit,
                  'settings.vat',
                  `VAT registration turned ${settings.vatRegistered ? 'on' : 'off'}`,
                  'info',
                  state.activeBranchId,
                )
              : state.audit;

          if (state.settings.trainingMode && !settings.trainingMode) {
            // Practice data is wiped at go-live (spec section 5): practice
            // sales, their stock movements, summaries and quotes are not the
            // shop's books. Products, prices, users, settings and promo codes
            // stay. Stock starts at 0 — a sample catalog's opening quantities
            // are made up — so the first figure on the live ledger is a count.
            // Invoice and quote numbers carry on rather than restart, so no
            // number that was ever printed is issued twice.
            const cleared =
              `${state.orders.length} practice sale${state.orders.length === 1 ? '' : 's'}, ` +
              `${state.stockMoves.length} stock movements, ${state.closes.length} summaries ` +
              `and ${state.quotes.length} quotations`;
            return {
              ...state,
              settings,
              orders: [],
              stockMoves: [],
              closes: [],
              quotes: [],
              stock: Object.fromEntries(state.branches.map((b) => [b.id, {}])),
              lowStockAlerts: [],
              activeOrderId: null,
              promos: state.promos.map((p) => ({ ...p, firstUsedAt: null })),
              audit: log(
                log(audit, 'data.reset', `Went live: cleared ${cleared}`, 'danger', state.activeBranchId),
                'settings.golive',
                'Practice mode turned off — this install is now live and ' +
                  'cannot be put back into practice mode',
                'warn',
                state.activeBranchId,
              ),
            };
          }
          return { ...state, settings, audit };
        });
        return { ok: true };
      },

      loadDemoBusiness: (shopType, options) => {
        const state = get();
        // Same lock as practice mode itself: a live install must never be
        // able to write fabricated sales over its books.
        if (!state.settings.trainingMode) return 0;
        if (guard('settings.manage')) return 0;

        const branch = state.branches[0] ?? DEFAULT_BRANCH;
        const demo = buildDemoData({
          shopType,
          settings: state.settings,
          branch,
          days: options?.days,
          salesPerDay: options?.salesPerDay,
        });
        const sales = demo.orders.filter((o) => o.status !== 'open').length;
        const label = DEMO_BUSINESSES.find((b) => b.shopType === shopType)?.label ?? PRESETS[shopType].label;

        set((s) => ({
          ...s,
          // One install is one shop: the demo business trades at the main
          // branch. Branches the owner added stay, empty.
          activeBranchId: branch.id,
          settings: { ...s.settings, shopType, features: applyPreset(shopType) },
          products: demo.products,
          orders: demo.orders,
          stock: demo.stock,
          stockMoves: demo.stockMoves,
          quotes: demo.quotes,
          quoteSeq: demo.quoteSeq,
          promos: demo.promos,
          // Summaries describe the sales being replaced; they go with them.
          closes: [],
          invoiceSeq: demo.invoiceSeq,
          lowStockAlerts: [],
          activeOrderId: null,
          audit: log(
            s.audit,
            'demo.load',
            `Loaded the ${label} demo business — ${sales} sales`,
            'warn',
            branch.id,
          ),
        }));
        return sales;
      },

      // ── monthly archive ───────────────────────────────────────────
      archivableMonths: () => archivableMonths(get().orders),

      buildMonthlyArchive: (month) => {
        const s = get();
        return buildArchive({
          month,
          businessName: s.settings.businessName,
          installId: s.installId,
          branches: s.branches,
          products: s.products,
          users: s.users,
          orders: s.orders,
          stockMoves: s.stockMoves,
        });
      },

      pruneArchivedMonth: (archive) => {
        const problem = describeBadArchive(archive);
        if (problem) return { ok: false, error: problem };

        const covers = archiveCoversDevice(archive, get().orders);
        if (!covers.ok) return covers;

        set((state) => {
          // Open orders are never archived and never pruned — an unpaid table
          // from last month is still on the floor and still needs settling.
          const keep = state.orders.filter(
            (o) => o.status === 'open' || orderMonth(o) !== archive.month,
          );
          const gone = new Set(
            state.orders.filter((o) => !keep.includes(o)).map((o) => o.id),
          );
          const removed = state.orders.length - keep.length;

          return {
            ...state,
            orders: keep,
            // Stock moves follow their order. Loose moves (counts, restocks)
            // are kept: on-hand is a running balance and dropping the
            // adjustments that produced it would leave it unexplainable.
            stockMoves: state.stockMoves.filter(
              (m) => !m.refOrderId || !gone.has(m.refOrderId),
            ),
            audit: log(
              state.audit,
              'archive.prune',
              `Archived and removed ${removed} sales for ${monthLabel(archive.month)}`,
              'warn',
              state.activeBranchId,
            ),
          };
        });
        return { ok: true };
      },

      exportSnapshot: () => {
        const s = get();
        return {
          version: SNAPSHOT_VERSION,
          exportedAt: new Date().toISOString(),
          installId: s.installId,
          appVersion: APP_VERSION,
          branches: s.branches,
          users: s.users,
          products: s.products,
          promos: s.promos,
          quotes: s.quotes,
          quoteSeq: s.quoteSeq,
          orders: s.orders,
          stock: s.stock,
          stockMoves: s.stockMoves,
          closes: s.closes,
          audit: s.audit,
          settings: s.settings,
          invoiceSeq: s.invoiceSeq,
          recovery: s.recovery,
          license: s.license,
        };
      },

      importSnapshot: (file) => {
        // A restore replaces the books wholesale, so the file has to earn it.
        // Checking only that `products` was an array let a truncated or
        // hand-edited export through, and it reported success either way.
        const problem = describeBadSnapshot(file);
        if (problem) return { ok: false, error: problem };
        const snapshot = migrateSnapshot(file);

        set((state) => {
          const settings = { ...state.settings, ...snapshot.settings };
          // A backup must not be able to reopen the door updateSettings just
          // closed — otherwise the one-way lock is one file import wide.
          if (!state.settings.trainingMode) settings.trainingMode = false;

          const restored = {
            ...state,
            branches: snapshot.branches ?? state.branches,
            // An empty or missing user list is never restored over a working
            // one — a pre-logins backup would leave nobody able to sign in.
            users: snapshot.users?.length ? snapshot.users : state.users,
            products: snapshot.products,
            // Absent in backups made before promo codes existed.
            promos: snapshot.promos ?? [],
            // Absent in backups made before quotations existed.
            quotes: snapshot.quotes ?? [],
            quoteSeq: snapshot.quoteSeq ?? 1,
            orders: snapshot.orders ?? [],
            stock: snapshot.stock ?? {},
            stockMoves: snapshot.stockMoves ?? [],
            // Closes describe the restored sales, not the ones they replace.
            closes: snapshot.closes ?? [],
            audit: log(
              snapshot.audit ?? [],
              'data.import',
              `Restored ${snapshot.orders?.length ?? 0} orders from a backup ` +
                `exported ${snapshot.exportedAt ?? 'at an unknown time'}`,
              'warn',
              state.activeBranchId,
            ),
            settings,
            invoiceSeq: snapshot.invoiceSeq ?? {},
            // Travels with the users it recovers. A backup made before
            // recovery codes existed leaves the current one in place.
            recovery: snapshot.recovery ?? state.recovery,
            // Verified again below: on a replacement tablet it will not match,
            // and the owner re-activates.
            license: snapshot.license ?? state.license,
            activeOrderId: null,
          };
          // A v7 backup recorded overselling as a negative balance; it comes
          // back to zero on the record, exactly as it does at the upgrade.
          return { ...restored, ...resetNegativeStock(restored) };
        });
        void get().checkLicense();
        return { ok: true };
      },

      resetAll: () => {
        // Same lock as loadDemoData. Clearing the books on a registered POS is
        // not a thing the owner may do; corrections go through a void, and a
        // fresh start goes through Restore from a backup.
        if (!get().settings.trainingMode) return false;

        set((state) => ({
          ...state,
          orders: [],
          stockMoves: [],
          closes: [],
          activeOrderId: null,
          // Codes stay, but the practice sales that locked them are gone, so
          // they are editable again.
          promos: state.promos.map((p) => ({ ...p, firstUsedAt: null })),
          // The menu is the owner's and stays; only its stock starts over.
          stock: { [state.activeBranchId]: initialStock(state.products) },
          // The invoice sequence is deliberately NOT reset. Restarting it at 1
          // reissues numbers that have already been on a printed receipt, and
          // a duplicated invoice number is worse than a large one.
          //
          // The audit log is deliberately NOT cleared either. Wiping the
          // record along with the data leaves nothing to say the wipe ever
          // happened, which is precisely the pattern an audit looks for.
          audit: log(
            state.audit,
            'data.reset',
            `Cleared ${state.orders.length} orders and ` +
              `${state.stockMoves.length} stock movements`,
            'danger',
            state.activeBranchId,
          ),
        }));
        return true;
      },

      unbackedUp: () => {
        const { orders, lastBackupAt } = get();
        // Never backed up: everything on the device is at risk.
        if (lastBackupAt === null) return orders.length;
        return orders.filter((o) => (o.closedAt ?? o.openedAt) > lastBackupAt).length;
      },

      oldestSaleSince: (since) => {
        const times = get()
          .orders.map((o) => o.closedAt ?? o.openedAt)
          .filter((t) => since === null || t > since);
        return times.length > 0 ? Math.min(...times) : null;
      },

      uploadCloudBackup: async () => {
        const s = get();
        if (!s.license || !s.licensed) return { ok: false, error: 'Activate a license to back up to the cloud.' };
        if (!s.backupKey) {
          return { ok: false, error: 'Issue a new recovery code in Settings to turn on cloud backup.' };
        }
        try {
          await uploadBackup(await sealBackup(s.exportSnapshot(), s.backupKey), s.license, s.backupKey.salt);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Cloud backup failed.' };
        }
        set({ lastCloudBackupAt: Date.now() });
        return { ok: true };
      },

      recordBackup: () =>
        set((state) => ({
          ...state,
          lastBackupAt: Date.now(),
          audit: log(
            state.audit,
            'data.backup',
            `Backup saved — ${state.orders.length} order${state.orders.length === 1 ? '' : 's'}`,
            'success',
            state.activeBranchId,
          ),
        })),

      unclosedSales: () => unclosedTimes(get()).length,

      oldestUnclosed: () => {
        const times = unclosedTimes(get());
        return times.length > 0 ? Math.min(...times) : null;
      },

      closeDay: async (countedCashCents) => {
        // The nightly close runs by itself, signed in or not. A close with a
        // count is the owner's, taken by hand.
        if (countedCashCents != null && guard('reports.view')) return null;
        if (get().unclosedSales() === 0) return null;
        // The count is hashed into the chain and can never be corrected.
        if (countedCashCents != null && (!Number.isSafeInteger(countedCashCents) || countedCashCents < 0)) {
          return null;
        }
        const previous = get().closes.at(-1) ?? null;
        const close = await signClose(
          buildClose({
            id: uuidv7(),
            orders: get().orders,
            previous,
            now: Date.now(),
            actor: actorId(),
            countedCashCents,
          }),
        );
        // Hashing is async. If another close landed meanwhile, this one would
        // fork the chain — drop it; the other already covers these sales.
        if ((get().closes.at(-1) ?? null) !== previous) return null;
        set((s) => ({
          ...s,
          closes: [...s.closes, close],
          audit: log(
            s.audit,
            'day.close',
            `Today's summary #${close.no} — ${close.orders} sale${close.orders === 1 ? '' : 's'}, ` +
              `net ${(close.netCents / 100).toFixed(2)}`,
            'success',
            s.activeBranchId,
          ),
        }));
        return close;
      },

      clearPersistError: () => set({ persistError: null }),
    }),
    {
      // Frozen, like DB_NAME in idb.ts: a new name is an empty till.
      name: 'pos034-v7',
      // Stored data changes shape only in lib/migrate.ts. Bump `version` only
      // together with a step there: without one, zustand discards stored state
      // whose version differs — an empty till after an app update.
      version: 8,
      migrate: (persisted) => migrateBlobV7(persisted) as PosState,
      // zustand's shallow merge, except that saved settings missing a field
      // (a blob written before it existed) get its default, and missing
      // features come from the saved shop type's preset.
      merge: (persisted, current) => {
        const p = persisted as Partial<PosState> | undefined;
        if (!p?.settings) return { ...current, ...p };
        const settings = { ...DEFAULT_SETTINGS, ...p.settings };
        settings.features = { ...applyPreset(settings.shopType), ...p.settings.features };
        return { ...current, ...p, settings };
      },
      storage: createJSONStorage(() => blobStorage),
      // Orders, stock moves, closes, products and the audit log are
      // deliberately absent: they go to their own row stores, and only changed
      // rows are written. Everything listed here is small and rarely touched,
      // so rewriting it wholesale is free. See the note on ROWS in lib/storage.ts.
      partialize: (state) => ({
        branches: state.branches,
        users: state.users,
        stock: state.stock,
        rowsNeedV8: state.rowsNeedV8,
        lowStockAlerts: state.lowStockAlerts,
        settings: state.settings,
        invoiceSeq: state.invoiceSeq,
        quoteSeq: state.quoteSeq,
        recovery: state.recovery,
        installId: state.installId,
        license: state.license,
        backupKey: state.backupKey,
        lastCloudBackupAt: state.lastCloudBackupAt,
        activeBranchId: state.activeBranchId,
        lastBackupAt: state.lastBackupAt,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          failLoad('Could not read saved data. Work in this session may not be saved.');
          return;
        }
        state?.setActiveOrder(null);
        // The blob is back; the sales are not. Nothing may be marked hydrated
        // until they are, or the first render would show an empty till and a
        // subsequent write could persist that emptiness.
        void loadRows(state);
      },
    },
  ),
);

/**
 * A write that never landed is the failure v6 died of. The adapter reports
 * every outcome here and the topbar shows it until a later write succeeds.
 * The equality guard matters: setState triggers another write, so without it
 * a failing device would spin.
 */
onPersistWrite((error) => {
  if (usePos.getState().persistError === error) return;
  usePos.setState({ persistError: error });
});

// ── Saving ───────────────────────────────────────────────────────────────
// Sales, stock moves, closes, products and the audit log live in their own
// row stores rather than the blob. They stay in memory for reading — every
// screen that filters or sums them is untouched — but only the rows that
// actually changed are written.
//
// Each change is saved as one batch: the blob and every changed row, in one
// transaction. persist hands the blob to `blobStorage` right after `set()`,
// once subscribers have run; the subscriber below only schedules `flush` for
// the end of the tick, which then diffs the rows and takes that blob.
//
// A row counts as saved only once its batch has landed, and batches go one at
// a time, so each is diffed against what the last one really saved. A batch
// that fails leaves its rows unsaved: the next batch carries them again, and
// the error stays on screen until a batch that carries them lands.

/** The row stores this store fills. Each is named after its state field. */
const SAVED = [
  ROWS.orders,
  ROWS.stockMoves,
  ROWS.closes,
  ROWS.products,
  ROWS.promos,
  ROWS.quotes,
  ROWS.audit,
] as const;
type Saved = (typeof SAVED)[number];
type Row = { id: string };
type SavedRows = { store: Saved; changed: Row[]; removed: string[] };

/** What each row store holds on disk, so a change can be spotted by identity. */
const written = Object.fromEntries(SAVED.map((store) => [store, new Map<string, Row>()])) as Record<
  Saved,
  Map<string, Row>
>;
/** The array each store held when a batch last saved it. An untouched array is skipped. */
const lastSaved: Partial<Record<Saved, Row[]>> = {};

/**
 * Rows whose object identity differs from what the store holds on disk. Every
 * mutation in this store rebuilds changed rows with a spread and leaves the
 * rest alone, so a reference comparison is an exact and very cheap change
 * detector — no serialising, no deep equality. Pure: `written` is only
 * updated once the batch carrying these rows has landed.
 */
function diffRows<T extends { id: string }>(
  current: T[],
  written: Map<string, T>,
): { changed: T[]; removed: string[] } {
  const changed: T[] = [];
  const seen = new Set<string>();
  let added = 0;

  for (const row of current) {
    seen.add(row.id);
    const before = written.get(row.id);
    if (before === undefined) added++;
    if (before !== row) changed.push(row);
  }

  // Removals are rare — a month archived away, or the audit log past its cap
  // — so the extra pass runs only when some written id is missing. The new
  // rows have to be counted: at the cap one entry arrives as another drops
  // off, and the size alone does not change.
  const removed: string[] =
    written.size + added === seen.size
      ? []
      : [...written.keys()].filter((id) => !seen.has(id));

  return { changed, removed };
}

let flushScheduled = false;
/** A batch is on its way to disk. */
let saving = false;
/** Something changed while it was; save again once it lands or fails. */
let changedWhileSaving = false;

/** Save everything not yet on disk: the blob and every changed row, as one batch. */
function flush(): void {
  flushScheduled = false;
  if (loadFailed) return;
  if (saving) {
    changedWhileSaving = true;
    return;
  }

  const state = usePos.getState();
  const rows: SavedRows[] = [];
  const diffed: Partial<Record<Saved, Row[]>> = {};
  for (const store of SAVED) {
    const current: Row[] = state[store];
    if (current === lastSaved[store]) continue;
    diffed[store] = current;
    const { changed, removed } = diffRows(current, written[store]);
    if (changed.length > 0 || removed.length > 0) rows.push({ store, changed, removed });
  }
  const blob = takePendingBlob();
  if (!blob && rows.length === 0) {
    // Nothing differs from disk, so these arrays are as good as saved.
    Object.assign(lastSaved, diffed);
    return;
  }

  saving = true;
  void writeBatch({ kv: blob ? [blob] : [], rows } satisfies WriteBatch).then((landed) => {
    saving = false;
    if (landed) {
      for (const { store, changed, removed } of rows) {
        for (const row of changed) written[store].set(row.id, row);
        for (const id of removed) written[store].delete(id);
      }
      Object.assign(lastSaved, diffed);
    }
    if (changedWhileSaving) {
      changedWhileSaving = false;
      flush();
    }
  });
}

// Nothing is saved until the rows are back, or an empty till could be written
// over a full one. Blobs handed over before then are not lost: the latest is
// held, and the first flush after `hydrated` takes it.
usePos.subscribe((state) => {
  if (!state.hydrated || flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
});

/** Audit order: latest `at` first, then the higher id. */
function newestFirst(a: AuditEntry, b: AuditEntry): number {
  return b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * Read the rows back and open the till. Installs written before a row store
 * existed carry its rows inside the rehydrated blob instead; those are adopted
 * here. `written` records only what the stores really hold, so adopted rows —
 * and v7 orders upgraded on the way in — go out with the first save, in the
 * same batch as the blob that no longer carries them. The upgrade costs the
 * owner nothing and loses nothing.
 */
async function loadRows(rehydrated: PosState | undefined): Promise<void> {
  try {
    const [rows, moves, closes, products, promos, quotes, audit] = await Promise.all([
      readRows<Order>(ROWS.orders),
      readRows<StockMove>(ROWS.stockMoves),
      readRows<DailyClose>(ROWS.closes),
      readRows<Product>(ROWS.products),
      readRows<Promo>(ROWS.promos),
      readRows<Quote>(ROWS.quotes),
      readRows<AuditEntry>(ROWS.audit),
    ]);

    const stored: Record<Saved, Row[]> = {
      orders: rows,
      stockMoves: moves,
      closes,
      products,
      promos,
      quotes,
      audit,
    };
    for (const store of SAVED) {
      written[store] = new Map(stored[store].map((row) => [row.id, row] as const));
      // The first save diffs every store against what was just read.
      delete lastSaved[store];
    }

    const loaded = rows.length > 0 ? rows : (rehydrated?.orders ?? []);
    const loadedMoves = moves.length > 0 ? moves : (rehydrated?.stockMoves ?? []);
    // A v7 install counted whole units. Its rows come up to thousandths here,
    // once: the first save writes them with the flag cleared, in one batch.
    const upgrade = rehydrated?.rowsNeedV8 === true;
    const next = {
      // v7 orders carry no `discount`; they come up to v8 on the way in.
      orders: loaded.map((o) => (upgrade || !('discount' in o) ? migrateOrderV7(o) : o)),
      stockMoves: upgrade ? loadedMoves.map(migrateMoveV7) : loadedMoves,
      closes,
      products: products.length > 0 ? products : (rehydrated?.products ?? []),
      promos,
      quotes,
      // The log is kept newest first. Rows come back in id order, which is not
      // quite time order, so sort by time and break ties by id.
      audit: audit.length > 0 ? [...audit].sort(newestFirst) : (rehydrated?.audit ?? []),
    };
    loadFailed = false;
    // A blob saved before `quoteSeq` was kept restarts at 1; never hand out a
    // number a stored quote already has.
    const highestQuote = Math.max(0, ...quotes.map((q) => Number(q.quoteNo.slice(2)) || 0));
    usePos.setState({
      ...next,
      quoteSeq: Math.max(usePos.getState().quoteSeq, highestQuote + 1),
      ...(upgrade ? resetNegativeStock({ ...next, stock: usePos.getState().stock }) : {}),
      rowsNeedV8: false,
      hydrated: true,
    });
    void usePos.getState().checkLicense();
  } catch {
    failLoad('Could not read saved sales. Work in this session may not be saved.');
  }
}

/**
 * v7 recorded overselling as a negative balance. Stock is not meant to go
 * below zero, so at the upgrade each negative balance is counted back to zero,
 * with a count move and an audit entry, so the correction is on the record.
 */
function resetNegativeStock(
  s: Pick<PosState, 'stock' | 'stockMoves' | 'audit' | 'products'>,
): Pick<PosState, 'stock' | 'stockMoves' | 'audit'> {
  let { stock, stockMoves, audit } = s;
  for (const [branchId, onHand] of Object.entries(s.stock)) {
    for (const [productId, q] of Object.entries(onHand)) {
      if (q >= 0) continue;
      stock = { ...stock, [branchId]: { ...stock[branchId], [productId]: 0 as Qty } };
      const move: StockMove = {
        id: uuidv7(),
        branchId,
        productId,
        delta: -q as Qty,
        reason: 'count',
        refOrderId: null,
        note: UPGRADE_RESET_NOTE,
        at: Date.now(),
        actorUserId: actorId(),
        ...NO_DELIVERY,
      };
      stockMoves = [move, ...stockMoves];
      const name = s.products.find((p) => p.id === productId)?.name ?? productId;
      audit = log(
        audit,
        'stock.reset',
        `${name} was at ${formatQty(q)}; counted back to 0 at upgrade`,
        'warn',
        branchId,
      );
    }
  }
  return { stock, stockMoves, audit };
}

/**
 * Serving deducts stock. Stock never goes below zero: if the shelf can't cover
 * every line being served, none of them is, and the refusal names the line.
 */
type SetState = (fn: (state: PosState) => PosState) => void;

function serveLines(
  set: SetState,
  get: () => PosState,
  order: Order,
  lines: OrderLine[],
): UserResult {
  const onHand = get().stock[order.branchId] ?? {};
  const short = shortLine(lines, onHand);
  if (short) return { ok: false, error: short };

  const now = Date.now();
  const actor = actorId();
  const taken = deduct(onHand, lines, order, now, actor);
  const served = new Set(lines.map((l) => l.lineNo));
  set((state) => ({
    ...state,
    stock: { ...state.stock, [order.branchId]: taken.onHand },
    lowStockAlerts: alertCrossings(state, onHand, taken.onHand),
    stockMoves: [...taken.moves, ...state.stockMoves],
    orders: state.orders.map((o) =>
      o.id !== order.id
        ? o
        : {
            ...o,
            // First waiter to put food on the table owns the service.
            servedBy: o.servedBy ?? actor,
            lines: o.lines.map((l) =>
              served.has(l.lineNo) ? { ...l, served: true, servedAt: now } : l,
            ),
          },
    ),
  }));
  return { ok: true };
}

/** Set someone's PIN. Unguarded: `setUserPin` checks users.manage first, and
 *  on the lock screen the recovery code is the proof. */
async function writePin(
  set: SetState,
  get: () => PosState,
  id: string,
  pin: string,
): Promise<UserResult> {
  const target = get().users.find((u) => u.id === id);
  if (!target) return { ok: false, error: 'That user no longer exists.' };
  if (!isValidPin(pin)) {
    return { ok: false, error: `The PIN has to be ${PIN_LENGTH} digits.` };
  }
  const clash = await pinTaken(get().users, pin, id);
  if (clash) {
    return {
      ok: false,
      error: `That PIN already belongs to ${clash.name}. Pick another one.`,
    };
  }

  const credential = await hashPin(pin);
  set((state) => ({
    ...state,
    users: state.users.map((u) => (u.id === id ? { ...u, pin: credential } : u)),
    audit: log(
      state.audit,
      'user.pin',
      `Changed the PIN for ${target.name}`,
      'warn',
      state.activeBranchId,
    ),
  }));
  return { ok: true };
}

/** One discount per sale, and only while it is open: a closed sale's totals are frozen. */
/** Why a promo cannot be saved in this shape, or null when it is fine. */
function badPromoInput(existing: readonly Promo[], input: PromoInput): string | null {
  const code = normalizeCode(input.code);
  if (!isValidCode(code)) return 'Use 3 to 12 letters or digits, no spaces or symbols.';
  if (existing.some((p) => p.code === code)) return 'That code is already in use.';
  if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100) {
    return 'Enter a whole percent from 1 to 100.';
  }
  if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
    return 'The last day cannot be before the first day.';
  }
  return null;
}

/**
 * Put one discount on an open sale. A sale carries at most one, so a code and
 * an owner discount replace each other.
 *
 * Changing the discount after a payment was entered clears the payment. The
 * amount it was taken against no longer exists, and cash change worked out on
 * the old total is money the drawer will not balance. Wiping it is safer than
 * letting a stale tender sit there waiting to be refused at close.
 */
function setOpenDiscount(
  set: SetState,
  get: () => PosState,
  orderId: string,
  discount: SaleDiscount,
): UserResult {
  const order = get().order(orderId);
  if (!order || order.status !== 'open') {
    return { ok: false, error: 'That sale is no longer open.' };
  }
  // Re-applying the discount a sale already has changes nothing, so nothing
  // the cashier entered is thrown away.
  if (sameDiscount(order.discount, discount)) return { ok: true };
  const clearedPayments = order.tenders.length > 0;
  set((state) => ({
    ...state,
    orders: state.orders.map((o) =>
      o.id === orderId ? { ...o, discount, tenders: clearedPayments ? [] : o.tenders } : o,
    ),
  }));
  return clearedPayments
    ? { ok: true, notice: 'Discount changed — enter the payment again.' }
    : { ok: true };
}

/** A shop with quotations switched off makes none, whatever the screen shows. */
function quotesOff(state: PosState): { ok: false; error: string } | null {
  return state.settings.features.quotes
    ? null
    : { ok: false, error: 'Quotations are switched off for this shop.' };
}

/**
 * An order converted from a quote that goes away unpaid gives the quote back:
 * the customer can still take it up, at the prices on it.
 */
function reopenQuote(quotes: Quote[], order: Order): Quote[] {
  if (!order.fromQuoteId) return quotes;
  return quotes.map((q) =>
    q.id === order.fromQuoteId && q.status === 'converted' && q.convertedSaleId === order.id
      ? { ...q, status: 'open', convertedSaleId: null }
      : q,
  );
}

function sameDiscount(a: SaleDiscount, b: SaleDiscount): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'promo' && b.kind === 'promo') return a.promoId === b.promoId && a.percent === b.percent;
  if (a.kind === 'owner' && b.kind === 'owner') return a.percent === b.percent && a.fixedCents === b.fixedCents;
  return true;
}

/** Live bill for an open order, recomputed from current settings. */
export function useBill(orderId: string | null) {
  const order = usePos((s) => (orderId ? s.orders.find((o) => o.id === orderId) : undefined));
  const settings = usePos((s) => s.settings);
  if (!order) return null;
  return billOf(order, settings);
}

export type { TenderMethod };
export { businessDate };
