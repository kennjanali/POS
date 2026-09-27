'use client';

import { useState } from 'react';
import { KeyRound, PackageOpen, ShieldCheck, ShoppingCart, Upload } from 'lucide-react';

import { PinPad } from './PinPad';
import { RestoreBackup } from './RestoreBackup';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { Field, Toggle } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { SAMPLE_CATALOGS } from '@/lib/catalogs';
import { generateRecoveryCode, PIN_LENGTH } from '@/lib/crypto';
import { PRESETS, type ShopType } from '@/lib/presets';
import { usePos, type SetupInput } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';

const SHOP_TYPES = Object.keys(PRESETS) as ShopType[];

/** What each shop type is for, in the owner's words rather than the switch's. */
const SHOP_HINTS: Record<ShopType, string> = {
  restaurant: 'Tables that stay open until paid',
  retail: 'Sells by the piece and by the measure',
  auto: 'Jobs by plate, with tires and mags',
  carwash: 'A queue of vehicles out front',
  general: 'A plain counter, nothing switched on but prices',
};

/** Four questions. The PIN is asked inside the third, and the recovery code
 *  is shown on the way out, so both count as part of the question that led to
 *  them rather than as questions of their own. */
type Step = 'type' | 'name' | 'owner' | 'pin' | 'confirm' | 'products' | 'recovery';

const STEP_NO: Record<Step, number> = {
  type: 1,
  name: 2,
  owner: 3,
  pin: 3,
  confirm: 3,
  products: 4,
  recovery: 4,
};

/**
 * A fresh install has nobody on it and ships no default PIN. Four questions
 * later there is a shop: what it sells, what it is called, who owns it and
 * with what PIN, and whether it starts from a menu or from nothing.
 *
 * Nothing is written until the last step. AuthGate swaps this screen out the
 * moment a user exists, so the recovery code has to be on screen first.
 */
export function FirstRunSetup() {
  const setupInstall = usePos((s) => s.setupInstall);
  const recordLogin = usePos((s) => s.recordLogin);
  const signIn = useAuth((s) => s.signIn);

  const [step, setStep] = useState<Step>('type');
  // No default: this is the one answer that cannot be guessed, because every
  // switch in the app follows from it.
  const [shopType, setShopType] = useState<ShopType | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [catalog, setCatalog] = useState<SetupInput['catalog']>('sample');
  const [ownerName, setOwnerName] = useState('');
  const [pin, setPin] = useState('');
  const [recoveryCode] = useState(generateRecoveryCode);
  const [writtenDown, setWrittenDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);

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
    setStep('products');
    return true;
  }

  async function finish() {
    if (!shopType) return;
    setBusy(true);
    const result = await setupInstall({
      shopType,
      businessName,
      ownerName,
      pin,
      recoveryCode,
      catalog,
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
          {restoring
            ? 'Restore a backup'
            : step === 'recovery'
              ? 'Recovery code'
              : `Setup · step ${STEP_NO[step]} of 4`}
        </p>

        <div className="mt-7 w-full rounded-xl bg-surface px-6 py-7">
          {restoring && <RestoreBackup onCancel={() => setRestoring(false)} />}

          {!restoring && step === 'type' && (
            <div className="flex flex-col gap-4">
              <h1 className="text-[15px] leading-snug font-bold">What kind of shop is this?</h1>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Shop type">
                {SHOP_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={shopType === type}
                    onClick={() => {
                      setShopType(type);
                      setStep('name');
                    }}
                    className={cn(
                      'flex min-h-12 w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left',
                      shopType === type ? 'border-accent bg-accent/10' : 'border-line bg-raised hover:border-accent',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold">{PRESETS[type].label}</span>
                      <span className="block text-[11.5px] text-ink-3">{SHOP_HINTS[type]}</span>
                    </span>
                    <span className="shrink-0 text-ink-3" aria-hidden>
                      ›
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRestoring(true)}
                className="min-h-10 self-center px-3 text-[12px] font-semibold text-ink-3 hover:text-accent"
              >
                Replacing a lost or broken tablet? Restore a backup
              </button>
            </div>
          )}

          {!restoring && step === 'name' && (
            <div className="flex flex-col gap-4">
              <h1 className="text-[15px] leading-snug font-bold">What is the shop called?</h1>
              <p className="-mt-2 text-[12.5px] leading-relaxed text-ink-2">
                As it is printed on receipts. You can change it later in Settings.
              </p>
              <Field
                label="Shop name"
                placeholder="Sampalok Auto Shop"
                value={businessName}
                autoFocus
                onChange={(e) => setBusinessName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && businessName.trim()) setStep('owner');
                }}
              />
              <Button
                fullWidth
                size="lg"
                disabled={!businessName.trim()}
                onClick={() => setStep('owner')}
              >
                Next
              </Button>
              <BackLink onClick={() => setStep('type')} />
            </div>
          )}

          {!restoring && step === 'owner' && (
            <div className="flex flex-col gap-4">
              <h1 className="text-[15px] leading-snug font-bold">Who owns the till?</h1>
              <div className="flex gap-2.5">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  This account is the <strong>superadmin</strong> — everything, including
                  who else gets in. Staff are added afterwards in Settings.
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
              <BackLink onClick={() => setStep('name')} />
            </div>
          )}

          {!restoring && (step === 'pin' || step === 'confirm') && (
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

          {!restoring && step === 'products' && shopType && (
            <div className="flex flex-col gap-4">
              <h1 className="text-[15px] leading-snug font-bold">What is on the shelf?</h1>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Starting products">
                <CatalogChoice
                  icon={<PackageOpen size={16} className="shrink-0 text-accent" aria-hidden />}
                  title={`Start from a ${PRESETS[shopType].label} sample`}
                  hint={`${SAMPLE_CATALOGS[shopType].length} ordinary items you can edit or delete. None of them is locked in.`}
                  selected={catalog === 'sample'}
                  onClick={() => setCatalog('sample')}
                />
                <CatalogChoice
                  icon={<Upload size={16} className="shrink-0 text-ink-3" aria-hidden />}
                  title="Import a spreadsheet"
                  hint="Comes with the import screen, and runs as soon as this tablet is set up."
                  disabled
                />
                <CatalogChoice
                  icon={<ShoppingCart size={16} className="shrink-0 text-ink-3" aria-hidden />}
                  title="Start empty"
                  hint="Nothing until you add it. You can type items in from the sell screen."
                  selected={catalog === 'none'}
                  onClick={() => setCatalog('none')}
                />
              </div>
              <Button fullWidth size="lg" onClick={() => setStep('recovery')}>
                Next
              </Button>
              <BackLink
                onClick={() => {
                  setPin('');
                  setError(null);
                  setStep('owner');
                }}
              />
            </div>
          )}

          {!restoring && step === 'recovery' && (
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
              <BackLink onClick={() => setStep('products')} disabled={busy} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CatalogChoice({
  icon,
  title,
  hint,
  selected,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={disabled ? undefined : selected === true}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-12 w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left',
        'disabled:cursor-not-allowed disabled:opacity-40',
        disabled
          ? 'border-line bg-raised'
          : selected
            ? 'border-accent bg-accent/10'
            : 'border-line bg-raised hover:border-accent',
      )}
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold">{title}</span>
        <span className="block text-[11.5px] leading-snug text-ink-3">{hint}</span>
      </span>
    </button>
  );
}

function BackLink({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-10 self-center px-3 text-[12px] font-semibold text-ink-3 hover:text-accent disabled:opacity-40"
    >
      Back
    </button>
  );
}
