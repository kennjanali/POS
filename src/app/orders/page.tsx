'use client';

import { useMemo, useState } from 'react';
import { Ban, ClipboardList, Receipt as ReceiptIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { ReceiptModal } from '@/components/pos/Receipt';
import { businessDate, fmtTime, peso } from '@/lib/format';
import { TENDER_LABELS, type OrderStatus } from '@/lib/types';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { can } from '@/lib/permissions';

/**
 * A month of trading is ~3,800 orders. Rendering every match put 38,000 cells
 * on the page and cost over a second of blocked main thread per keystroke in
 * the search box — on a desktop; far worse on till hardware. The filters above
 * are how you reach older sales, and the count below always says what is being
 * held back.
 */
const MAX_ROWS = 200;

const FILTERS: { key: OrderStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'voided', label: 'Voided' },
];

export default function OrdersPage() {
  const orders = usePos((s) => s.orders);
  const branches = usePos((s) => s.branches);
  const users = usePos((s) => s.users);
  const currency = usePos((s) => s.settings.currency);
  const voidOrder = usePos((s) => s.voidOrder);
  // Waiters read this page to check their service went through. Unmaking a
  // sale is a different act and stays with the superadmin.
  const canVoid = useAuth((s) => can(s.session, 'order.void'));

  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [query, setQuery] = useState('');
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((o) => filter === 'all' || o.status === filter)
      .filter((o) => !branchFilter || o.branchId === branchFilter)
      .filter((o) => !date || businessDate(o.openedAt) === date)
      .filter(
        (o) =>
          !q ||
          o.label.toLowerCase().includes(q) ||
          o.invoiceNo.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt));
  }, [orders, filter, branchFilter, date, query]);

  const visible = rows.slice(0, MAX_ROWS);

  /** Orders from before logins existed, and demo data, have no actor. */
  const staffName = (id: string | null) =>
    users.find((u) => u.id === id)?.name ?? '—';

  function confirmVoid() {
    const reason = voidReason.trim();
    if (!voidTarget || !reason) return;
    voidOrder(voidTarget, reason);
    setVoidTarget(null);
    setVoidReason('');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-line bg-surface px-4 py-2.5">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
                filter === f.key
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-raised text-ink-2 hover:bg-ground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* History spans every branch, including closed ones — the sales still
            happened. The filter narrows it; it never hides a branch outright. */}
        {branches.length > 1 && (
          <div className="flex gap-1">
            <button
              type="button"
              aria-pressed={branchFilter === null}
              onClick={() => setBranchFilter(null)}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
                branchFilter === null
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-raised text-ink-2 hover:bg-ground',
              )}
            >
              All branches
            </button>
            {branches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                aria-pressed={branchFilter === branch.id}
                onClick={() =>
                  setBranchFilter(branchFilter === branch.id ? null : branch.id)
                }
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
                  branchFilter === branch.id
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-raised text-ink-2 hover:bg-ground',
                )}
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: branch.color }}
                />
                {branch.name}
              </button>
            ))}
          </div>
        )}

        <input
          type="date"
          aria-label="Business date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 rounded-md border border-line bg-raised px-2 text-[12px]"
        />
        <input
          type="search"
          aria-label="Search orders"
          placeholder="Invoice or label"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 min-w-[160px] flex-1 rounded-md border border-line bg-raised px-2.5 text-[12px]"
        />
        {(date || query || filter !== 'all' || branchFilter) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDate('');
              setQuery('');
              setFilter('all');
              setBranchFilter(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="scroll-y flex-1 p-4">
        {rows.length === 0 ? (
          <Empty
            icon={ClipboardList}
            title="No orders match these filters"
            action="Clear the filters to see the full history."
          />
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-ink-3 uppercase">
                <th className="py-2 pr-3 font-bold">Invoice</th>
                <th className="py-2 pr-3 font-bold">Order</th>
                {branches.length > 1 && (
                  <th className="py-2 pr-3 font-bold">Branch</th>
                )}
                <th className="py-2 pr-3 font-bold">Time</th>
                <th className="py-2 pr-3 font-bold">Served by</th>
                <th className="py-2 pr-3 font-bold">Paid by</th>
                <th className="py-2 pr-3 font-bold">Tender</th>
                <th className="py-2 pr-3 text-right font-bold">Total</th>
                <th className="py-2 font-bold">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => (
                <tr
                  key={order.id}
                  className={cn(
                    'border-b border-line/60',
                    order.status === 'voided' && 'text-ink-3 line-through',
                  )}
                >
                  <td className="py-2 pr-3 font-mono text-[11.5px]">{order.invoiceNo}</td>
                  <td className="py-2 pr-3 font-semibold">{order.label}</td>
                  {branches.length > 1 && (
                    <td className="py-2 pr-3 text-ink-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            background:
                              branches.find((b) => b.id === order.branchId)?.color ??
                              'transparent',
                          }}
                        />
                        {branches.find((b) => b.id === order.branchId)?.name ??
                          order.branchId}
                      </span>
                    </td>
                  )}
                  <td className="py-2 pr-3 text-ink-2">
                    {fmtTime(order.closedAt ?? order.openedAt)}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{staffName(order.servedBy)}</td>
                  <td className="py-2 pr-3 text-ink-2">{staffName(order.paidBy)}</td>
                  <td className="py-2 pr-3 text-ink-2">
                    {order.tenders.map((t) => TENDER_LABELS[t.method]).join(' + ') || '—'}
                  </td>
                  <td className="tnum py-2 pr-3 text-right font-bold">
                    {peso(order.netCents, currency)}
                  </td>
                  <td className="py-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase',
                        order.status === 'closed' && 'bg-good/15 text-good',
                        order.status === 'open' && 'bg-warn/15 text-warn',
                        order.status === 'voided' && 'bg-bad/15 text-bad',
                      )}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {order.status === 'closed' && (
                      <button
                        type="button"
                        aria-label={`Receipt for ${order.invoiceNo}`}
                        onClick={() => setReceiptFor(order.id)}
                        className="rounded p-1 text-ink-3 hover:bg-raised hover:text-ink"
                      >
                        <ReceiptIcon size={14} aria-hidden />
                      </button>
                    )}
                    {canVoid && order.status !== 'voided' && (
                      <button
                        type="button"
                        aria-label={`Void ${order.invoiceNo}`}
                        onClick={() => setVoidTarget(order.id)}
                        className="rounded p-1 text-ink-3 hover:bg-bad/10 hover:text-bad"
                      >
                        <Ban size={14} aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {rows.length > visible.length && (
          <p className="mt-3 rounded-md border border-line bg-surface px-3 py-2.5 text-center text-[12px] text-ink-2">
            Showing the {visible.length} most recent of{' '}
            <strong>{rows.length.toLocaleString('en-PH')}</strong> matching orders. Use
            the date or the search box to reach the rest.
          </p>
        )}
      </div>

      {receiptFor && (
        <ReceiptModal orderId={receiptFor} onClose={() => setReceiptFor(null)} />
      )}

      <Modal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        title="Void this order"
        width="sm"
        footer={
          <Button
            fullWidth
            variant="danger"
            disabled={!voidReason.trim()}
            onClick={confirmVoid}
          >
            Void order
          </Button>
        }
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
          The order is kept and marked voided, its stock is returned, and it drops out of
          sales totals. Orders are never deleted — a missing sale looks the same as a
          hidden one at audit.
        </p>
        <Field
          label="Reason"
          placeholder="Duplicate entry, customer walked out"
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmVoid();
          }}
        />
      </Modal>
    </div>
  );
}
