import type { PinCredential } from './crypto';
import type { Centavos } from './money';
import type { Features, ShopType } from './presets';
import type { ReceiptPrinter } from './printer';
import type { Qty } from './qty';
import type { TaxProfile } from './tax';

export type OrderStatus = 'open' | 'closed' | 'voided';
export type OrderType = 'dine-in' | 'takeout' | 'delivery' | 'walk-in' | 'pickup';
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
  delivery: 'Delivery',
  'walk-in': 'Walk-in',
  pickup: 'Pickup',
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

/** The units Inventory offers. Items from before v8 may carry another. */
export const UNITS = ['pcs', 'set', 'm', 'kg', 'box', 'hour', 'job', 'serving', 'cup', 'btl'] as const;

/** Stock items are counted on the shelf; services never touch stock. */
export type ProductKind = 'stock' | 'service';

export interface Product {
  id: string;
  name: string;
  kind: ProductKind;
  /** Optional; unique when present. */
  sku: string | null;
  /** '' when the owner has not given one. */
  category: string;
  unit: string;
  priceCents: Centavos;
  costCents: Centavos;
  /** Some agricultural goods are VAT-exempt regardless of the buyer. */
  vatExempt: boolean;
  active: boolean;
  /** Stock items only. Null falls back to `settings.lowStockAt`. */
  reorderLevel: Qty | null;
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
  /** Copied from the product. A service line never moves stock. */
  kind: ProductKind;
  /** Copied from the product, for the slip. '' on lines sold before v8. */
  unit: string;
  qty: Qty;
  served: boolean;
  servedAt: number | null;
  voided: boolean;
  voidReason: string | null;
}

/**
 * A promo code the owner made. `code` and `percent` are frozen once the code
 * has been used on a closed sale (`firstUsedAt`), so the owner deactivates it
 * and creates a new one rather than rewriting history. `startsOn` / `endsOn`
 * are `YYYY-MM-DD` business dates in Asia/Manila, and `endsOn` is inclusive.
 */
export interface Promo {
  id: string;
  code: string;
  percent: number;
  note: string;
  active: boolean;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: number;
  firstUsedAt: number | null;
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
  /** The order number: gapless and sequential per branch, given when the sale
   *  is paid (or cancelled after stock moved). Null while open. Orders opened
   *  by earlier builds were numbered at open and keep that number. Named from the v7
   *  data model. */
  invoiceNo: string | null;
  branchId: string;
  label: string;
  type: OrderType;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  vehiclePlate: string | null;
  /** The quotation this sale was made from. */
  fromQuoteId: string | null;
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
  delta: Qty;
  reason: StockReason;
  refOrderId: string | null;
  note: string | null;
  at: number;
  actorUserId: string | null;
  /** Restocks only: who delivered and their delivery or invoice number. */
  supplier: string | null;
  docNo: string | null;
  /** Restocks only: the unit cost on the delivery, when one was entered. */
  unitCostCents: Centavos | null;
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
  /** The reorder level of any stock item that has none of its own. */
  lowStockAt: Qty;
  /**
   * Once an install goes live it may not be switched back into training mode.
   * Flip this off for a registered deployment and the seed/reset paths lock.
   */
  trainingMode: boolean;
  /** The paired Bluetooth printer (Android app only). Absent until chosen. */
  printer?: ReceiptPrinter | null;
  /** The preset the switches started from. The switches decide behaviour, not this. */
  shopType: ShopType;
  /** Set by the shop type; the owner changes them in Settings → More options. */
  features: Features;
  contactNumber: string;
  /** How many days a quotation stays valid. */
  quoteValidDays: number;
  /** "Finish setting up" checklist items the owner dismissed. */
  checklistDismissed: string[];
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
  /** Absent in backups made before promo codes existed. */
  promos?: Promo[];
  orders: Order[];
  stock: Record<string, Record<string, Qty>>;
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
