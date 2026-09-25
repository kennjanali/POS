'use client';

import { useState } from 'react';
import { KeyRound, ShieldCheck, ShoppingCart } from 'lucide-react';

import { PinPad } from './PinPad';
import { Button } from '@/components/ui/Button';
import { Field, Toggle } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { generateRecoveryCode, PIN_LENGTH } from '@/lib/crypto';
import { DEFAULT_BRANCH } from '@/lib/seed';
import { usePos, type SetupInput } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';

type Step = 'business' | 'owner' | 'pin' | 'confirm' | 'recovery';

const STEP_NO: Record<Step, number> = { business: 1, owner: 2, pin: 3, confirm: 3, recovery: 4 };

/**
 * A fresh install has nobody on it and ships no default PIN. This wizard
 * names the business, creates the owner's superadmin account, and hands over
 * the recovery code — the one way back in if that PIN is ever forgotten.
 *
 * Nothing is written until the last step. AuthGate swaps this screen out the
 * moment a user exists, so the recovery code has to be on screen first.
 */
export function FirstRunSetup() {
  const setupInstall = usePos((s) => s.setupInstall);
  const recordLogin = usePos((s) => s.recordLogin);
  const signIn = useAuth((s) => s.signIn);

  const [step, setStep] = useState<Step>('business');
  const [business, setBusiness] = useState<SetupInput['business']>({
    businessName: '',
    address: '',
    tin: '',
    vatRegistered: false,
    pricesIncludeVat: true,
  });
  const [branchCode, setBranchCode] = useState(DEFAULT_BRANCH.branchCode);
  const [sampleMenu, setSampleMenu] = useState(true);
  const [ownerName, setOwnerName] = useState('');
  const [pin, setPin] = useState('');
  const [recoveryCode] = useState(generateRecoveryCode);
  const [writtenDown, setWrittenDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = (patch: Partial<SetupInput['business']>) =>
    setBusiness((current) => ({ ...current, ...patch }));

  async function takePin(entered: string): Promise<boolean> {
    setError(null);
    if (step === 'pin') {
      setPin(entered);
      setStep('confirm');
      return true;
    }
    if (entered !== pin) {
      setError('Those two did not match. Start the PIN again.');
      setPin('');
      setStep('pin');
      return false;
    }
    setStep('recovery');
    return true;
  }

  async function finish() {
    setBusy(true);
    const result = await setupInstall({
      business,
      branchCode,
      sampleMenu,
      ownerName,
      pin,
      recoveryCode,
    });
    if (!result.ok) {
      setBusy(false);
      toast(result.error, 'danger');
      return;
    }
    // Straight in, rather than handing back the keypad they just used.
    const signedIn = await signIn(pin, usePos.getState().users);
    if (signedIn.ok) recordLogin(signedIn.user.id);
    toast(`Welcome, ${ownerName.trim()}`, 'success');
  }

  return (
    <div className="fixed inset-0 z-500 overflow-y-auto bg-rail">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center p-6">
        <span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent">
          <ShoppingCart size={20} className="text-white" aria-hidden />
        </span>
        <p className="text-[22px] leading-none font-extrabold tracking-tight text-white">
          POS<span className="text-accent">@034</span>
        </p>
        <p className="mt-1.5 text-[11px] tracking-[2px] text-ink-3 uppercase">
          Setup · step {STEP_NO[step]} of 4
        </p>

        <div className="mt-7 w-full rounded-xl bg-surface px-6 py-7">
          {step === 'business' && (
            <div className="flex flex-col gap-4">
              <Field
                label="Business name"
                placeholder="As printed on the receipt"
                value={business.businessName}
                autoFocus
                onChange={(e) => edit({ businessName: e.target.value })}
              />
              <Field
                label="Address"
                value={business.address}
                onChange={(e) => edit({ address: e.target.value })}
              />
              <Field
                label="TIN"
                placeholder="000-000-000-00000"
                inputMode="numeric"
                value={business.tin}
                onChange={(e) => edit({ tin: e.target.value })}
              />
              <Field
                label="BIR branch code"
                hint="Head office is 00000. It prefixes every invoice number."
                inputMode="numeric"
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
              />
              <Toggle
                label="VAT registered"
                hint="Most businesses under PHP 3M a year are not. Leave off unless you are."
                checked={business.vatRegistered}
                onChange={(vatRegistered) => edit({ vatRegistered })}
              />
              {business.vatRegistered && (
                <Toggle
                  label="Menu prices include VAT"
                  checked={business.pricesIncludeVat}
                  onChange={(pricesIncludeVat) => edit({ pricesIncludeVat })}
                />
              )}
              <Toggle
                label="Start with a sample carinderia menu"
                hint="Twelve common items you can edit or remove. Off starts with an empty menu."
                checked={sampleMenu}
                onChange={setSampleMenu}
              />
              <Button
                fullWidth
                size="lg"
                disabled={!business.businessName.trim()}
                onClick={() => setStep('owner')}
              >
                Next
              </Button>
            </div>
          )}

          {step === 'owner' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2.5">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  This account is the <strong>superadmin</strong> — everything, including
                  who else gets in. Waiters and purchasers are added afterwards in Settings.
                </p>
              </div>
              <Field
                label="Owner's name"
                value={ownerName}
                autoFocus
                onChange={(e) => setOwnerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ownerName.trim()) setStep('pin');
                }}
              />
              <Button
                fullWidth
                size="lg"
                disabled={!ownerName.trim()}
                onClick={() => setStep('pin')}
              >
                Choose a PIN
              </Button>
              <BackLink onClick={() => setStep('business')} />
            </div>
          )}

          {(step === 'pin' || step === 'confirm') && (
            <div className="flex flex-col items-center">
              <h1 className="mb-1 text-[13px] font-bold tracking-wide text-ink-2 uppercase">
                {step === 'pin' ? `Choose a ${PIN_LENGTH}-digit PIN` : 'Enter it again'}
              </h1>
              <p className="mb-5 max-w-[240px] text-center text-[11.5px] leading-relaxed text-ink-3">
                {step === 'pin'
                  ? 'This is how you sign in. There is no password.'
                  : `Confirming the PIN for ${ownerName.trim()}.`}
              </p>
              <PinPad onSubmit={takePin} message={error ?? ' '} tone={error ? 'bad' : 'muted'} />
              <BackLink
                onClick={() => {
                  setPin('');
                  setError(null);
                  setStep('owner');
                }}
              />
            </div>
          )}

          {step === 'recovery' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2.5">
                <KeyRound size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  Your <strong>recovery code</strong> is the only way back in if you forget
                  your PIN. Write it down and keep it away from this device.{' '}
                  <strong>It is shown once.</strong>
                </p>
              </div>
              <p className="rounded-lg border border-line bg-raised py-4 text-center font-mono text-[24px] font-bold tracking-[3px] select-all">
                {recoveryCode}
              </p>
              <Toggle
                label="I have written it down"
                checked={writtenDown}
                onChange={setWrittenDown}
              />
              <Button fullWidth size="lg" disabled={!writtenDown || busy} onClick={finish}>
                {busy ? 'Setting up…' : 'Finish setup'}
              </Button>
              <BackLink onClick={() => setStep('pin')} disabled={busy} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-1 self-center text-[12px] font-semibold text-ink-3 hover:text-accent disabled:opacity-40"
    >
      Back
    </button>
  );
}
