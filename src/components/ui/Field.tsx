'use client';

import { useId } from 'react';
import { cn } from './cn';

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
}

export function Field({ label, hint, error, suffix, className, ...props }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-bold tracking-wide text-ink-2 uppercase">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-9 w-full rounded-md border bg-raised px-2.5 text-[13px] text-ink',
            'transition-colors placeholder:text-ink-3',
            error ? 'border-bad' : 'border-line focus:border-accent',
            className,
          )}
          {...props}
        />
        {suffix && <span className="shrink-0 text-[13px] text-ink-3">{suffix}</span>}
      </div>
      {error ? (
        <p id={`${id}-err`} className="text-[11px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function Toggle({ label, hint, checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-md border border-line bg-raised px-3 py-2.5 text-left transition-colors hover:bg-ground"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-ink-4',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white transition-[left]',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
