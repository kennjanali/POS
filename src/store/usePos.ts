'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { APP_VERSION, LICENSE_SERVER_URL, PRODUCT_NAME } from '@/lib/brand';
import { buildClose, inWindow, signClose } from '@/lib/closes';
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
import { ROWS, kvStorage, onPersistWrite, readRows, writeRows } from '@/lib/storage';
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
import { isLastActiveSuperadmin } from '@/lib/permissions';
import { type Centavos, addC, cents, mulQty } from '@/lib/money';
import { computeBill, type DiscountKind } from '@/lib/tax';
import { DEFAULT_BRANCH, DEFAULT_SETTINGS, OPENING_STOCK, SAMPLE_MENU } from '@/lib/seed';
import { actorId } from './useAuth';
import type {
  AuditEntry,
  Branch,
  DailyClose,
  Order,
  OrderLine,
  OrderType,
  Product,
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

/** What the first-run wizard collects. */
export interface SetupInput {
  business: Pick<
    Settings,
    'businessName' | 'address' | 'vatRegistered' | 'pricesIncludeVat'
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
  voidLine: (orderId: string, lineNo: number, reason: string) => void;
  serveAll: (orderId: string) => void;
  serveLine: (orderId: string, lineNo: number) => void;

  setDiscount: (
    orderId: string,
    patch: Partial<
      Pick<
        Order,
        | 'discountKind'
        | 'customPercent'
        | 'diners'
        | 'eligibleDiners'
        | 'discountIdNo'
        | 'discountIdName'
      >
    >,
  ) => void;

  addTender: (
    orderId: string,
    tender: Omit<Tender, 'id' | 'takenAt'>,
  ) => void;
  removeTender: (orderId: string, tenderId: string) => void;
  closeOrder: (orderId: string) => boolean;
  voidOrder: (orderId: string, reason: string) => void;

  // ── inventory ───────────────────────────────────────────────────────
  adjustStock: (
    productId: string,
    delta: number,
    reason: StockReason,
    note?: string,
    branchId?: string,
  ) => void;
  upsertProduct: (product: Product) => void;
  removeProduct: (productId: string) => void;

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

  // ── license ─────────────────────────────────────────────────────────
  /** Verify the stored license for this install and tablet. Offline. */
  checkLicense: () => Promise<void>;
  /** Exchange a license key for a signed license. Needs internet once. */
  activate: (key: string) => Promise<UserResult>;

  // ── admin ───────────────────────────────────────────────────────────
  setActiveBranch: (id: string) => void;
  upsertBranch: (branch: Branch) => void;
  updateSettings: (patch: Partial<Settings>) => void;
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
  /** Sales settled or voided since the last close — what the next close would cover. */
  unclosedSales: () => number;
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

const SNAPSHOT_VERSION = 7;

/**
 * Why a restore was refused, or null if the file is usable. Restoring replaces
 * every order on the device, so a half-readable file has to be rejected before
 * it lands rather than diagnosed afterwards.
 */
function describeBadSnapshot(snapshot: DataSnapshot): string | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return `That file is not a ${PRODUCT_NAME} backup.`;
  }
  if (snapshot.version !== SNAPSHOT_VERSION) {
    return (
      `That backup is version ${snapshot.version ?? 'unknown'}; this app reads ` +
      `version ${SNAPSHOT_VERSION}. Convert it first — see scripts/migrate-v6.mjs.`
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

      voidLine: (orderId, lineNo, reason) =>
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
        }),

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

      setDiscount: (orderId, patch) =>
        set((state) => ({
          ...state,
          orders: state.orders.map((o) =>
            o.id === orderId && o.status === 'open' ? { ...o, ...patch } : o,
          ),
        })),

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
        const bill = computeBill(gross, state.settings, {
          kind: order.discountKind,
          customPercent: order.customPercent,
          diners: order.diners,
          eligibleDiners: order.eligibleDiners,
        });

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
                  vatExemptCents: bill.vatExemptSale,
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
      voidOrder: (orderId, reason) =>
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
        }),

      // ── inventory ─────────────────────────────────────────────────
      adjustStock: (productId, delta, reason, note, branchId) =>
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
        }),

      upsertProduct: (product) =>
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
        }),

      /** Soft delete — history references these rows. */
      removeProduct: (productId) =>
        set((state) => ({
          ...state,
          products: state.products.map((p) =>
            p.id === productId ? { ...p, active: false } : p,
          ),
        })),

      // ── users ─────────────────────────────────────────────────────
      addUser: async ({ name, role, pin }) => {
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
      },

      setUserRole: (id, role) => {
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

        const [pin, recovery] = await Promise.all([
          hashPin(input.pin),
          hashRecoveryCode(input.recoveryCode),
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
        const result = await get().setUserPin(userId, pin);
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
        const recovery = await hashRecoveryCode(code);
        set((s) => ({
          ...s,
          recovery,
          audit: log(
            s.audit,
            'recovery.replace',
            'Issued a new recovery code — the old one no longer works',
            'warn',
            s.activeBranchId,
          ),
        }));
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

      updateSettings: (patch) =>
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

          if (state.settings.trainingMode && !settings.trainingMode) {
            return {
              ...state,
              settings,
              audit: log(
                state.audit,
                'settings.golive',
                'Training mode turned off — this install is now live and ' +
                  'cannot be put back into training mode',
                'warn',
                state.activeBranchId,
              ),
            };
          }
          return { ...state, settings };
        }),

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
          version: 7,
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

      importSnapshot: (snapshot) => {
        // A restore replaces the books wholesale, so the file has to earn it.
        // Checking only that `products` was an array let a truncated or
        // hand-edited export through, and it reported success either way.
        const problem = describeBadSnapshot(snapshot);
        if (problem) return { ok: false, error: problem };

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

      unclosedSales: () => {
        const { orders, closes } = get();
        const since = closes.at(-1)?.closedAt ?? 0;
        const now = Date.now() + 1;
        return orders.filter(
          (o) =>
            (o.status === 'closed' && inWindow(o.closedAt, since, now)) ||
            (o.status === 'voided' && inWindow(o.voidedAt, since, now) && (o.closedAt ?? Infinity) < since),
        ).length;
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
      // The one place stored data changes shape. Bump `version` only together
      // with a step in `migrate`: without one, zustand discards stored state
      // whose version differs — an empty till after an app update.
      version: 7,
      migrate: (persisted) => persisted as PosState,
      storage: createJSONStorage(() => kvStorage),
      // `orders` and `stockMoves` are deliberately absent: they go to their own
      // row stores, written one record at a time. Everything listed here is
      // small and rarely touched, so rewriting it wholesale is free.
      // See the note on ROWS in lib/storage.ts.
      partialize: (state) => ({
        branches: state.branches,
        users: state.users,
        products: state.products,
        stock: state.stock,
        audit: state.audit,
        settings: state.settings,
        invoiceSeq: state.invoiceSeq,
        recovery: state.recovery,
        installId: state.installId,
        license: state.license,
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

// ── Sales persistence ────────────────────────────────────────────────────
// Orders and stock moves live in their own row stores rather than the blob.
// They stay in memory for reading — every screen that filters or sums them is
// untouched — but only the rows that actually changed are written.

/** What each row store already holds, so a change can be spotted by identity. */
const writtenOrders = new Map<string, Order>();
const writtenMoves = new Map<string, StockMove>();
const writtenCloses = new Map<string, DailyClose>();

/**
 * Rows whose object identity changed since the last write. Every mutation in
 * this store rebuilds changed rows with a spread and leaves the rest alone, so
 * a reference comparison is an exact and very cheap change detector — no
 * serialising, no deep equality.
 */
function diffRows<T extends { id: string }>(
  current: T[],
  written: Map<string, T>,
): { changed: T[]; removed: string[] } {
  const changed: T[] = [];
  const seen = new Set<string>();

  for (const row of current) {
    seen.add(row.id);
    if (written.get(row.id) !== row) changed.push(row);
  }

  // Removals only happen when a month is archived away, so the extra pass is
  // skipped entirely in the common case.
  const removed: string[] =
    written.size === seen.size
      ? []
      : [...written.keys()].filter((id) => !seen.has(id));

  for (const row of changed) written.set(row.id, row);
  for (const id of removed) written.delete(id);
  return { changed, removed };
}

let lastOrders: Order[] | null = null;
let lastMoves: StockMove[] | null = null;
let lastCloses: DailyClose[] | null = null;

usePos.subscribe((state) => {
  if (!state.hydrated) return;

  if (state.orders !== lastOrders) {
    lastOrders = state.orders;
    const { changed, removed } = diffRows(state.orders, writtenOrders);
    void writeRows(ROWS.orders, changed, removed);
  }
  if (state.stockMoves !== lastMoves) {
    lastMoves = state.stockMoves;
    const { changed, removed } = diffRows(state.stockMoves, writtenMoves);
    void writeRows(ROWS.stockMoves, changed, removed);
  }
  if (state.closes !== lastCloses) {
    lastCloses = state.closes;
    const { changed, removed } = diffRows(state.closes, writtenCloses);
    void writeRows(ROWS.closes, changed, removed);
  }
});

/**
 * Read the sales back and open the till. Installs written before the row
 * stores existed carry their sales inside the rehydrated blob instead; those
 * are adopted here and written across on the way through, so the upgrade
 * costs the owner nothing and loses nothing.
 */
async function loadRows(rehydrated: PosState | undefined): Promise<void> {
  try {
    const [rows, moves, closes] = await Promise.all([
      readRows<Order>(ROWS.orders),
      readRows<StockMove>(ROWS.stockMoves),
      readRows<DailyClose>(ROWS.closes),
    ]);

    const legacy = rehydrated as unknown as
      | { orders?: Order[]; stockMoves?: StockMove[] }
      | undefined;
    const orders = rows.length > 0 ? rows : (legacy?.orders ?? []);
    const stockMoves = moves.length > 0 ? moves : (legacy?.stockMoves ?? []);

    for (const order of orders) writtenOrders.set(order.id, order);
    for (const move of stockMoves) writtenMoves.set(move.id, move);
    lastOrders = orders;
    lastMoves = stockMoves;
    for (const close of closes) writtenCloses.set(close.id, close);
    lastCloses = closes;

    usePos.setState({ orders, stockMoves, closes, hydrated: true });
    void usePos.getState().checkLicense();

    // Migrating from the blob: put the rows where they now belong.
    if (rows.length === 0 && orders.length > 0) {
      void writeRows(ROWS.orders, orders, []);
    }
    if (moves.length === 0 && stockMoves.length > 0) {
      void writeRows(ROWS.stockMoves, stockMoves, []);
    }
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
  return computeBill(gross, settings, {
    kind: order.discountKind,
    customPercent: order.customPercent,
    diners: order.diners,
    eligibleDiners: order.eligibleDiners,
  });
}

export type { DiscountKind, TenderMethod };
export { businessDate };
