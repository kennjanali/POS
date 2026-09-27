'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { APP_VERSION, LICENSE_SERVER_URL, PRODUCT_NAME } from '@/lib/brand';
import { buildClose, inWindow, signClose } from '@/lib/closes';
import { createBackupKey, sealBackup, uploadBackup, type BackupKey } from '@/lib/cloudBackup';
import { buildDemoData } from '@/lib/demo';
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
import { type Centavos, addC, cents, mulQty } from '@/lib/money';
import { discountRequest, migrateBlobV7, migrateOrderV7, migrateSnapshot } from '@/lib/migrate';
import { applyPreset } from '@/lib/presets';
import { computeBill } from '@/lib/tax';
import { DEFAULT_BRANCH, DEFAULT_SETTINGS, OPENING_STOCK, SAMPLE_MENU } from '@/lib/seed';
import { actorId, useAuth } from './useAuth';
import type {
  AuditEntry,
  Branch,
  DailyClose,
  Order,
  OrderLine,
  OrderType,
  Product,
  SaleDiscount,
  Settings,
  StockMove,
  StockReason,
  Tender,
  TenderMethod,
  DataSnapshot,
  Role,
  User,
} from '@/lib/types';

/** Every user mutation can fail on a rule the UI has to explain. */
export type UserResult = { ok: true } | { ok: false; error: string };

/**
 * The store's own permission check. Screens hide what staff may not do; this
 * refuses it anyway, so a missed button or a stale screen cannot void a sale
 * or change a price. Null means go ahead.
 */
function guard(p: Permission): UserResult | null {
  return can(useAuth.getState().session, p)
    ? null
    : { ok: false, error: 'Only the owner can do that.' };
}

/** What the first-run wizard collects. */
export interface SetupInput {
  business: Pick<
    Settings,
    'businessName' | 'address' | 'vatRegistered'
  >;
  sampleMenu: boolean;
  ownerName: string;
  pin: string;
  /** Generated and shown by the wizard; only its hash is kept. */
  recoveryCode: string;
}

interface PosState {
  branches: Branch[];
  /** Who may sign in. Business data, so it lives here and in the snapshot —
   *  the *session* is separate and never persists past the tab. */
  users: User[];
  products: Product[];
  orders: Order[];
  /** branchId -> productId -> on hand */
  stock: Record<string, Record<string, number>>;
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

  // ── selectors ───────────────────────────────────────────────────────
  branch: (id?: string) => Branch | undefined;
  user: (id: string | null) => User | undefined;
  order: (id: string | null) => Order | undefined;
  product: (id: string) => Product | undefined;
  stockOf: (productId: string, branchId?: string) => number;
  openOrders: () => Order[];

  // ── order lifecycle ─────────────────────────────────────────────────
  openOrder: (label: string, type: OrderType) => string;
  setActiveOrder: (id: string | null) => void;
  addLine: (orderId: string, productId: string, qty?: number) => void;
  changeQty: (orderId: string, lineNo: number, delta: number) => void;
  voidLine: (orderId: string, lineNo: number, reason: string) => UserResult;
  serveAll: (orderId: string) => void;
  serveLine: (orderId: string, lineNo: number) => void;

  clearDiscount: (orderId: string) => UserResult;
  /** Temporary, for Checkout's "Discount %" until Task 12's owner and promo setters. */
  setOwnerDiscountPercent: (orderId: string, percent: number) => UserResult;

  addTender: (
    orderId: string,
    tender: Omit<Tender, 'id' | 'takenAt'>,
  ) => void;
  removeTender: (orderId: string, tenderId: string) => void;
  closeOrder: (orderId: string) => boolean;
  voidOrder: (orderId: string, reason: string) => UserResult;

  // ── inventory ───────────────────────────────────────────────────────
  adjustStock: (
    productId: string,
    delta: number,
    reason: StockReason,
    note?: string,
    branchId?: string,
  ) => UserResult;
  upsertProduct: (product: Product) => UserResult;
  removeProduct: (productId: string) => UserResult;

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
  loadDemoData: (options?: { days?: number; ordersPerDay?: number }) => number;
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
  closeDay: () => Promise<DailyClose | null>;
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
    (sum, line) => addC(sum, mulQty(line.unitCents, line.qty)),
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

function blankOrder(
  id: string,
  invoiceNo: string,
  branchId: string,
  label: string,
  type: OrderType,
): Order {
  return {
    id,
    invoiceNo,
    branchId,
    label,
    type,
    status: 'open',
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

function initialStock(products: Product[]): Record<string, number> {
  return Object.fromEntries(products.map((p) => [p.id, OPENING_STOCK]));
}

export const usePos = create<PosState>()(
  persist(
    (set, get) => ({
      branches: [DEFAULT_BRANCH],
      // Empty until the first-run wizard names the owner — AuthGate shows the
      // wizard while this list is empty. No account ships with the app.
      users: [],
      products: [],
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
        return get().stock[bid]?.[productId] ?? 0;
      },
      openOrders: () =>
        get()
          .orders.filter(
            (o) => o.status === 'open' && o.branchId === get().activeBranchId,
          )
          .sort((a, b) => a.openedAt - b.openedAt),

      // ── order lifecycle ───────────────────────────────────────────
      openOrder: (label, type) => {
        const id = uuidv7();
        set((state) => {
          const { invoiceNo, seq } = nextInvoiceNo(
            state.invoiceSeq,
            state.branches.find((b) => b.id === state.activeBranchId),
            state.activeBranchId,
          );
          const order = blankOrder(id, invoiceNo, state.activeBranchId, label, type);
          return {
            orders: [...state.orders, order],
            invoiceSeq: seq,
            activeOrderId: id,
            audit: log(
              state.audit,
              'order.open',
              `Opened ${invoiceNo} — ${label}`,
              'info',
              state.activeBranchId,
            ),
          };
        });
        return id;
      },

      setActiveOrder: (id) => set({ activeOrderId: id }),

      addLine: (orderId, productId, qty = 1) =>
        set((state) => {
          const product = state.products.find((p) => p.id === productId);
          if (!product) return state;

          const orders = state.orders.map((o) => {
            if (o.id !== orderId || o.status !== 'open') return o;

            // Merge into an existing unserved line for the same product.
            const existing = o.lines.find(
              (l) => l.productId === productId && !l.served && !l.voided,
            );
            if (existing) {
              return {
                ...o,
                lines: o.lines.map((l) =>
                  l.lineNo === existing.lineNo ? { ...l, qty: l.qty + qty } : l,
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
              qty,
              served: false,
              servedAt: null,
              voided: false,
              voidReason: null,
            };
            return { ...o, lines: [...o.lines, line] };
          });
          return { ...state, orders };
        }),

      changeQty: (orderId, lineNo, delta) =>
        set((state) => ({
          ...state,
          orders: state.orders.map((o) => {
            if (o.id !== orderId || o.status !== 'open') return o;
            return {
              ...o,
              lines: o.lines
                .map((l) =>
                  l.lineNo === lineNo && !l.served
                    ? { ...l, qty: Math.max(0, l.qty + delta) }
                    : l,
                )
                .filter((l) => l.qty > 0 || l.served || l.voided),
            };
          }),
        })),

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

          // Voiding a served line returns its stock.
          const moves: StockMove[] = [];
          let stock = state.stock;
          if (line.served) {
            const branchStock = { ...(stock[order.branchId] ?? {}) };
            branchStock[line.productId] =
              (branchStock[line.productId] ?? 0) + line.qty;
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
              `Voided ${line.qty}x ${line.name} on ${order.invoiceNo} — ${reason}`,
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
        if (!order || order.status !== 'open') return;
        if (!line || line.served || line.voided) return;
        serveLines(set, order, [line]);
      },

      serveAll: (orderId) => {
        const order = get().order(orderId);
        // Serving after the bill is settled would deduct stock for food that
        // was never charged for.
        if (!order || order.status !== 'open') return;
        const pending = order.lines.filter((l) => !l.served && !l.voided);
        if (pending.length === 0) return;
        serveLines(set, order, pending);
      },

      clearDiscount: (orderId) => setOpenDiscount(set, get, orderId, { kind: 'none' }),

      setOwnerDiscountPercent: (orderId, percent) => {
        const refused = guard('discount.owner');
        if (refused) return refused;
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          return { ok: false, error: 'Enter a percent from 0 to 100.' };
        }
        return setOpenDiscount(set, get, orderId, {
          kind: 'owner',
          percent,
          fixedCents: null,
          by: actorId(),
        });
      },

      addTender: (orderId, tender) =>
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
        })),

      removeTender: (orderId, tenderId) =>
        set((state) => ({
          ...state,
          orders: state.orders.map((o) =>
            o.id === orderId && o.status === 'open'
              ? { ...o, tenders: o.tenders.filter((t) => t.id !== tenderId) }
              : o,
          ),
        })),

      closeOrder: (orderId) => {
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || order.status !== 'open') return false;

        const served = order.lines.filter((l) => l.served && !l.voided);
        if (served.length === 0) return false;

        const gross = served.reduce<Centavos>(
          (sum, l) => addC(sum, mulQty(l.unitCents, l.qty)),
          cents(0),
        );
        const bill = computeBill(gross, state.settings, discountRequest(order.discount));

        // Money kept has to equal the bill exactly. Checking the tender total
        // alone was not enough: applying a discount or voiding a line *after*
        // payment was recorded leaves a stale tender behind. Cash change was
        // worked out against the old, higher total, and an e-wallet transfer
        // cannot give change at all — settling either way books money the
        // wallet statement will never show. Re-record the tender instead.
        if (keptByTill(order) !== bill.amountDue) return false;

        set((s) => ({
          ...s,
          activeOrderId: s.activeOrderId === orderId ? null : s.activeOrderId,
          orders: s.orders.map((o) =>
            o.id !== orderId
              ? o
              : {
                  ...o,
                  status: 'closed' as const,
                  closedAt: Date.now(),
                  paidBy: actorId(),
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
            `Closed ${order.invoiceNo} — ${(bill.amountDue / 100).toFixed(2)}`,
            'success',
            order.branchId,
          ),
        }));
        return true;
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

          // Return stock for every served line.
          const branchStock = { ...(state.stock[order.branchId] ?? {}) };
          const moves: StockMove[] = [];
          for (const line of order.lines) {
            if (!line.served || line.voided) continue;
            branchStock[line.productId] =
              (branchStock[line.productId] ?? 0) + line.qty;
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
            });
          }

          return {
            ...state,
            activeOrderId:
              state.activeOrderId === orderId ? null : state.activeOrderId,
            stock: { ...state.stock, [order.branchId]: branchStock },
            stockMoves: [...moves, ...state.stockMoves],
            orders: state.orders.map((o) =>
              o.id !== orderId
                ? o
                : {
                    ...o,
                    status: 'voided' as const,
                    voidedReason: reason,
                    voidedAt: Date.now(),
                    voidedBy: actorId(),
                  },
            ),
            audit: log(
              state.audit,
              'order.void',
              `Voided ${order.invoiceNo} — ${reason}`,
              'danger',
              order.branchId,
            ),
          };
        });
        return { ok: true };
      },

      // ── inventory ─────────────────────────────────────────────────
      adjustStock: (productId, delta, reason, note, branchId) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
        set((state) => {
          const bid = branchId ?? state.activeBranchId;
          const branchStock = { ...(state.stock[bid] ?? {}) };
          branchStock[productId] = (branchStock[productId] ?? 0) + delta;
          const move: StockMove = {
            id: uuidv7(),
            branchId: bid,
            productId,
            delta,
            reason,
            refOrderId: null,
            note: note ?? null,
            at: Date.now(),
            actorUserId: actorId(),
          };
          return {
            ...state,
            stock: { ...state.stock, [bid]: branchStock },
            stockMoves: [move, ...state.stockMoves],
          };
        });
        return { ok: true };
      },

      upsertProduct: (product) => {
        const refused = guard('inventory.manage');
        if (refused) return refused;
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
        const businessName = input.business.businessName.trim();
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
        const address = input.business.address.trim();
        const products = input.sampleMenu ? SAMPLE_MENU : [];

        set((state) => {
          const branch: Branch = {
            ...(state.branches[0] ?? DEFAULT_BRANCH),
            address,
          };
          return {
            ...state,
            settings: {
              ...state.settings,
              ...input.business,
              businessName,
              address,
            },
            branches: [branch],
            activeBranchId: branch.id,
            products,
            stock: { [branch.id]: initialStock(products) },
            users: [owner],
            recovery,
            backupKey,
            installId: uuidv7(),
            audit: log(
              state.audit,
              'install.setup',
              `Set up ${businessName} with ${ownerName} as superadmin`,
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
            return {
              ...state,
              settings,
              audit: log(
                audit,
                'settings.golive',
                'Training mode turned off — this install is now live and ' +
                  'cannot be put back into training mode',
                'warn',
                state.activeBranchId,
              ),
            };
          }
          return { ...state, settings, audit };
        });
        return { ok: true };
      },

      loadDemoData: (options) => {
        const state = get();
        // Same lock as trainingMode itself: a BIR-registered install must not
        // be able to write fabricated sales over its books.
        if (!state.settings.trainingMode) return 0;

        const mainBranch = state.branches[0] ?? DEFAULT_BRANCH;
        // Demo sales need something to sell. An install that skipped the
        // sample menu gets it along with the demo.
        const products = state.products.length > 0 ? state.products : SAMPLE_MENU;
        const demo = buildDemoData({
          products,
          settings: state.settings,
          mainBranch,
          days: options?.days,
          ordersPerDay: options?.ordersPerDay,
        });

        // Branches the owner made themselves are left alone; the demo ones are
        // added beside them. Stock is merged for the same reason.
        //
        // A demo branch is only added if both its id and its BIR branch code
        // are still free. The code is what prefixes an invoice number, so two
        // branches sharing one issue the same invoice number twice — the very
        // thing the Add branch form refuses. A demo branch that cannot be
        // added takes its orders and stock with it rather than leaving them
        // attached to the owner's branch of the same id.
        const byId = new Map(state.branches.map((b) => [b.id, b]));
        const usedCodes = new Set(state.branches.map((b) => b.branchCode));
        for (const branch of demo.branches) {
          if (byId.has(branch.id) || usedCodes.has(branch.branchCode)) continue;
          byId.set(branch.id, branch);
          usedCodes.add(branch.branchCode);
        }

        const kept = new Set(
          demo.branches.filter((b) => byId.get(b.id) === b).map((b) => b.id),
        );
        kept.add(mainBranch.id);
        const orders = demo.orders.filter((o) => kept.has(o.branchId));
        const stockMoves = demo.stockMoves.filter((m) => kept.has(m.branchId));
        const stock = Object.fromEntries(
          Object.entries(demo.stock).filter(([id]) => kept.has(id)),
        );
        const invoiceSeq = Object.fromEntries(
          Object.entries(demo.invoiceSeq).filter(([id]) => kept.has(id)),
        );

        set((s) => ({
          ...s,
          branches: [...byId.values()],
          products,
          orders,
          stock: { ...s.stock, ...stock },
          stockMoves,
          // Closes describe the sales being replaced; they go with them.
          closes: [],
          invoiceSeq,
          activeBranchId: mainBranch.id,
          activeOrderId: null,
          audit: log(
            s.audit,
            'demo.load',
            `Loaded demo data — ${orders.length} orders across ` +
              `${kept.size} branches`,
            'warn',
            mainBranch.id,
          ),
        }));
        return orders.length;
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

          return {
            ...state,
            branches: snapshot.branches ?? state.branches,
            // An empty or missing user list is never restored over a working
            // one — a pre-logins backup would leave nobody able to sign in.
            users: snapshot.users?.length ? snapshot.users : state.users,
            products: snapshot.products,
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

      closeDay: async () => {
        if (get().unclosedSales() === 0) return null;
        const previous = get().closes.at(-1) ?? null;
        const close = await signClose(
          buildClose({ id: uuidv7(), orders: get().orders, previous, now: Date.now(), actor: actorId() }),
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
            `Daily close #${close.no} — ${close.orders} sale${close.orders === 1 ? '' : 's'}, ` +
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
        settings: state.settings,
        invoiceSeq: state.invoiceSeq,
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
          usePos.setState({
            hydrated: true,
            persistError:
              'Could not read saved data. Work in this session may not be saved.',
          });
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
const SAVED = [ROWS.orders, ROWS.stockMoves, ROWS.closes, ROWS.products, ROWS.audit] as const;
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
    const [rows, moves, closes, products, audit] = await Promise.all([
      readRows<Order>(ROWS.orders),
      readRows<StockMove>(ROWS.stockMoves),
      readRows<DailyClose>(ROWS.closes),
      readRows<Product>(ROWS.products),
      readRows<AuditEntry>(ROWS.audit),
    ]);

    const stored: Record<Saved, Row[]> = { orders: rows, stockMoves: moves, closes, products, audit };
    for (const store of SAVED) {
      written[store] = new Map(stored[store].map((row) => [row.id, row] as const));
      // The first save diffs every store against what was just read.
      delete lastSaved[store];
    }

    const loaded = rows.length > 0 ? rows : (rehydrated?.orders ?? []);
    usePos.setState({
      // v7 orders carry no `discount`; they come up to v8 on the way in.
      orders: loaded.map((o) => ('discount' in o ? o : migrateOrderV7(o))),
      stockMoves: moves.length > 0 ? moves : (rehydrated?.stockMoves ?? []),
      closes,
      products: products.length > 0 ? products : (rehydrated?.products ?? []),
      // The log is kept newest first. Rows come back in id order, which is not
      // quite time order, so sort by time and break ties by id.
      audit: audit.length > 0 ? [...audit].sort(newestFirst) : (rehydrated?.audit ?? []),
      hydrated: true,
    });
    void usePos.getState().checkLicense();
  } catch {
    usePos.setState({
      hydrated: true,
      persistError:
        'Could not read saved sales. Work in this session may not be saved.',
    });
  }
}

/**
 * Serving deducts stock. Overselling is recorded as a negative balance and
 * surfaced in Inventory — v6 used Math.max(0, ...) which silently absorbed
 * the discrepancy and made shrinkage untraceable.
 */
type SetState = (fn: (state: PosState) => PosState) => void;

function serveLines(set: SetState, order: Order, lines: OrderLine[]) {
  const now = Date.now();
  const actor = actorId();
  set((state) => {
    const branchStock = { ...(state.stock[order.branchId] ?? {}) };
    const moves: StockMove[] = [];
    const oversold: string[] = [];

    for (const line of lines) {
      const before = branchStock[line.productId] ?? 0;
      const after = before - line.qty;
      branchStock[line.productId] = after;
      if (after < 0) oversold.push(`${line.name} (${after})`);
      moves.push({
        id: uuidv7(),
        branchId: order.branchId,
        productId: line.productId,
        delta: -line.qty,
        reason: 'sale',
        refOrderId: order.id,
        note: null,
        at: now,
        actorUserId: actor,
      });
    }

    const served = new Set(lines.map((l) => l.lineNo));
    let audit = state.audit;
    if (oversold.length > 0) {
      audit = log(
        audit,
        'stock.oversold',
        `Negative stock after ${order.invoiceNo}: ${oversold.join(', ')}`,
        'danger',
        order.branchId,
      );
    }

    return {
      ...state,
      stock: { ...state.stock, [order.branchId]: branchStock },
      stockMoves: [...moves, ...state.stockMoves],
      audit,
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
    };
  });
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
  set((state) => ({
    ...state,
    orders: state.orders.map((o) => (o.id === orderId ? { ...o, discount } : o)),
  }));
  return { ok: true };
}

/** Live bill for an open order, recomputed from current settings. */
export function useBill(orderId: string | null) {
  const order = usePos((s) => (orderId ? s.orders.find((o) => o.id === orderId) : undefined));
  const settings = usePos((s) => s.settings);
  if (!order) return null;

  const served = order.lines.filter((l) => l.served && !l.voided);
  const gross = served.reduce<Centavos>(
    (sum, l) => addC(sum, mulQty(l.unitCents, l.qty)),
    cents(0),
  );
  return computeBill(gross, settings, discountRequest(order.discount));
}

export type { TenderMethod };
export { businessDate };
