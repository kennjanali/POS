'use client';

import { useState } from 'react';
import { Ban, Check, Minus, Plus, Receipt, UtensilsCrossed } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { peso } from '@/lib/format';
import { addC, cents, mulQty, type Centavos } from '@/lib/money';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { can } from '@/lib/permissions';
import { ORDER_TYPE_LABELS, type Order } from '@/lib/types';

interface OrderPanelProps {
  order: Order;
  onCheckout: () => void;
}

export function OrderPanel({ order, onCheckout }: OrderPanelProps) {
  const currency = usePos((s) => s.settings.currency);
  const changeQty = usePos((s) => s.changeQty);
  const serveAll = usePos((s) => s.serveAll);
  const voidLine = usePos((s) => s.voidLine);
  // A waiter can put food on the table but cannot take it off the bill.
  const canVoidLine = useAuth((s) => can(s.session, 'line.void'));

  const [voidTarget, setVoidTarget] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const pending = order.lines.filter((l) => !l.served && !l.voided);
  const served = order.lines.filter((l) => l.served && !l.voided);

  const servedTotal = served.reduce<Centavos>(
    (sum, l) => addC(sum, mulQty(l.unitCents, l.qty)),
    cents(0),
  );

  function confirmVoid() {
    const reason = voidReason.trim();
    if (voidTarget === null || !reason) return;
    voidLine(order.id, voidTarget, reason);
    setVoidTarget(null);
    setVoidReason('');
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* Header */}
      <header className="shrink-0 border-b border-line px-4 py-3">
        <p className="text-[16px] leading-tight font-bold">{order.label}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {ORDER_TYPE_LABELS[order.type]} · {order.invoiceNo}
        </p>
      </header>

      {/* Pending */}
      <div className="scroll-y min-h-0 flex-1 px-4 py-3">
        <p className="mb-2 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
          Pending · {pending.length}
        </p>

        {pending.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-3">
            Tap items on the left to add them.
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {pending.map((line) => (
              <li
                key={line.lineNo}
                className="flex items-center gap-2 rounded-md border border-line bg-raised px-2.5 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">
                    {line.name}
                  </span>
                  <span className="tnum block text-[11px] text-ink-3">
                    {peso(line.unitCents, currency)} each
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Reduce ${line.name}`}
                    onClick={() => changeQty(order.id, line.lineNo, -1)}
                    className="grid size-6 place-items-center rounded border border-line bg-surface hover:border-accent"
                  >
                    <Minus size={12} aria-hidden />
                  </button>
                  <span className="tnum w-6 text-center text-[13px] font-bold">
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    aria-label={`Add ${line.name}`}
                    onClick={() => changeQty(order.id, line.lineNo, 1)}
                    className="grid size-6 place-items-center rounded border border-line bg-surface hover:border-accent"
                  >
                    <Plus size={12} aria-hidden />
                  </button>
                </span>

                <span className="tnum w-[72px] shrink-0 text-right text-[13px] font-bold">
                  {peso(mulQty(line.unitCents, line.qty), currency)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Served */}
        <p className="mt-5 mb-2 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
          Served · {served.length}
        </p>

        {served.length === 0 ? (
          <Empty
            icon={UtensilsCrossed}
            title="Nothing served yet"
            action="Serving an item deducts it from stock and locks it into the bill."
          />
        ) : (
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {served.map((line) => (
              <li
                key={line.lineNo}
                className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2"
              >
                <Check size={13} className="shrink-0 text-good" aria-hidden />
                <span className="tnum shrink-0 text-[13px] font-bold">{line.qty}×</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{line.name}</span>
                <span className="tnum shrink-0 text-[13px] font-semibold">
                  {peso(mulQty(line.unitCents, line.qty), currency)}
                </span>
                {canVoidLine && (
                  <button
                    type="button"
                    aria-label={`Void ${line.name}`}
                    onClick={() => setVoidTarget(line.lineNo)}
                    className="shrink-0 rounded p-1 text-ink-3 transition-colors hover:bg-bad/10 hover:text-bad"
                  >
                    <Ban size={13} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <footer className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3">
        <Button
          variant="secondary"
          fullWidth
          disabled={pending.length === 0}
          onClick={() => serveAll(order.id)}
        >
          <Check size={15} aria-hidden />
          Serve {pending.length > 0 ? `${pending.length} item${pending.length > 1 ? 's' : ''}` : 'items'}
        </Button>

        <div className="flex items-center justify-between px-0.5 text-[12px] text-ink-2">
          <span>Served subtotal</span>
          <span className="tnum text-[15px] font-extrabold text-ink">
            {peso(servedTotal, currency)}
          </span>
        </div>

        <Button
          size="lg"
          fullWidth
          variant="success"
          disabled={served.length === 0}
          onClick={onCheckout}
        >
          <Receipt size={16} aria-hidden />
          Take payment
        </Button>
      </footer>

      {/* Void reason — required, never a silent delete */}
      <Modal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        title="Void this item"
        width="sm"
        footer={
          <Button
            fullWidth
            variant="danger"
            disabled={!voidReason.trim()}
            onClick={confirmVoid}
          >
            Void item
          </Button>
        }
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
          The item stays on the record as voided and its stock is returned. A reason is
          required so the void is traceable at audit.
        </p>
        <Field
          label="Reason"
          placeholder="Wrong order, customer cancelled, spoiled"
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
