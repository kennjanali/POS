'use client';

import { useState } from 'react';
import { ShieldCheck, ShoppingCart } from 'lucide-react';

import { PinPad } from './PinPad';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { PIN_LENGTH } from '@/lib/crypto';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';

/**
 * A fresh install has no users and ships no default PIN, so the first thing it
 * asks for is the owner's own account. The PIN is confirmed once: mistype it
 * here and the only way back in is clearing the browser's stored data.
 */
export function FirstRunSetup() {
  const addUser = usePos((s) => s.addUser);
  const recordLogin = usePos((s) => s.recordLogin);
  const signIn = useAuth((s) => s.signIn);

  const [name, setName] = useState('');
  const [step, setStep] = useState<'name' | 'pin' | 'confirm'>('name');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);

  function restartPin(message: string) {
    setError(message);
    setFirst('');
    setStep('pin');
  }

  async function takePin(pin: string): Promise<boolean> {
    setError(null);
    if (step === 'pin') {
      setFirst(pin);
      setStep('confirm');
      return true;
    }

    if (pin !== first) {
      restartPin('Those two did not match. Start the PIN again.');
      return false;
    }

    const result = await addUser({ name, role: 'superadmin', pin });
    if (!result.ok) {
      restartPin(result.error);
      return false;
    }

    // Sign the owner straight in rather than handing them back the keypad they
    // just used. Read the users list after the write, not from this render.
    const signedIn = await signIn(pin, usePos.getState().users);
    if (signedIn.ok) recordLogin(signedIn.user.id);
    toast(`Welcome, ${name.trim()}`, 'success');
    return true;
  }

  return (
    <div className="fixed inset-0 z-500 grid place-items-center overflow-y-auto bg-rail p-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        <span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent">
          <ShoppingCart size={20} className="text-white" aria-hidden />
        </span>
        <p className="text-[22px] leading-none font-extrabold tracking-tight text-white">
          KRAM<span className="text-accent">GEN</span>
        </p>
        <p className="mt-1.5 text-[11px] tracking-[2px] text-ink-3 uppercase">First run</p>

        <div className="mt-7 w-full rounded-xl bg-surface px-6 py-7">
          {step === 'name' ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2.5">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  This account is the <strong>superadmin</strong> — everything, including
                  who else gets in. Waiters and purchasers are added afterwards in
                  Settings.
                </p>
              </div>
              <Field
                label="Your name"
                placeholder="Kram"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) setStep('pin');
                }}
              />
              <Button
                fullWidth
                size="lg"
                disabled={!name.trim()}
                onClick={() => setStep('pin')}
              >
                Choose a PIN
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <h1 className="mb-1 text-[13px] font-bold tracking-wide text-ink-2 uppercase">
                {step === 'pin' ? `Choose a ${PIN_LENGTH}-digit PIN` : 'Enter it again'}
              </h1>
              <p className="mb-5 max-w-[240px] text-center text-[11.5px] leading-relaxed text-ink-3">
                {step === 'pin'
                  ? 'This is how you sign in. There is no password, and no way to recover it.'
                  : `Confirming the PIN for ${name.trim()}.`}
              </p>
              <PinPad onSubmit={takePin} message={error ?? ' '} tone={error ? 'bad' : 'muted'} />
              <button
                type="button"
                onClick={() => {
                  setStep('name');
                  setFirst('');
                  setError(null);
                }}
                className="mt-5 text-[12px] font-semibold text-ink-3 hover:text-accent"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
