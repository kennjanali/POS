'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { canShareFiles, saveTextFile, shareSavedFile } from '@/lib/files';
import { COLUMNS, printSlip } from '@/lib/printer';
import { renderQuote } from '@/lib/receipt';
import { usePos } from '@/store/usePos';

interface QuoteSlipProps {
  quoteId: string | null;
  onClose: () => void;
}

/** The quotation as it will print, with the two ways of getting it to the
 *  customer: the printer on the counter, or their own phone. */
export function QuoteSlip({ quoteId, onClose }: QuoteSlipProps) {
  const settings = usePos((s) => s.settings);
  const quote = usePos((s) => s.quotes.find((q) => q.id === quoteId));
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);

  if (!quote) return null;
  const text = renderQuote(quote, settings, COLUMNS[settings.printer?.width ?? 58]);
  const fileName = `${quote.quoteNo}.txt`;

  async function print() {
    setBusy('print');
    try {
      await printSlip(text, settings.printer ?? null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not print.', 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setBusy('share');
    try {
      // Saved first, then handed to Android: the share sheet takes a file, not
      // a string, and the file is what the customer keeps.
      await saveTextFile(fileName, text);
      await shareSavedFile(fileName);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not share that.', 'danger');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Quotation — ${quote.quoteNo}`}
      width="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose}>
            Close
          </Button>
          {canShareFiles() && (
            <Button variant="secondary" fullWidth onClick={() => void share()} disabled={busy !== null}>
              {busy === 'share' ? 'Sharing…' : 'Share'}
            </Button>
          )}
          <Button fullWidth onClick={() => void print()} disabled={busy !== null}>
            {busy === 'print' ? 'Printing…' : 'Print'}
          </Button>
        </div>
      }
    >
      <pre className="overflow-x-auto rounded-md bg-raised p-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre">
        {text}
      </pre>
    </Modal>
  );
}
