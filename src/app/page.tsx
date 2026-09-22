'use client';

import { useState } from 'react';
import { ClipboardList, X } from 'lucide-react';

import { Empty } from '@/components/ui/Empty';
import { Button } from '@/components/ui/Button';
import { Checkout } from '@/components/pos/Checkout';
import { MenuGrid } from '@/components/pos/MenuGrid';
import { OrderCard } from '@/components/pos/OrderCard';
import { OrderPanel } from '@/components/pos/OrderPanel';
import { ReceiptModal } from '@/components/pos/Receipt';
import { useShell } from '@/components/layout/shell';
import { usePos } from '@/store/usePos';

export default function PosPage() {
  const { openNewOrder } = useShell();

  const activeBranchId = usePos((s) => s.activeBranchId);
  const orders = usePos((s) => s.orders);
  const activeOrderId = usePos((s) => s.activeOrderId);
  const setActiveOrder = usePos((s) => s.setActiveOrder);
  const currency = usePos((s) => s.settings.currency);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  const openOrders = orders
    .filter((o) => o.status === 'open' && o.branchId === activeBranchId)
    .sort((a, b) => a.openedAt - b.openedAt);

  const activeOrder = orders.find((o) => o.id === activeOrderId && o.status === 'open');

  return (
    <div className="h-full">
      {/* ── Floor view ─────────────────────────────────────────── */}
      <div className="scroll-y h-full p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-bold tracking-wide text-ink-2 uppercase">
            Open orders · {openOrders.length}
          </h2>
          <Button size="sm" onClick={openNewOrder}>
            New order
          </Button>
        </div>

        {openOrders.length === 0 ? (
          <Empty
            icon={ClipboardList}
            title="No open orders"
            action="Start one to add items and take payment."
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
            {openOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                currency={currency}
                onOpen={() => setActiveOrder(order.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Order workspace ────────────────────────────────────── */}
      {activeOrder && (
        <div
          className="fixed inset-0 z-300 flex bg-black/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setActiveOrder(null);
          }}
        >
          <div className="animate-rise ml-auto flex h-full w-full max-w-5xl bg-surface shadow-2xl">
            <div className="hidden min-w-0 flex-1 md:block">
              <MenuGrid orderId={activeOrder.id} />
            </div>

            <div className="flex w-full min-w-0 flex-col md:w-[380px]">
              <div className="flex justify-end border-b border-line px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setActiveOrder(null)}
                  aria-label="Close order"
                  className="rounded p-1.5 text-ink-3 transition-colors hover:bg-raised hover:text-ink"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <OrderPanel
                  order={activeOrder}
                  onCheckout={() => setCheckoutOpen(true)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeOrder && (
        <Checkout
          order={activeOrder}
          open={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          onPaid={(id) => setReceiptFor(id)}
        />
      )}

      {receiptFor && (
        <ReceiptModal orderId={receiptFor} onClose={() => setReceiptFor(null)} />
      )}
    </div>
  );
}
