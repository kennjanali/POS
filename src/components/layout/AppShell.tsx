'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AutoBackup } from './AutoBackup';
import { Heartbeat } from './Heartbeat';
import { TabletBehaviour } from './TabletBehaviour';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ShellProvider, useShell } from './shell';
import { AuthGate } from '@/components/auth/AuthGate';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Toaster, toast } from '@/components/ui/Toast';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { can } from '@/lib/permissions';
import { PRESETS, ticketWord } from '@/lib/presets';
import { QUICK_LABELS } from '@/lib/seed';
import { ORDER_TYPE_LABELS, type OrderType } from '@/lib/types';
import { cn } from '@/components/ui/cn';

function NewOrderDialog() {
  const { newOrderOpen, closeNewOrder } = useShell();
  const router = useRouter();
  const openOrder = usePos((s) => s.openOrder);
  const orders = usePos((s) => s.orders);
  const activeBranchId = usePos((s) => s.activeBranchId);
  const shopType = usePos((s) => s.settings.shopType);
  const askPlate = usePos((s) => s.settings.features.vehiclePlate);
  const { orderTypes, ticketLabel } = PRESETS[shopType];
  const word = ticketWord(shopType);
  const quickLabels = ticketLabel === 'Table' ? QUICK_LABELS : [];
  const takenLabels = orders
    .filter((o) => o.status === 'open' && o.branchId === activeBranchId)
    .map((o) => o.label);

  const [label, setLabel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [picked, setPicked] = useState<OrderType | null>(null);
  // The shop type can change under an open dialog (hydration, Settings).
  const type = picked !== null && orderTypes.includes(picked) ? picked : orderTypes[0]!;

  const vehiclePlate = askPlate ? plate.trim() : '';
  // With no name typed, the ticket goes by the plate or the customer.
  const fallback = vehiclePlate || customerName.trim();

  function submit(name: string) {
    const trimmed = name.trim() || fallback;
    if (!trimmed) return;
    if (takenLabels.includes(trimmed)) {
      toast(`${trimmed} is already open`, 'danger');
      return;
    }
    openOrder(trimmed, type, { customerName, customerPhone, vehiclePlate });
    setLabel('');
    setCustomerName('');
    setCustomerPhone('');
    setPlate('');
    closeNewOrder();
    router.push('/');
    toast(`Opened ${trimmed}`, 'success');
  }

  return (
    <Modal
      open={newOrderOpen}
      onClose={closeNewOrder}
      title={`New ${word.toLowerCase()}`}
      footer={
        <Button
          fullWidth
          size="lg"
          onClick={() => submit(label)}
          disabled={!label.trim() && !fallback}
        >
          Open {word.toLowerCase()}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
            Order type
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {orderTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPicked(t)}
                aria-pressed={type === t}
                className={cn(
                  'rounded-md border px-2 py-2 text-[12px] font-semibold transition-colors',
                  type === t
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-raised text-ink-2 hover:bg-ground',
                )}
              >
                {ORDER_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {quickLabels.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              Quick pick
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {quickLabels.map((name) => {
                const taken = takenLabels.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={taken}
                    onClick={() => submit(name)}
                    className={cn(
                      'rounded-md border px-2 py-2.5 text-[12px] font-semibold transition-colors',
                      taken
                        ? 'cursor-not-allowed border-line bg-raised text-ink-4 line-through'
                        : 'border-line bg-raised hover:border-accent hover:text-accent',
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Field
          label={quickLabels.length > 0 ? 'Or name it yourself' : `${word} name`}
          placeholder={askPlate ? 'Optional: the plate is used if blank' : 'e.g. Ana, or 12'}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(label);
          }}
        />

        {askPlate && (
          <Field
            label="Plate no. (optional)"
            placeholder="ABC 1234"
            autoCapitalize="characters"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Customer (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <Field
            label="Phone (optional)"
            type="tel"
            inputMode="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const canSell = useAuth((s) => can(s.session, 'sell'));
  // Retail keeps one cart on the sell screen; only ticket shops open orders by name.
  const tickets = usePos((s) => s.settings.features.openOrders);

  return (
    <>
      <Sidebar />
      <Topbar />
      <main className="ml-[var(--rail-w)] flex h-screen flex-col pt-[var(--topbar-h)] transition-[margin] duration-200">
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      {canSell && tickets && <NewOrderDialog />}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <AuthGate>
        <Frame>{children}</Frame>
      </AuthGate>
      {/* Outside the gate: closing time is when the till is locked, and a
          locked till still has to save the day. */}
      <AutoBackup />
      <TabletBehaviour />
      <Heartbeat />
      {/* Outside the gate: the keypad and the first-run screen raise toasts too. */}
      <Toaster />
    </ShellProvider>
  );
}
