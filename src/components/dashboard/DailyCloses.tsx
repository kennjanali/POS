'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';

import { SlipFooter } from '@/components/pos/SlipFooter';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { fmtDate, peso } from '@/lib/format';
import { COLUMNS } from '@/lib/printer';
import { renderClose } from '@/lib/receipt';
import type { DailyClose } from '@/lib/types';
import { usePos } from '@/store/usePos';

const SHOWN = 7;

/**
 * The day's close: taken by itself at 23:59 (or on the next launch), or here
 * whenever the owner counts the till. Each close covers the sales since the
 * one before, so closing early just starts the next window early.
 */
export function DailyCloses() {
  const closes = usePos((s) => s.closes);
  const settings = usePos((s) => s.settings);
  const pending = usePos((s) => s.unclosedSales());
  const closeDay = usePos((s) => s.closeDay);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<DailyClose | null>(null);

  async function closeNow() {
    setBusy(true);
    const close = await closeDay();
    setBusy(false);
    if (close) setShown(close);
    else toast('Nothing to close — no sales since the last close.', 'danger');
  }

  const recent = closes.slice(-SHOWN).reverse();

  return (
    <section className="rounded-lg border border-line bg-surface p-3.5">
      <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">Daily closes</h3>

      <Button variant="secondary" fullWidth disabled={busy || pending === 0} onClick={() => void closeNow()}>
        <Lock size={14} aria-hidden />
        {pending === 0 ? 'Nothing to close' : `Close day now — ${pending} sale${pending === 1 ? '' : 's'}`}
      </Button>

      {recent.length === 0 ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
          The day closes by itself at 23:59, or when the till next opens.
        </p>
      ) : (
        <ul className="mt-3 flex list-none flex-col gap-1 p-0">
          {recent.map((close) => (
            <li key={close.id}>
              <button
                type="button"
                onClick={() => setShown(close)}
                className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-[12.5px] hover:bg-raised"
              >
                <span>
                  <span className="font-semibold">#{close.no}</span>{' '}
                  <span className="text-ink-3">
                    {fmtDate(close.closedAt)} · {close.orders} sales
                  </span>
                </span>
                <span className="tnum font-bold">{peso(close.netCents, settings.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {shown && (
        <CloseSlip close={shown} onClose={() => setShown(null)} />
      )}
    </section>
  );
}

function CloseSlip({ close, onClose }: { close: DailyClose; onClose: () => void }) {
  const settings = usePos((s) => s.settings);
  const text = renderClose(close, settings, COLUMNS[settings.printer?.width ?? 58]);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Daily close #${close.no}`}
      width="sm"
      footer={<SlipFooter text={text} onClose={onClose} />}
    >
      <pre className="overflow-x-auto rounded-md bg-raised p-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre">
        {text}
      </pre>
    </Modal>
  );
}
