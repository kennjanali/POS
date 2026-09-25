'use client';

import { useMemo, useState } from 'react';

import { PinPad } from './PinPad';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { PIN_LENGTH } from '@/lib/crypto';
import { usePos } from '@/store/usePos';

type Step = 'code' | 'who' | 'pin' | 'confirm';

/**
 * Forgot-PIN path. The recovery code from setup sets a new PIN for a
 * superadmin. Who the superadmins are is only shown once the code is right.
 */
export function RecoverPin({ onDone }: { onDone: () => void }) {
  const users = usePos((s) => s.users);
  const codeMatches = usePos((s) => s.recoveryCodeMatches);
  const resetPin = usePos((s) => s.resetPinWithRecoveryCode);
  const admins = useMemo(
    () => users.filter((u) => u.active && u.role === 'superadmin'),
    [users],
  );

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkCode() {
    setChecking(true);
    setError(null);
    const ok = await codeMatches(code);
    setChecking(false);
    if (!ok) {
      setError('That recovery code is not right.');
      return;
    }
    if (admins.length === 1 && admins[0]) {
      setUserId(admins[0].id);
      setStep('pin');
    } else {
      setStep('who');
    }
  }

  async function takePin(entered: string): Promise<boolean> {
    setError(null);
    if (step === 'pin') {
      setPin(entered);
      setStep('confirm');
      return true;
    }
    const retry = (message: string) => {
      setError(message);
      setPin('');
      setStep('pin');
      return false;
    };
    if (entered !== pin) return retry('Those two did not match. Start the PIN again.');
    const result = await resetPin(code, userId, entered);
    if (!result.ok) return retry(result.error);
    toast('PIN changed. Sign in with the new one.', 'success');
    onDone();
    return true;
  }

  return (
    <div className="flex w-full flex-col items-center">
      {step === 'code' && (
        <div className="flex w-full flex-col gap-4">
          <p className="text-center text-[12.5px] leading-relaxed text-ink-2">
            Enter the recovery code you wrote down when this device was set up.
          </p>
          <Field
            label="Recovery code"
            placeholder="XXXX-XXXX-XXXX"
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="font-mono tracking-[2px] uppercase"
            value={code}
            error={error ?? undefined}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.trim()) void checkCode();
            }}
          />
          <Button fullWidth size="lg" disabled={!code.trim() || checking} onClick={checkCode}>
            {checking ? 'Checking…' : 'Continue'}
          </Button>
        </div>
      )}

      {step === 'who' && (
        <div className="flex w-full flex-col gap-2">
          <p className="mb-2 text-center text-[12.5px] text-ink-2">Whose PIN is being reset?</p>
          {admins.map((admin) => (
            <button
              key={admin.id}
              type="button"
              onClick={() => {
                setUserId(admin.id);
                setStep('pin');
              }}
              className={cn(
                'h-12 rounded-md border border-line bg-raised text-[14px] font-semibold',
                'transition-colors hover:border-accent',
              )}
            >
              {admin.name}
            </button>
          ))}
        </div>
      )}

      {(step === 'pin' || step === 'confirm') && (
        <>
          <h2 className="mb-5 text-[13px] font-bold tracking-wide text-ink-2 uppercase">
            {step === 'pin' ? `New ${PIN_LENGTH}-digit PIN` : 'Enter it again'}
          </h2>
          <PinPad onSubmit={takePin} message={error ?? ' '} tone={error ? 'bad' : 'muted'} />
        </>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-3 min-h-10 px-3 text-[12px] font-semibold text-ink-3 hover:text-accent"
      >
        Cancel
      </button>
    </div>
  );
}
