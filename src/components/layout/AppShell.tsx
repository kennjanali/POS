'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BackupBar } from './BackupBar';
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
import { QUICK_LABELS } from '@/lib/seed';
import { ORDER_TYPE_LABELS, type OrderType } from '@/lib/types';
import { cn } from '@/components/ui/cn';

const ORDER_TYPES = Object.keys(ORDER_TYPE_LABELS) as OrderType[];

function NewOrderDialog() {
  const { newOrderOpen, closeNewOrder } = useShell();
  const router = useRouter();
  const openOrder = usePos((s) => s.openOrder);
  const orders = usePos((s) => s.orders);
  const activeBranchId = usePos((s) => s.activeBranchId);
  const takenLabels = orders
    .filter((o) => o.status === 'open' && o.branchId === activeBranchId)
    .map((o) => o.label);

  const [label, setLabel] = useState('');
  const [type, setType] = useState<OrderType>('dine-in');

  function submit(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (takenLabels.includes(trimmed)) {
      toast(`${trimmed} already has an open order`, 'danger');
      return;
    }
    openOrder(trimmed, type);
    setLabel('');
    closeNewOrder();
    router.push('/');
    toast(`Opened ${trimmed}`, 'success');
  }

  return (
    <Modal
      open={newOrderOpen}
      onClose={closeNewOrder}
      title="New order"
      footer={
        <Button fullWidth size="lg" onClick={() => submit(label)} disabled={!label.trim()}>
          Open order
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
            Order type
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {ORDER_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
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

        <div>
          <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
            Quick pick
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {QUICK_LABELS.map((name) => {
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

        <Field
          label="Or name it yourself"
          placeholder="Kuya Ben, Table 12, Delivery #3"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(label);
          }}
        />
      </div>
    </Modal>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const canOpenOrders = useAuth((s) => can(s.session, 'order.open'));

  return (
    <>
      <Sidebar />
      <Topbar />
      <main className="ml-[var(--rail-w)] flex h-screen flex-col pt-[var(--topbar-h)] transition-[margin] duration-200">
        <BackupBar />
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      {canOpenOrders && <NewOrderDialog />}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <AuthGate>
        <Frame>{children}</Frame>
      </AuthGate>
      {/* Outside the gate: the keypad and the first-run screen raise toasts too. */}
      <Toaster />
    </ShellProvider>
  );
}
