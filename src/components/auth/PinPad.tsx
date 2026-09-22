'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';

import { PIN_LENGTH } from '@/lib/crypto';
import { cn } from '@/components/ui/cn';

interface PinPadProps {
  /** Called on the sixth digit. Resolve false to reject: the pad shakes,
   *  clears, and stays put. Resolve true and the caller has moved on. */
  onSubmit: (pin: string) => Promise<boolean>;
  disabled?: boolean;
  /** Shown under the dots — an error, or how long a lockout has left. */
  message?: string | null;
  tone?: 'muted' | 'bad';
  autoFocus?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function PinPad({
  onSubmit,
  disabled = false,
  message,
  tone = 'muted',
  autoFocus = true,
}: PinPadProps) {
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  /** An onSubmit that threw — a broken crypto context, a storage fault. Not a
   *  wrong PIN, and the operator needs the difference. */
  const [fault, setFault] = useState<string | null>(null);
  const inFlight = useRef(false);

  const locked = disabled || busy;

  const press = useCallback(
    (digit: string) => {
      if (locked) return;
      setFault(null);
      setDigits((current) => (current.length >= PIN_LENGTH ? current : current + digit));
    },
    [locked],
  );

  // Six digits is the whole gesture — no separate confirm button. Submitting
  // from an effect rather than from inside the setState updater: React is free
  // to re-run an updater, and a half-entered PIN going to the verifier is not
  // a theoretical problem.
  useEffect(() => {
    if (digits.length !== PIN_LENGTH || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    void (async () => {
      let accepted = false;
      try {
        accepted = await onSubmit(digits);
      } catch (error) {
        // Without this the pad stays busy forever and the till is bricked
        // mid-service.
        setFault(
          error instanceof Error ? error.message : 'Could not check that PIN. Try again.',
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
        setDigits('');
      }
      if (accepted) return;
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
    })();
  }, [digits, onSubmit]);

  // A till usually has a keyboard even when it has a touchscreen.
  useEffect(() => {
    if (!autoFocus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (!locked) setDigits((d) => d.slice(0, -1));
      } else if (event.key === 'Escape') {
        setDigits('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, locked, autoFocus]);

  // A lockout that starts while digits are on screen should clear them.
  useEffect(() => {
    if (disabled) setDigits('');
  }, [disabled]);

  return (
    <div className="flex w-full max-w-[268px] flex-col items-center gap-5">
      <div
        className={cn('flex items-center gap-3', shake && 'animate-shake')}
        role="status"
        aria-live="polite"
        aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              'size-3 rounded-full border transition-colors duration-100',
              i < digits.length
                ? 'border-accent bg-accent'
                : 'border-ink-4 bg-transparent',
            )}
          />
        ))}
      </div>

      {(fault ?? message) && (
        <p
          className={cn(
            'min-h-[16px] max-w-[250px] text-center text-[12.5px] leading-snug font-semibold',
            fault || tone === 'bad' ? 'text-bad' : 'text-ink-3',
          )}
        >
          {fault ?? message}
        </p>
      )}

      <div className="grid w-full grid-cols-3 gap-2.5">
        {KEYS.map((key) => (
          <PadKey key={key} onClick={() => press(key)} disabled={locked}>
            {key}
          </PadKey>
        ))}
        <PadKey onClick={() => setDigits('')} disabled={locked || digits.length === 0} muted>
          <span className="text-[12px] font-bold tracking-wide uppercase">Clear</span>
        </PadKey>
        <PadKey onClick={() => press('0')} disabled={locked}>
          0
        </PadKey>
        <PadKey
          onClick={() => setDigits((d) => d.slice(0, -1))}
          disabled={locked || digits.length === 0}
          muted
          label="Delete last digit"
        >
          <Delete size={18} aria-hidden />
        </PadKey>
      </div>
    </div>
  );
}

function PadKey({
  children,
  onClick,
  disabled,
  muted,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'grid h-14 place-items-center rounded-lg border text-[20px] font-semibold',
        'transition-colors duration-75 select-none',
        'disabled:cursor-not-allowed disabled:opacity-35',
        muted
          ? 'border-line bg-transparent text-ink-2'
          : 'border-line bg-raised text-ink',
        !disabled && 'hover:border-accent hover:text-accent active:bg-ground',
      )}
    >
      {children}
    </button>
  );
}
