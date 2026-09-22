'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import { cn } from './cn';

type Tone = 'info' | 'success' | 'danger';

interface ToastState {
  message: string | null;
  tone: Tone;
  show: (message: string, tone?: Tone) => void;
  hide: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'info',
  show: (message, tone = 'info') => set({ message, tone }),
  hide: () => set({ message: null }),
}));

export function toast(message: string, tone: Tone = 'info') {
  useToast.getState().show(message, tone);
}

const TONES: Record<Tone, string> = {
  info: 'bg-ink text-ground',
  success: 'bg-good text-white',
  danger: 'bg-bad text-white',
};

export function Toaster() {
  const { message, tone, hide } = useToast();

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(hide, 2600);
    return () => window.clearTimeout(timer);
  }, [message, hide]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'animate-rise fixed bottom-5 left-1/2 z-600 -translate-x-1/2',
        'rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-xl',
        TONES[tone],
      )}
    >
      {message}
    </div>
  );
}
