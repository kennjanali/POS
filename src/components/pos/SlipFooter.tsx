'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { printSlip } from '@/lib/printer';
import { usePos } from '@/store/usePos';

/** Close and Print, for any slip shown in a modal. */
export function SlipFooter({ text, onClose }: { text: string; onClose: () => void }) {
  const printer = usePos((s) => s.settings.printer ?? null);
  const [printing, setPrinting] = useState(false);

  async function print() {
    setPrinting(true);
    try {
      await printSlip(text, printer);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not print.', 'danger');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="secondary" fullWidth onClick={onClose}>
        Close
      </Button>
      <Button fullWidth onClick={() => void print()} disabled={printing}>
        {printing ? 'Printing…' : 'Print'}
      </Button>
    </div>
  );
}
