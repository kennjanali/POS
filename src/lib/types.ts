import type { PinCredential } from './crypto';
import type { Centavos } from './money';
import type { ReceiptPrinter } from './printer';
import type { TaxProfile } from './tax';

export type OrderStatus = 'open' | 'closed' | 'voided';
export type OrderType = 'dine-in' | 'takeout' | 'grab' | 'panda';
export type TenderMethod = 'cash' | 'gcash' | 'maya' | 'card' | 'bank' | 'other';

export const TENDER_METHODS: readonly TenderMethod[] = [
  'cash',
  'gcash',
  'maya',
  'card',
  'bank',
  'other',
] as const;

export const TENDER_LABELS: Record<TenderMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

/** Methods that settle to an account and therefore carry a reference number. */
export const REFERENCED_METHODS: readonly TenderMethod[] = [
  'gcash',
  'maya',
  'card',
  'bank',
] as const;

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  'dine-in': 'Dine-in',
  takeout: 'Takeout',
  grab: 'GrabFood',
  panda: 'FoodPanda',
};

export type Role = 'superadmin' | 'staff';

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Deactivated rather than deleted — the audit trail points at these rows. */
  active: boolean;
  /** Salt, hash and iteration count. The six digits themselves are never stored. */
  pin: PinCredential;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  /** Prefixes this branch's order numbers, so two branches never share one. */
  branchCode: string;
  color: string;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  unit: string;
  priceCents: Centavos;
  costCents: Centavos;
  /** Some agricultural goods are VAT-exempt regardless of the buyer. */
  vatExempt: boolean;
  active: boolean;
}

export interface OrderLine {
  lineNo: number;
  productId: string;
  /** Denormalised so a renamed or deleted product never rewrites history. */
  name: string;
  unitCents: Centavos;
  /** Cost at the moment of sale, frozen for the same reason as `unitCents`.
   *  Optional: lines written before this field existed fall back to the
   *  product's current cost, which is the best the old data can do. */
  costCents?: Centavos;
  qty: number;
  served: boolean;
  servedAt: number | null;
  voided: boolean;
  voidReason: string | null;
}

export interface Tender {
  id: string;
  method: TenderMethod;
  amountCents: Centavos;
  /** Cash only. What the customer handed over. */
  tenderedCents: Centavos | null;
  /** Cash only. Derived, but stored so the receipt is reproducible. */
  changeCents: Centavos | null;
  /** GCash / Maya / card reference, for end-of-day reconciliation. */
  refNo: string | null;
  takenAt: number;
}

/**
 * The one discount on a sale. A promo copies its code and percent so the sale
 * never changes when the promo does; an owner discount is a percent or a fixed
 * amount, with who gave it. `legacy` is a statutory discount from before v8:
 * its frozen totals stand, and it discounts nothing new.
 */
export type SaleDiscount =
  | { kind: 'none' }
  | { kind: 'promo'; promoId: string; code: string; percent: number }
  | { kind: 'owner'; percent: number | null; fixedCents: Centavos | null; by: string | null }
  | { kind: 'legacy' };

export interface Order {
  id: string;
  /** The order number: gapless and sequential per branch. Named from the v7 data model. */
  invoiceNo: string;
  branchId: string;
  label: string;
  type: OrderType;
  status: OrderStatus;
  openedAt: number;
  closedAt: number | null;

  lines: OrderLine[];
  tenders: Tender[];

  discount: SaleDiscount;

  /** Frozen at close so the receipt never re-computes from changed settings. */
  grossCents: Centavos;
  vatableCents: Centavos;
  vatExemptCents: Centavos;
  vatCents: Centavos;
  discountCents: Centavos;
  netCents: Centavos;

  voidedReason: string | null;
  voidedAt: number | null;

  /** Who did what. Null on rows written before logins existed, and on
   *  demo data. */
  openedBy: string | null;
  /** The first user to serve a line on this order. */
  servedBy: string | null;
  /** Whoever closed the sale and took the money. */
  paidBy: string | null;
  voidedBy: string | null;
}

export type StockReason =
  | 'sale'
  | 'void'
  | 'restock'
  | 'spoilage'
  | 'count'
  | 'opening';

export interface StockMove {
  id: string;
  branchId: string;
  productId: string;
  delta: number;
  reason: StockReason;
  refOrderId: string | null;
  note: string | null;
  at: number;
  actorUserId: string | null;
}

export interface AuditEntry {
  id: string;
  at: number;
  branchId: string | null;
  kind: string;
  message: string;
  tone: 'info' | 'success' | 'warn' | 'danger';
  actorUserId: string | null;
}

export interface Settings extends TaxProfile {
  businessName: string;
  address: string;
  currency: string;
  receiptFooter: string;
  showStock: boolean;
  lowStockAt: number;
  /**
   * Once an install goes live it may not be switched back into training mode.
   * Flip this off for a registered deployment and the seed/reset paths lock.
   */
  trainingMode: boolean;
  /** The paired Bluetooth printer (Android app only). Absent until chosen. */
  printer?: ReceiptPrinter | null;
}

/**
 * One end-of-day close. Covers every sale settled since the previous close,
 * so no sale is ever counted twice or missed. Chained by hash to the one
 * before: editing or dropping an old close breaks every hash after it.
 * Never changed once written.
 */
export interface DailyClose {
  id: string;
  /** 1, 2, 3… in order. */
  no: number;
  /** Business date the close was taken on, YYYY-MM-DD. */
  date: string;
  closedAt: number;
  closedBy: string | null;
  /** Sales settled in this window. */
  orders: number;
  grossCents: Centavos;
  discountCents: Centavos;
  /** Sales from earlier closes voided in this window, as a positive amount. */
  voidedEarlierCents: Centavos;
  /** Net of the window: new sales less voids of earlier ones. */
  netCents: Centavos;
  tenders: Record<TenderMethod, Centavos>;
  /** Net across every close so far. */
  runningNetCents: Centavos;
  prevHash: string;
  hash: string;
}

export interface DataSnapshot {
  version: 7 | 8;
  exportedAt: string;
  /** Which install and which build wrote the file. Absent in older backups. */
  installId?: string | null;
  appVersion?: string;
  branches: Branch[];
  users: User[];
  products: Product[];
  orders: Order[];
  stock: Record<string, Record<string, number>>;
  stockMoves: StockMove[];
  audit: AuditEntry[];
  settings: Settings;
  invoiceSeq: Record<string, number>;
  /** Absent in backups made before recovery codes existed. */
  recovery?: PinCredential | null;
  /** Absent in backups made before daily closes existed. */
  closes?: DailyClose[];
  /** The signed license. Absent in older backups. */
  license?: string | null;
}
