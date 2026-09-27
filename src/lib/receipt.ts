import { amount, fmtDate, fmtTime } from './format';
import { COLUMNS } from './printer';
import { formatQty, lineTotal } from './qty';
import { TENDER_LABELS, TENDER_METHODS, type DailyClose, type Order, type Settings } from './types';

/**
 * Slips are plain fixed-width text: the screen shows it and the thermal
 * printer prints it as is. `width` is the printer's characters per line. A
 * line never runs past it — a thermal printer would wrap it mid-word.
 */
function layout(width: number) {
  return {
    row: (left: string, right = ''): string => {
      const room = Math.max(1, width - right.length - 1);
      const text = left.length > room ? left.slice(0, room) : left;
      return text + ' '.repeat(Math.max(1, width - text.length - right.length)) + right;
    },
    centre: (text: string): string => {
      const line = text.slice(0, width);
      return ' '.repeat(Math.floor((width - line.length) / 2)) + line;
    },
    rule: '-'.repeat(width),
  };
}

/** The owner's end-of-day count, printed from the Dashboard. */
export function renderClose(close: DailyClose, settings: Settings, width: number = COLUMNS[58]): string {
  const { row, centre, rule } = layout(width);
  const out = [
    centre(settings.businessName.toUpperCase()),
    centre(`DAILY CLOSE #${close.no}`),
    rule,
    row('Date', fmtDate(close.closedAt)),
    row('Closed at', fmtTime(close.closedAt)),
    row('Sales', String(close.orders)),
    rule,
    row('Gross', amount(close.grossCents)),
    row('Discounts', `-${amount(close.discountCents)}`),
  ];
  if (close.voidedEarlierCents > 0) out.push(row('Voids, earlier days', `-${amount(close.voidedEarlierCents)}`));
  out.push(row('NET', amount(close.netCents)), rule);
  for (const method of TENDER_METHODS) {
    if (close.tenders[method] > 0) out.push(row(TENDER_LABELS[method], amount(close.tenders[method])));
  }
  out.push(rule, row('Running total', amount(close.runningNetCents)), row('Check', close.hash.slice(0, 12)));
  return out.join('\n');
}

export function renderReceipt(order: Order, settings: Settings, width: number = COLUMNS[58]): string {
  const { row, centre, rule } = layout(width);
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
    // "2.5 m Electrical wire". Lines sold before v8 carry no unit.
    const item = [formatQty(line.qty), line.unit, line.name].filter(Boolean).join(' ');
    out.push(row(item, amount(lineTotal(line.unitCents, line.qty))));
  }
  out.push(rule);

  out.push(row('Gross', amount(order.grossCents)));

  if (order.vatExemptCents > 0) {
    out.push(row(`${settings.vatLabel}-exempt sale`, amount(order.vatExemptCents)));
  }
  if (order.discountCents > 0) {
    const d = order.discount;
    const label = d.kind === 'promo' ? `Promo ${d.code} (${d.percent}%)` : 'Discount';
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

  out.push(rule);
  if (settings.receiptFooter) out.push(centre(settings.receiptFooter));
  // POS-034 tracks sales; it is not a BIR-registered machine, so what it
  // prints is never a receipt. The owner issues their own invoices.
  out.push('');
  out.push(centre('THIS IS NOT AN OFFICIAL'));
  out.push(centre('RECEIPT OR INVOICE'));
  if (settings.trainingMode) out.push(centre('*** TRAINING MODE ***'));

  return out.join('\n');
}
