'use client';

import { useState } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { canPrintBluetooth, COLUMNS, printText } from '@/lib/printer';
import { renderReceipt } from '@/lib/receipt';
import { usePos } from '@/store/usePos';

interface ReceiptModalProps {
  orderId: string | null;
  onClose: () => void;
}

export function ReceiptModal({ orderId, onClose }: ReceiptModalProps) {
  const settings = usePos((s) => s.settings);
  const order = usePos((s) => s.orders.find((o) => o.id === orderId));
  const [printing, setPrinting] = useState(false);

  if (!order) return null;
  const printer = settings.printer ?? null;
  const text = renderReceipt(order, settings, COLUMNS[printer?.width ?? 58]);

  async function printBluetooth() {
    if (!printer) {
      toast('Choose a receipt printer in Settings first.', 'danger');
      return;
    }
    setPrinting(true);
    try {
      await printText(printer, text);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not print.', 'danger');
    } finally {
      setPrinting(false);
    }
  }

  function print() {
    if (canPrintBluetooth()) {
      void printBluetooth();
      return;
    }
    const win = window.open('', '_blank', 'width=380,height=640');
    if (!win) return;
    win.document.write(
      '<html><head><title>Receipt</title><style>' +
        'body{font:12px/1.65 ui-monospace,Menlo,monospace;padding:16px;white-space:pre}' +
        '</style></head><body></body></html>',
    );
    win.document.body.textContent = text;
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Receipt — ${order.invoiceNo}`}
      width="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose}>
            Close
          </Button>
          <Button fullWidth onClick={print} disabled={printing}>
            {printing ? 'Printing…' : 'Print'}
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
