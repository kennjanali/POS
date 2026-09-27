'use client';

import { useState } from 'react';
import { Ban, Check, Minus, Plus, Receipt, ShoppingCart, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { peso } from '@/lib/format';
import { addC, cents, type Centavos } from '@/lib/money';
import { ticketWord } from '@/lib/presets';
import { QTY_ONE, formatQty, lineTotal, type Qty } from '@/lib/qty';
import { billedLines, staysOnRecord, usePos, type UserResult } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { can } from '@/lib/permissions';
import { ORDER_TYPE_LABELS, type Order, type OrderLine } from '@/lib/types';

interface OrderPanelProps {
  /** Undefined is a retail cart nobody has tapped anything into yet. */
  order: Order | undefined;
  onCheckout: () => void;
}

export function OrderPanel({ order, onCheckout }: OrderPanelProps) {
  const currency = usePos((s) => s.settings.currency);
  const { serveStep, openOrders } = usePos((s) => s.settings.features);
  const word = usePos((s) => ticketWord(s.settings.shopType));
  const changeQty = usePos((s) => s.changeQty);
  const serveAll = usePos((s) => s.serveAll);
  const voidLine = usePos((s) => s.voidLine);
  const discardOpenOrder = usePos((s) => s.discardOpenOrder);
  // Staff can put an item on the order but cannot take a served one off the bill.
  const canVoidLine = useAuth((s) => can(s.session, 'sale.cancel'));

  const [voidTarget, setVoidTarget] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [discarding, setDiscarding] = useState(false);

  const live = order?.lines.filter((l) => !l.voided) ?? [];
  const pending = live.filter((l) => !l.served);
  const served = live.filter((l) => l.served);

  const billed = order ? billedLines(order, serveStep) : [];
  const billedTotal = billed.reduce<Centavos>(
    (sum, l) => addC(sum, lineTotal(l.unitCents, l.qty)),
    cents(0),
  );
  const discardLabel = openOrders ? `Remove ${word.toLowerCase()}` : 'Clear cart';
  // Once stock moved or a payment was taken, only the owner's cancel (Sales) ends it.
  const canDiscard = order !== undefined && !staysOnRecord(order) && (openOrders || live.length > 0);

  function showRefusal(result: UserResult) {
    if (!result.ok) toast(result.error, 'danger');
  }

  function confirmVoid() {
    const reason = voidReason.trim();
    if (!order || voidTarget === null || !reason) return;
    showRefusal(voidLine(order.id, voidTarget, reason));
    setVoidTarget(null);
    setVoidReason('');
  }

  function confirmDiscard() {
    if (order) showRefusal(discardOpenOrder(order.id));
    setDiscarding(false);
  }

  const emptyHint = (
    <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-3">
      Tap an item to add it.
    </p>
  );

  function editableRow(line: OrderLine) {
    return (
      <li
        key={line.lineNo}
        className="flex items-center gap-2 rounded-md border border-line bg-raised px-2.5 py-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{line.name}</span>
          <span className="tnum block text-[11px] text-ink-3">
            {peso(line.unitCents, currency)} each
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Reduce ${line.name}`}
            onClick={() => order && showRefusal(changeQty(order.id, line.lineNo, -QTY_ONE as Qty))}
            className="grid size-10 place-items-center rounded-md border border-line bg-surface hover:border-accent"
          >
            <Minus size={12} aria-hidden />
          </button>
          <span className="tnum min-w-6 text-center text-[13px] font-bold">
            {formatQty(line.qty)}
          </span>
          <button
            type="button"
            aria-label={`Add ${line.name}`}
            onClick={() => order && showRefusal(changeQty(order.id, line.lineNo, QTY_ONE))}
            className="grid size-10 place-items-center rounded-md border border-line bg-surface hover:border-accent"
          >
            <Plus size={12} aria-hidden />
          </button>
        </span>

        <span className="tnum w-[72px] shrink-0 text-right text-[13px] font-bold">
          {peso(lineTotal(line.unitCents, line.qty), currency)}
        </span>
      </li>
    );
  }

  function servedRow(line: OrderLine) {
    return (
      <li
        key={line.lineNo}
        className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2"
      >
        <Check size={13} className="shrink-0 text-good" aria-hidden />
        <span className="tnum shrink-0 text-[13px] font-bold">{formatQty(line.qty)}×</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{line.name}</span>
        <span className="tnum shrink-0 text-[13px] font-semibold">
          {peso(lineTotal(line.unitCents, line.qty), currency)}
        </span>
        {canVoidLine && (
          <button
            type="button"
            aria-label={`Cancel ${line.name}`}
            onClick={() => setVoidTarget(line.lineNo)}
            className="grid size-10 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-bad/10 hover:text-bad"
          >
            <Ban size={13} aria-hidden />
          </button>
        )}
      </li>
    );
  }

  const details = order
    ? [order.vehiclePlate, order.customerName, order.customerPhone].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* Header */}
      <header className="shrink-0 border-b border-line px-4 py-3">
        {openOrders && order ? (
          <>
            <p className="text-[16px] leading-tight font-bold">{order.label}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {ORDER_TYPE_LABELS[order.type]}
              {order.invoiceNo && ` · ${order.invoiceNo}`}
              {details && ` · ${details}`}
            </p>
          </>
        ) : (
          <p className="text-[16px] leading-tight font-bold">Cart</p>
        )}
      </header>

      <div className="scroll-y min-h-0 flex-1 px-4 py-3">
        {serveStep ? (
          <>
            <p className="mb-2 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
              Pending · {pending.length}
            </p>
            {pending.length === 0 ? (
              emptyHint
            ) : (
              <ul className="flex list-none flex-col gap-1.5 p-0">{pending.map(editableRow)}</ul>
            )}

            <p className="mt-5 mb-2 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
              Served · {served.length}
            </p>
            {served.length === 0 ? (
              <Empty
                icon={ShoppingCart}
                title="Nothing served yet"
                action="Serving an item deducts it from stock and locks it into the bill."
              />
            ) : (
              <ul className="flex list-none flex-col gap-1.5 p-0">{served.map(servedRow)}</ul>
            )}
          </>
        ) : live.length === 0 ? (
          emptyHint
        ) : (
          // Without a serve step a line is served only at payment; a served
          // one here was served while the switch was on.
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {live.map((l) => (l.served ? servedRow(l) : editableRow(l)))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <footer className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3">
        {serveStep && (
          <Button
            variant="secondary"
            fullWidth
            disabled={pending.length === 0}
            onClick={() => order && showRefusal(serveAll(order.id))}
          >
            <Check size={15} aria-hidden />
            Serve {pending.length > 0 ? `${pending.length} item${pending.length > 1 ? 's' : ''}` : 'items'}
          </Button>
        )}

        <div className="flex items-center justify-between px-0.5 text-[12px] text-ink-2">
          <span>{serveStep ? 'Served subtotal' : 'Subtotal'}</span>
          <span className="tnum text-[15px] font-extrabold text-ink">
            {peso(billedTotal, currency)}
          </span>
        </div>

        <Button
          size="lg"
          fullWidth
          variant="success"
          disabled={billed.length === 0}
          onClick={onCheckout}
        >
          <Receipt size={16} aria-hidden />
          Take payment
        </Button>

        {canDiscard && (
          <Button variant="ghost" size="sm" fullWidth onClick={() => setDiscarding(true)}>
            <Trash2 size={13} aria-hidden />
            {discardLabel}
          </Button>
        )}
      </footer>

      <Modal
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={openOrders && order ? `Remove ${order.label}?` : 'Clear the cart?'}
        width="sm"
        footer={
          <Button fullWidth variant="danger" onClick={confirmDiscard}>
            {discardLabel}
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Everything on it comes off. Nothing was paid or taken from stock, so no sale is
          recorded.
        </p>
      </Modal>

      {/* Cancel reason — required, never a silent delete */}
      <Modal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        title="Cancel this item"
        width="sm"
        footer={
          <Button
            fullWidth
            variant="danger"
            disabled={!voidReason.trim()}
            onClick={confirmVoid}
          >
            Cancel item
          </Button>
        }
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
          The item stays on the record as cancelled and its stock is returned. A reason is
          required so it can be traced later.
        </p>
        <Field
          label="Reason"
          placeholder="Wrong item, customer changed their mind"
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
