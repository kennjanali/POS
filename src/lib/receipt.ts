import { amount, fmtDate, fmtTime } from './format';
import { COLUMNS } from './printer';
import { TENDER_LABELS, type Order, type Settings } from './types';

/**
 * Plain fixed-width text: the screen shows it and the thermal printer prints
 * it as is. `width` is the printer's characters per line. A line never runs
 * past it — a thermal printer would wrap it mid-word.
 */
export function renderReceipt(order: Order, settings: Settings, width: number = COLUMNS[58]): string {
  const row = (left: string, right = ''): string => {
    const room = Math.max(1, width - right.length - 1);
    const text = left.length > room ? left.slice(0, room) : left;
    return text + ' '.repeat(Math.max(1, width - text.length - right.length)) + right;
  };
  const centre = (text: string): string => {
    const line = text.slice(0, width);
    return ' '.repeat(Math.floor((width - line.length) / 2)) + line;
  };
  const rule = '-'.repeat(width);
  const out: string[] = [];

  out.push(centre(settings.businessName.toUpperCase()));
  if (settings.address) out.push(centre(settings.address));
  out.push(centre('ORDER SLIP'));
  out.push(rule);

  out.push(row('Order no.', order.invoiceNo));
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
  // POS@034 tracks sales; it is not a BIR-registered machine, so what it
  // prints is never a receipt. The owner issues their own invoices.
  out.push('');
  out.push(centre('THIS IS NOT AN OFFICIAL'));
  out.push(centre('RECEIPT OR INVOICE'));
  if (settings.trainingMode) out.push(centre('*** TRAINING MODE ***'));

  return out.join('\n');
}
