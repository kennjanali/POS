'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Bell, Lock, WifiOff, X } from 'lucide-react';

import { heldStock, usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { PRODUCT_NAME } from '@/lib/brand';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { formatQty, type Qty } from '@/lib/qty';

const TITLES: Record<string, string> = {
  '/': 'Point of Sale',
  '/orders': 'Orders',
  '/inventory': 'Inventory',
  '/dashboard': 'Dashboard',
  '/settings': 'Settings',
};

export function Topbar() {
  const pathname = usePathname();
  const [clock, setClock] = useState('');
  const [online, setOnline] = useState(true);

  const branches = usePos((s) => s.branches);
  const activeBranchId = usePos((s) => s.activeBranchId);
  const setActiveBranch = usePos((s) => s.setActiveBranch);
  const persistError = usePos((s) => s.persistError);
  const session = useAuth((s) => s.session);
  const lock = useAuth((s) => s.lock);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString('en-PH', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const title = TITLES[pathname.replace(/\/$/, '') || '/'] ?? PRODUCT_NAME;
  // A closed branch stays out of the switcher; its history is still readable
  // from Orders, but nothing new can be rung up against it.
  const open = branches.filter((b) => b.active);

  return (
    <header className="fixed top-0 right-0 left-[var(--rail-w)] z-100 flex h-[var(--topbar-h)] items-center gap-3 border-b border-line bg-surface px-4 transition-[left] duration-200">
      <h1 className="text-[15px] font-bold tracking-tight">{title}</h1>

      {open.length > 1 && (
        <select
          aria-label="Branch"
          value={activeBranchId}
          onChange={(e) => setActiveBranch(e.target.value)}
          className="h-10 rounded-md border border-line bg-raised px-2.5 text-[13px] font-semibold"
        >
          {open.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex-1" />

      {persistError && (
        <span className="flex items-center gap-1.5 rounded-md bg-bad/15 px-2 py-1 text-[11px] font-semibold text-bad">
          <AlertTriangle size={12} aria-hidden />
          {persistError}
        </span>
      )}

      {!online && (
        <span
          className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-3"
          title="Sales are saved on this device as normal — nothing is sent anywhere. Avoid reloading the page until the connection is back."
        >
          <WifiOff size={13} aria-hidden />
          Offline
        </span>
      )}

      <time className="tnum text-[12px] font-semibold text-ink-2">{clock}</time>

      {can(session, 'inventory.manage') && <LowStockBell />}

      {session && (
        <>
          <span className="ml-1 flex flex-col items-end leading-tight">
            <span className="text-[12px] font-bold">{session.name}</span>
            <span className="text-[10px] tracking-wide text-ink-3 uppercase">
              {ROLE_LABELS[session.role]}
            </span>
          </span>
          {/* Step away without wiping anything — open orders stay on the floor. */}
          <button
            type="button"
            onClick={lock}
            title="Lock the till"
            aria-label="Lock the till"
            className="flex items-center gap-1.5 h-10 rounded-md border border-line bg-raised px-3 text-[11.5px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent"
          >
            <Lock size={13} aria-hidden />
            Lock
          </button>
        </>
      )}
    </header>
  );
}

/** The owner's low-stock alerts: items a sale or a stock change took to their reorder level. */
function LowStockBell() {
  const alerts = usePos((s) => s.lowStockAlerts);
  const products = usePos((s) => s.products);
  const stock = usePos((s) => s.stock);
  const orders = usePos((s) => s.orders);
  const branchId = usePos((s) => s.activeBranchId);
  const dismiss = usePos((s) => s.dismissLowStockAlert);
  const [open, setOpen] = useState(false);

  // An alert for an item since removed from Inventory has nothing to say.
  const shown = alerts.flatMap((id) => {
    const product = products.find((p) => p.id === id);
    return product ? [product] : [];
  });
  const held = heldStock(orders, branchId);
  const left = (id: string) =>
    Math.max(0, (stock[branchId]?.[id] ?? 0) - (held.get(id) ?? 0)) as Qty;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Low stock alerts: ${shown.length}`}
        className="relative grid size-10 place-items-center rounded-md border border-line bg-raised text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        <Bell size={15} aria-hidden />
        {shown.length > 0 && (
          <span className="tnum absolute -top-1 -right-1 grid min-w-4.5 place-items-center rounded-full bg-warn px-1 text-[10px] leading-4.5 font-bold text-white">
            {shown.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-12 right-0 z-200 w-72 rounded-md border border-line bg-surface p-2 shadow-xl">
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-ink-3">No low-stock alerts.</p>
          ) : (
            <ul className="flex flex-col">
              {shown.map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-2 px-2">
                  <span className="text-[12px]">
                    Low stock: {product.name} — {formatQty(left(product.id))} left
                  </span>
                  <button
                    type="button"
                    onClick={() => dismiss(product.id)}
                    aria-label={`Dismiss ${product.name}`}
                    className="grid size-10 shrink-0 place-items-center rounded text-ink-3 hover:bg-raised hover:text-ink"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
