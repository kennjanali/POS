'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, X } from 'lucide-react';

import { Empty } from '@/components/ui/Empty';
import { Button } from '@/components/ui/Button';
import { Checkout } from '@/components/pos/Checkout';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { OrderCard } from '@/components/pos/OrderCard';
import { OrderPanel } from '@/components/pos/OrderPanel';
import { ReceiptModal } from '@/components/pos/Receipt';
import { QuoteSlip } from '@/components/quotes/QuoteSlip';
import { useShell } from '@/components/layout/shell';
import { ticketWord } from '@/lib/presets';
import type { Order } from '@/lib/types';
import { usePos } from '@/store/usePos';

/** The branch's open orders, oldest first. */
function openIn(orders: Order[], branchId: string): Order[] {
  return orders
    .filter((o) => o.status === 'open' && o.branchId === branchId)
    .sort((a, b) => a.openedAt - b.openedAt);
}

/**
 * Retail has one cart: the order being worked on, or else the oldest open one
 * (left over from when the shop kept tickets open). None until the first tap.
 */
function currentCart(s: { orders: Order[]; activeBranchId: string; activeOrderId: string | null }) {
  const open = openIn(s.orders, s.activeBranchId);
  return open.find((o) => o.id === s.activeOrderId) ?? open[0];
}

export default function SellPage() {
  const tickets = usePos((s) => s.settings.features.openOrders);
  // A converted quote arrives as /sell?pay=<order>, straight to payment.
  const [checkoutId, setCheckoutId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('pay'),
  );
  useEffect(() => {
    // Once read, the address is tidied so a reload does not reopen payment.
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [quoteFor, setQuoteFor] = useState<string | null>(null);

  // The order the payment screen was opened for, as it is now.
  const paying = usePos((s) => s.orders.find((o) => o.id === checkoutId && o.status === 'open'));

  return (
    <div className="h-full">
      {tickets ? <TicketFloor onCheckout={setCheckoutId} /> : <RetailCart onCheckout={setCheckoutId} />}

      {paying && (
        <Checkout
          order={paying}
          open
          onClose={() => setCheckoutId(null)}
          onPaid={(id) => setReceiptFor(id)}
          onQuoted={setQuoteFor}
        />
      )}

      {receiptFor && (
        <ReceiptModal orderId={receiptFor} onClose={() => setReceiptFor(null)} />
      )}

      {quoteFor && <QuoteSlip quoteId={quoteFor} onClose={() => setQuoteFor(null)} />}
    </div>
  );
}

/** Retail: products on the left, the cart on the right. Pay, and the next cart starts. */
function RetailCart({ onCheckout }: { onCheckout: (orderId: string) => void }) {
  const cart = usePos(currentCart);

  // Read at the tap, not from this render: two quick taps must land on one cart.
  function cartId(): string {
    const s = usePos.getState();
    return currentCart(s)?.id ?? s.openOrder('Walk-in', 'walk-in');
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">
        <ProductGrid getOrderId={cartId} />
      </div>
      <div className="w-[360px] shrink-0">
        <OrderPanel order={cart} onCheckout={() => cart && onCheckout(cart.id)} />
      </div>
    </div>
  );
}

/** Tables, jobs or a queue: open tickets side by side, each opened to add and pay. */
function TicketFloor({ onCheckout }: { onCheckout: (orderId: string) => void }) {
  const { openNewOrder } = useShell();

  const activeBranchId = usePos((s) => s.activeBranchId);
  const orders = usePos((s) => s.orders);
  const activeOrderId = usePos((s) => s.activeOrderId);
  const setActiveOrder = usePos((s) => s.setActiveOrder);
  const currency = usePos((s) => s.settings.currency);
  const word = usePos((s) => ticketWord(s.settings.shopType));

  const openOrders = openIn(orders, activeBranchId);
  const activeOrder = openOrders.find((o) => o.id === activeOrderId);
  const plural = `${word.toLowerCase()}s`;

  return (
    <>
      <div className="scroll-y h-full p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-bold tracking-wide text-ink-2 uppercase">
            Open {plural} · {openOrders.length}
          </h2>
          <Button size="sm" onClick={openNewOrder}>
            New {word.toLowerCase()}
          </Button>
        </div>

        {openOrders.length === 0 ? (
          <Empty
            icon={ClipboardList}
            title={`No open ${plural}`}
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

      {/* ── Ticket workspace ───────────────────────────────────── */}
      {activeOrder && (
        <div
          className="fixed inset-0 z-300 flex bg-black/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setActiveOrder(null);
          }}
        >
          <div className="animate-rise ml-auto flex h-full w-full max-w-5xl bg-surface shadow-2xl">
            <div className="hidden min-w-0 flex-1 md:block">
              <ProductGrid getOrderId={() => activeOrder.id} />
            </div>

            <div className="flex w-full min-w-0 flex-col md:w-[380px]">
              <div className="flex justify-end border-b border-line px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setActiveOrder(null)}
                  aria-label={`Close ${word.toLowerCase()}`}
                  className="grid size-10 place-items-center rounded text-ink-3 transition-colors hover:bg-raised hover:text-ink"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <OrderPanel order={activeOrder} onCheckout={() => onCheckout(activeOrder.id)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
