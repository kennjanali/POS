'use client';

import { forwardRef } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:brightness-110 active:brightness-95 disabled:hover:brightness-100',
  secondary:
    'bg-raised text-ink border border-line hover:bg-ground active:bg-line',
  ghost: 'text-ink-2 hover:bg-raised hover:text-ink',
  danger: 'bg-bad text-white hover:brightness-110 active:brightness-95',
  success: 'bg-good text-white hover:brightness-110 active:brightness-95',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
  lg: 'h-12 px-5 text-[15px] gap-2.5',
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', fullWidth, type = 'button', ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold',
        'transition-[filter,background-color,color] duration-100',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
