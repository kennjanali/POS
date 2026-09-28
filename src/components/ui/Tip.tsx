'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';

import { takeTip, type TipStorage } from '@/lib/tips';
import { useAuth } from '@/store/useAuth';

function storage(): TipStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A one-line tip, the first time this user opens the screen. It never shows
 * again for them, and shows nothing at all when the browser keeps no storage.
 */
export function Tip({ id, children }: { id: string; children: React.ReactNode }) {
  const userId = useAuth((s) => s.session?.userId ?? null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (userId && takeTip(storage(), userId, id)) setShow(true);
  }, [userId, id]);

  if (!show) return null;
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-[12.5px]"
    >
      <Lightbulb size={14} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label="Dismiss tip"
        className="grid size-7 shrink-0 place-items-center rounded text-ink-3 hover:bg-accent/15 hover:text-ink"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
