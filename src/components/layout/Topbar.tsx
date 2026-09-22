'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Lock, WifiOff } from 'lucide-react';

import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { ROLE_LABELS } from '@/lib/permissions';

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
  const trainingMode = usePos((s) => s.settings.trainingMode);
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

  const title = TITLES[pathname.replace(/\/$/, '') || '/'] ?? 'KRAMGEN';
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
          className="h-7 rounded-md border border-line bg-raised px-2 text-[12px] font-semibold"
        >
          {open.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex-1" />

      {trainingMode && (
        <span className="rounded-md bg-warn/15 px-2 py-1 text-[10px] font-bold tracking-wide text-warn uppercase">
          Training mode
        </span>
      )}

      {persistError && (
        <span className="flex items-center gap-1.5 rounded-md bg-bad/15 px-2 py-1 text-[11px] font-semibold text-bad">
          <AlertTriangle size={12} aria-hidden />
          {persistError}
        </span>
      )}

      {!online && (
        <span
          className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-3"
          title="Sales are still recorded. They sync when the connection returns."
        >
          <WifiOff size={13} aria-hidden />
          Offline
        </span>
      )}

      <time className="tnum text-[12px] font-semibold text-ink-2">{clock}</time>

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
            className="flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent"
          >
            <Lock size={13} aria-hidden />
            Lock
          </button>
        </>
      )}
    </header>
  );
}
