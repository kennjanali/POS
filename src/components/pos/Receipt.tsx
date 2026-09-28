'use client';

import { Modal } from '@/components/ui/Modal';
import { COLUMNS } from '@/lib/printer';
import { renderReceipt } from '@/lib/receipt';
import { usePos } from '@/store/usePos';
import { SlipFooter } from './SlipFooter';

interface ReceiptModalProps {
  orderId: string | null;
  onClose: () => void;
}

export function ReceiptModal({ orderId, onClose }: ReceiptModalProps) {
  const settings = usePos((s) => s.settings);
  const order = usePos((s) => s.orders.find((o) => o.id === orderId));

  if (!order) return null;
  const text = renderReceipt(order, settings, COLUMNS[settings.printer?.width ?? 58]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Sale slip — ${order.invoiceNo ?? order.label}`}
      width="sm"
      footer={<SlipFooter text={text} onClose={onClose} />}
    >
      <pre className="overflow-x-auto rounded-md bg-raised p-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre">
        {text}
      </pre>
    </Modal>
  );
}
