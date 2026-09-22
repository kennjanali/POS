'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { buildDemoData } from '@/lib/demo';
import { hashPin, isValidPin, verifyPin, PIN_LENGTH } from '@/lib/crypto';
import { idbStorage, onPersistWrite } from '@/lib/idb';
import { uuidv7 } from '@/lib/id';
import { businessDate } from '@/lib/format';
import { isLastActiveSuperadmin } from '@/lib/permissions';
import { type Centavos, addC, cents, mulQty } from '@/lib/money';
import { computeBill, type DiscountKind } from '@/lib/tax';
import {
  DEFAULT_BRANCH,
  DEFAULT_PRODUCTS,
  DEFAULT_SETTINGS,
  OPENING_STOCK,
} from '@/lib/seed';
import { actorId } from './useAuth';
import type {
  AuditEntry,
  Branch,
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
  audit: AuditEntry[];
  settings: Settings;
  /** branchId -> last issued invoice number */
  invoiceSeq: Record<string, number>;

  activeBranchId: string;
  activeOrderId: string | null;
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

  // ── admin ───────────────────────────────────────────────────────────
  setActiveBranch: (id: string) => void;
  upsertBranch: (branch: Branch) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  /**
   * Replace sales history with a generated demo month. Training mode only —
   * returns the number of orders written, or 0 if the install is locked.
   */
  loadDemoData: (options?: { days?: number; ordersPerDay?: number }) => number;
  exportSnapshot: () => DataSnapshot;
  importSnapshot: (snapshot: DataSnapshot) => void;
  resetAll: () => void;
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
  // O(n) unshift — this is audit-trail data and gets synced to the server.
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

export function tenderedTotal(order: Order): Centavos {
  return order.tenders.reduce<Centavos>(
    (sum, t) => addC(sum, t.amountCents),
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

function initialStock(products: Product[]): Record<string, number> {
  return Object.fromEntries(products.map((p) => [p.id, OPENING_STOCK]));
}

export const usePos = create<PosState>()(
  persist(
    (set, get) => ({
      branches: [DEFAULT_BRANCH],
      // No default user and no default PIN. A fresh install prompts for the
      // first superadmin before anything else loads.
      users: [],
      products: DEFAULT_PRODUCTS,
      orders: [],
      stock: { [DEFAULT_BRANCH.id]: initialStock(DEFAULT_PRODUCTS) },
      stockMoves: [],
      audit: [],
      settings: DEFAULT_SETTINGS,
      invoiceSeq: {},
      activeBranchId: DEFAULT_BRANCH.id,
      activeOrderId: null,
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

        const paid = order.tenders.reduce<number>((s, t) => s + t.amountCents, 0);
        if (paid < bill.amountDue) return false;

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
        set((state) => ({ ...state, settings: { ...state.settings, ...patch } })),

      loadDemoData: (options) => {
        const state = get();
        // Same lock as trainingMode itself: a BIR-registered install must not
        // be able to write fabricated sales over its books.
        if (!state.settings.trainingMode) return 0;

        const mainBranch = state.branches[0] ?? DEFAULT_BRANCH;
        const demo = buildDemoData({
          products: state.products,
          settings: state.settings,
          mainBranch,
          days: options?.days,
          ordersPerDay: options?.ordersPerDay,
        });

        // Branches the owner made themselves are left alone; the demo ones are
        // added beside them. Stock is merged for the same reason.
        const byId = new Map(state.branches.map((b) => [b.id, b]));
        for (const branch of demo.branches) {
          if (!byId.has(branch.id)) byId.set(branch.id, branch);
        }

        set((s) => ({
          ...s,
          branches: [...byId.values()],
          orders: demo.orders,
          stock: { ...s.stock, ...demo.stock },
          stockMoves: demo.stockMoves,
          invoiceSeq: demo.invoiceSeq,
          activeBranchId: mainBranch.id,
          activeOrderId: null,
          audit: log(
            s.audit,
            'demo.load',
            `Loaded demo data — ${demo.orders.length} orders across ` +
              `${demo.branches.length} branches`,
            'warn',
            mainBranch.id,
          ),
        }));
        return demo.orders.length;
      },

      exportSnapshot: () => {
        const s = get();
        return {
          version: 7,
          exportedAt: new Date().toISOString(),
          branches: s.branches,
          users: s.users,
          products: s.products,
          orders: s.orders,
          stock: s.stock,
          stockMoves: s.stockMoves,
          audit: s.audit,
          settings: s.settings,
          invoiceSeq: s.invoiceSeq,
        };
      },

      importSnapshot: (snapshot) =>
        set((state) => ({
          ...state,
          branches: snapshot.branches ?? state.branches,
          // An empty or missing user list is never restored over a working
          // one — a pre-logins backup would leave nobody able to sign in.
          users: snapshot.users?.length ? snapshot.users : state.users,
          products: snapshot.products ?? state.products,
          orders: snapshot.orders ?? [],
          stock: snapshot.stock ?? {},
          stockMoves: snapshot.stockMoves ?? [],
          audit: snapshot.audit ?? [],
          settings: { ...state.settings, ...snapshot.settings },
          invoiceSeq: snapshot.invoiceSeq ?? {},
          activeOrderId: null,
        })),

      resetAll: () =>
        set((state) => ({
          ...state,
          orders: [],
          stockMoves: [],
          audit: [],
          invoiceSeq: {},
          activeOrderId: null,
          products: DEFAULT_PRODUCTS,
          stock: { [state.activeBranchId]: initialStock(DEFAULT_PRODUCTS) },
        })),

      clearPersistError: () => set({ persistError: null }),
    }),
    {
      name: 'kramgen-pos-v7',
      version: 7,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        branches: state.branches,
        users: state.users,
        products: state.products,
        orders: state.orders,
        stock: state.stock,
        stockMoves: state.stockMoves,
        audit: state.audit,
        settings: state.settings,
        invoiceSeq: state.invoiceSeq,
        activeBranchId: state.activeBranchId,
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
        usePos.setState({ hydrated: true });
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
