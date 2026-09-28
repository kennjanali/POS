'use client';

import { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';

import { PinPad } from './PinPad';
import { RecoverPin } from './RecoverPin';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';

/**
 * The keypad. No usernames, no password field, no list of who works here —
 * a wrong PIN says "Incorrect PIN" and nothing else. Whether those six digits
 * belong to somebody is not information this screen gives away.
 */
export function LockScreen() {
  const users = usePos((s) => s.users);
  const recordLogin = usePos((s) => s.recordLogin);
  const businessName = usePos((s) => s.settings.businessName);
  const [recovering, setRecovering] = useState(false);

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
    // Scrolls rather than centering in a fixed box: with the keyboard open
    // for the recovery code, the card can be taller than what is left.
    <div className="fixed inset-0 z-500 overflow-y-auto bg-rail">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center p-6">
        <span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent">
          <ShoppingCart size={20} className="text-white" aria-hidden />
        </span>
        <p className="text-[22px] leading-none font-extrabold tracking-tight text-white">
          POS<span className="text-accent">-034</span>
        </p>
        <p className="mt-1.5 text-[11px] tracking-[2px] text-ink-3 uppercase">
          {businessName}
        </p>

        <div className="mt-7 flex w-full flex-col items-center rounded-xl bg-surface px-6 py-7">
          {recovering ? (
            <RecoverPin onDone={() => setRecovering(false)} />
          ) : (
            <>
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
              <button
                type="button"
                onClick={() => setRecovering(true)}
                className="mt-3 min-h-10 px-3 text-[12px] font-semibold text-ink-3 hover:text-accent"
              >
                Forgot PIN?
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
