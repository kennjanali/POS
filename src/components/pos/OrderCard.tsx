'use client';

import { useEffect, useState } from 'react';

import { elapsed } from '@/lib/format';
import { peso } from '@/lib/format';
import { addC, cents, mulQty, type Centavos } from '@/lib/money';
import { ORDER_TYPE_LABELS, type Order } from '@/lib/types';
import { cn } from '@/components/ui/cn';

interface OrderCardProps {
  order: Order;
  currency: string;
  onOpen: () => void;
}

export function OrderCard({ order, currency, onOpen }: OrderCardProps) {
  const [, setTick] = useState(0);

  // The elapsed timer is the one thing on this screen that must stay live.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const live = order.lines.filter((l) => !l.voided);
  const pending = live.filter((l) => !l.served);
  const served = live.filter((l) => l.served);

  const runningTotal = served.reduce<Centavos>(
    (sum, l) => addC(sum, mulQty(l.unitCents, l.qty)),
    cents(0),
  );

  const waiting = pending.length > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border bg-surface p-3 text-left',
        'transition-[border-color,box-shadow] hover:border-accent hover:shadow-md',
        waiting ? 'border-warn/50' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{order.label}</span>
          <span className="mt-0.5 block text-[10.5px] tracking-wide text-ink-3 uppercase">
            {ORDER_TYPE_LABELS[order.type]} · {order.invoiceNo}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide uppercase',
            waiting ? 'bg-warn/15 text-warn' : 'bg-cool/15 text-cool',
          )}
        >
          {waiting ? `${pending.length} pending` : 'Served'}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="tnum text-[18px] leading-none font-extrabold">
          {peso(runningTotal, currency)}
        </span>
        <span className="text-[11px] text-ink-3">{elapsed(order.openedAt)}</span>
      </div>
    </button>
  );
}
