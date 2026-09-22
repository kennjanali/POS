import type { PinCredential } from './crypto';
import type { Centavos } from './money';
import type { DiscountKind, TaxProfile } from './tax';

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

export type Role = 'superadmin' | 'waiter' | 'purchaser';

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
  /** BIR branch code, printed on the invoice header. */
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

export interface Order {
  id: string;
  /** Gapless per-branch sequential number. BIR requires this. */
  invoiceNo: string;
  branchId: string;
  label: string;
  type: OrderType;
  status: OrderStatus;
  openedAt: number;
  closedAt: number | null;

  lines: OrderLine[];
  tenders: Tender[];

  discountKind: DiscountKind;
  customPercent: number;
  diners: number;
  eligibleDiners: number;
  /** SC/PWD ID number. RA 9994 requires this on record. */
  discountIdNo: string | null;
  discountIdName: string | null;

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
  tin: string;
  currency: string;
  receiptFooter: string;
  showStock: boolean;
  lowStockAt: number;
  /**
   * Once a POS is BIR-registered it may not be switched into training mode.
   * Flip this off for a registered deployment and the seed/reset paths lock.
   */
  trainingMode: boolean;
}

export interface DataSnapshot {
  version: 7;
  exportedAt: string;
  branches: Branch[];
  users: User[];
  products: Product[];
  orders: Order[];
  stock: Record<string, Record<string, number>>;
  stockMoves: StockMove[];
  audit: AuditEntry[];
  settings: Settings;
  invoiceSeq: Record<string, number>;
}
