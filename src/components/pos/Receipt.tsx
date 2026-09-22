'use client';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { amount, fmtDate, fmtTime } from '@/lib/format';
import { TENDER_LABELS, type Order, type Settings } from '@/lib/types';
import { usePos } from '@/store/usePos';

const WIDTH = 34;

function row(left: string, right = ''): string {
  const gap = Math.max(1, WIDTH - left.length - right.length);
  return left + ' '.repeat(gap) + right;
}

function centre(text: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return ' '.repeat(pad) + text;
}

export function renderReceipt(order: Order, settings: Settings): string {
  const rule = '-'.repeat(WIDTH);
  const out: string[] = [];

  out.push(centre(settings.businessName.toUpperCase()));
  if (settings.address) out.push(centre(settings.address));
  if (settings.tin) out.push(centre(`TIN ${settings.tin}`));
  out.push(rule);

  out.push(row('Invoice', order.invoiceNo));
  out.push(row('Order', order.label));
  out.push(row('Date', fmtDate(order.closedAt ?? order.openedAt)));
  out.push(row('Time', fmtTime(order.closedAt ?? order.openedAt)));
  out.push(rule);

  for (const line of order.lines) {
    if (line.voided || !line.served) continue;
    out.push(row(`${line.qty}x ${line.name}`, amount(line.unitCents * line.qty)));
  }
  out.push(rule);

  out.push(row('Gross', amount(order.grossCents)));

  if (order.vatExemptCents > 0) {
    out.push(row(`${settings.vatLabel}-exempt sale`, amount(order.vatExemptCents)));
  }
  if (order.discountCents > 0) {
    const label =
      order.discountKind === 'senior'
        ? 'Senior discount 20%'
        : order.discountKind === 'pwd'
          ? 'PWD discount 20%'
          : 'Discount';
    out.push(row(label, `-${amount(order.discountCents)}`));
  }
  if (settings.vatRegistered) {
    if (order.vatableCents > 0) {
      out.push(row('VATable sale', amount(order.vatableCents)));
    }
    if (order.vatCents > 0) {
      out.push(row(settings.vatLabel, amount(order.vatCents)));
    }
  }

  out.push(row('TOTAL', amount(order.netCents)));
  out.push(rule);

  for (const tender of order.tenders) {
    out.push(row(TENDER_LABELS[tender.method], amount(tender.amountCents)));
    if (tender.refNo) out.push(row('  Ref', tender.refNo));
    if (tender.changeCents && tender.changeCents > 0) {
      out.push(row('  Change', amount(tender.changeCents)));
    }
  }

  if (order.discountIdNo) {
    out.push(rule);
    out.push(row('ID No.', order.discountIdNo));
    if (order.discountIdName) out.push(row('Name', order.discountIdName));
    out.push(row('Signature', '____________'));
  }

  out.push(rule);
  if (settings.receiptFooter) out.push(centre(settings.receiptFooter));
  if (settings.trainingMode) {
    out.push('');
    out.push(centre('*** TRAINING MODE ***'));
    out.push(centre('NOT A VALID RECEIPT'));
  }

  return out.join('\n');
}

interface ReceiptModalProps {
  orderId: string | null;
  onClose: () => void;
}

export function ReceiptModal({ orderId, onClose }: ReceiptModalProps) {
  const settings = usePos((s) => s.settings);
  const order = usePos((s) => s.orders.find((o) => o.id === orderId));

  if (!order) return null;
  const text = renderReceipt(order, settings);

  function print() {
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
          <Button fullWidth onClick={print}>
            Print
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
