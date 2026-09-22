'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';

import { useAuth } from '@/store/useAuth';
import { usePos } from '@/store/usePos';
import { can } from '@/lib/permissions';
import { DEFAULT_PIN, hasDefaultPin } from '@/lib/seed';

/**
 * Every install ships signed-in-able: one superadmin with PIN 000000, so a
 * till can never lock its owner out for good. That is also an open door on a
 * device handling cash, so it is stated plainly on every screen until the PIN
 * is changed — and it only clears when the credential genuinely changes, not
 * when someone dismisses it.
 */
export function DefaultPinBar() {
  // Selecting `users` (a stable reference) and deriving here, rather than
  // calling a store method that builds a fresh array each time — zustand
  // compares the selector's result by identity, so that is an endless
  // re-render.
  const users = usePos((s) => s.users);
  const accounts = useMemo(
    () => users.filter((u) => u.active && hasDefaultPin(u)),
    [users],
  );
  const canManage = useAuth((s) => can(s.session, 'users.manage'));

  if (accounts.length === 0) return null;

  const names = accounts.map((u) => u.name).join(', ');

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-bad/40 bg-bad/10 px-4 py-2">
      <KeyRound size={15} className="shrink-0 text-bad" aria-hidden />
      <p className="min-w-0 flex-1 text-[12px] leading-snug">
        <strong>
          {names} can still be opened with the default PIN {DEFAULT_PIN}.
        </strong>{' '}
        <span className="text-ink-2">
          Anyone who picks up this device can void sales and change settings
          until you set a real one.
        </span>
      </p>
      {canManage && (
        <Link
          href="/settings"
          className="shrink-0 rounded-md bg-bad px-2.5 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90"
        >
          Change it now
        </Link>
      )}
    </div>
  );
}
