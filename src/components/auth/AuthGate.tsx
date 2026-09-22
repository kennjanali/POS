'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { FirstRunSetup } from './FirstRunSetup';
import { LockScreen } from './LockScreen';
import { canVisit, landingFor } from '@/lib/permissions';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';

/**
 * Everything between the browser and the app: hydration, the first-run
 * account, the keypad, and the route guard.
 *
 * The guard is the part that matters. Hiding a nav link only tidies the rail —
 * a waiter who types /dashboard has to land back on the POS, and must not see
 * the page for even one frame on the way.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const posHydrated = usePos((s) => s.hydrated);
  const users = usePos((s) => s.users);

  const authHydrated = useAuth((s) => s.hydrated);
  const session = useAuth((s) => s.session);
  const hydrate = useAuth((s) => s.hydrate);
  const refresh = useAuth((s) => s.refresh);

  useEffect(() => hydrate(), [hydrate]);

  // Deactivated, renamed or demoted while the tab was open.
  useEffect(() => {
    if (!posHydrated || !session) return;
    refresh(users.find((u) => u.id === session.userId));
  }, [posHydrated, session, users, refresh]);

  const allowed = canVisit(session, pathname);

  useEffect(() => {
    if (!session || allowed) return;
    router.replace(landingFor(session));
  }, [session, allowed, router, pathname]);

  if (!posHydrated || !authHydrated) {
    return (
      <div className="grid h-screen place-items-center text-[13px] text-ink-3">
        Loading saved data…
      </div>
    );
  }

  if (users.length === 0) return <FirstRunSetup />;
  if (!session) return <LockScreen />;

  if (!allowed) {
    return (
      <div className="grid h-screen place-items-center text-[13px] text-ink-3">
        Taking you back…
      </div>
    );
  }

  return <>{children}</>;
}
