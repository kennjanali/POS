'use client';

import { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';

import { PinPad } from './PinPad';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { DEFAULT_PIN } from '@/lib/seed';

/**
 * The keypad. No usernames, no password field, no list of who works here —
 * a wrong PIN says "Incorrect PIN" and nothing else. Whether those six digits
 * belong to somebody is not information this screen gives away.
 */
export function LockScreen() {
  const users = usePos((s) => s.users);
  const recordLogin = usePos((s) => s.recordLogin);
  const businessName = usePos((s) => s.settings.businessName);
  // Only while nobody has set a real PIN yet.
  const untouched = usePos((s) => s.defaultPinAccounts().length > 0);

  const signIn = useAuth((s) => s.signIn);
  const lockedUntil = useAuth((s) => s.lockedUntil);

  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const secondsLeft = lockedUntil ? Math.ceil((lockedUntil - now) / 1000) : 0;
  const locked = secondsLeft > 0;

  useEffect(() => {
    if (!lockedUntil || lockedUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  async function attempt(pin: string): Promise<boolean> {
    setError(null);
    const result = await signIn(pin, users);
    if (result.ok) {
      recordLogin(result.user.id);
      return true;
    }
    // A lockout speaks through the countdown below, not through the error line.
    setNow(Date.now());
    if (result.reason === 'invalid') setError('Incorrect PIN.');
    return false;
  }

  return (
    <div className="fixed inset-0 z-500 grid place-items-center bg-rail p-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        <span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent">
          <ShoppingCart size={20} className="text-white" aria-hidden />
        </span>
        <p className="text-[22px] leading-none font-extrabold tracking-tight text-white">
          KRAM<span className="text-accent">GEN</span>
        </p>
        <p className="mt-1.5 text-[11px] tracking-[2px] text-ink-3 uppercase">
          {businessName}
        </p>

        <div className="mt-7 flex w-full flex-col items-center rounded-xl bg-surface px-6 py-7">
          <h1 className="mb-5 text-[13px] font-bold tracking-wide text-ink-2 uppercase">
            Enter your PIN
          </h1>
          <PinPad
            onSubmit={attempt}
            disabled={locked}
            tone={error || locked ? 'bad' : 'muted'}
            message={
              locked ? `Too many attempts. Try again in ${secondsLeft}s.` : (error ?? ' ')
            }
          />

          {/* A brand-new till has no one to ask for the PIN, so it says so.
              Disappears for good the moment a real PIN is set. */}
          {untouched && (
            <p className="mt-4 rounded-md border border-line bg-raised px-3 py-2 text-center text-[11.5px] leading-relaxed text-ink-2">
              First time on this device? Sign in with{' '}
              <strong className="tnum text-ink">{DEFAULT_PIN}</strong>, then change
              it in Settings → Users.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
