import type { Qty } from './qty';
import type { Order, StockMove, StockReason, User } from './types';

/** The note on the count that took a negative v7 balance back to zero. */
export const UPGRADE_RESET_NOTE = "Reset at upgrade: stock can't be negative";

const LABELS: Record<StockReason, string> = {
  sale: 'Sale',
  void: 'Cancelled sale',
  restock: 'Add stock',
  spoilage: 'Damage',
  count: 'Count',
  opening: 'Opening',
};

export interface HistoryRow {
  id: string;
  at: number;
  label: string;
  delta: Qty;
  /** The user's name, or "—" when the move has no actor. */
  who: string;
  /** The number of the sale the move belongs to. */
  saleNo: string | null;
  supplier: string | null;
  docNo: string | null;
  note: string | null;
}

/** Every stock move for one product in one branch, newest first, in plain words. */
export function productHistory(
  moves: readonly StockMove[],
  orders: readonly Order[],
  users: readonly User[],
  productId: string,
  branchId: string,
): HistoryRow[] {
  return moves
    .filter((m) => m.productId === productId && m.branchId === branchId)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((m) => ({
      id: m.id,
      at: m.at,
      label:
        m.reason === 'count' && m.note === UPGRADE_RESET_NOTE ? 'Upgrade reset' : LABELS[m.reason],
      delta: m.delta,
      who: users.find((u) => u.id === m.actorUserId)?.name ?? '—',
      saleNo: m.refOrderId ? (orders.find((o) => o.id === m.refOrderId)?.invoiceNo ?? null) : null,
      supplier: m.supplier ?? null,
      docNo: m.docNo ?? null,
      note: m.note,
    }));
}
