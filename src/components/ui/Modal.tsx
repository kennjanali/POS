'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'md',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-500 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'animate-rise flex max-h-[88vh] w-full flex-col rounded-lg',
          'bg-surface shadow-2xl outline-none',
          WIDTHS[width],
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-3 transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>
        <div className="scroll-y flex-1 px-4 py-4">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-line px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}
