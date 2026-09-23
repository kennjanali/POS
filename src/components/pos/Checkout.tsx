'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Info, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { peso } from '@/lib/format';
import { cents, parsePesos, type Centavos } from '@/lib/money';
import { computeBill, type DiscountKind } from '@/lib/tax';
import {
  REFERENCED_METHODS,
  TENDER_LABELS,
  TENDER_METHODS,
  type Order,
  type TenderMethod,
} from '@/lib/types';
import { usePos } from '@/store/usePos';

const DISCOUNTS: { kind: DiscountKind; label: string }[] = [
  { kind: 'none', label: 'None' },
  { kind: 'senior', label: 'Senior' },
  { kind: 'pwd', label: 'PWD' },
  { kind: 'custom', label: 'Custom' },
];

interface CheckoutProps {
  order: Order;
  open: boolean;
  onClose: () => void;
  onPaid: (orderId: string) => void;
}

export function Checkout({ order, open, onClose, onPaid }: CheckoutProps) {
  const settings = usePos((s) => s.settings);
  const setDiscount = usePos((s) => s.setDiscount);
  const addTender = usePos((s) => s.addTender);
  const removeTender = usePos((s) => s.removeTender);
  const closeOrder = usePos((s) => s.closeOrder);

  const [method, setMethod] = useState<TenderMethod>('cash');
  const [amountInput, setAmountInput] = useState('');
  const [refNo, setRefNo] = useState('');

  const served = order.lines.filter((l) => l.served && !l.voided);
  // Only served lines are billed. Anything still pending when the sale closes
  // leaves the kitchen unpaid for and never comes off stock.
  const pending = order.lines.filter((l) => !l.served && !l.voided);

  const bill = useMemo(() => {
    const gross = served.reduce<Centavos>(
      (sum, l) => cents(sum + l.unitCents * l.qty),
      cents(0),
    );
    return computeBill(gross, settings, {
      kind: order.discountKind,
      customPercent: order.customPercent,
      diners: order.diners,
      eligibleDiners: order.eligibleDiners,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    order.lines,
    order.discountKind,
    order.customPercent,
    order.diners,
    order.eligibleDiners,
    settings,
  ]);

  // What the till keeps once change is handed back — the figure that has to
  // match the bill. See keptByTill in the store.
  const kept = order.tenders.reduce(
    (sum, t) => sum + (t.tenderedCents ?? t.amountCents) - (t.changeCents ?? 0),
    0,
  );
  const balance = cents(bill.amountDue - kept);
  // Negative balance means a discount was applied or a line voided after the
  // payment was recorded, leaving a tender that is now too large.
  const overRecorded = kept > bill.amountDue;
  const statutory = order.discountKind === 'senior' || order.discountKind === 'pwd';
  const needsRef = REFERENCED_METHODS.includes(method);
  const needsId = statutory && !order.discountIdNo?.trim();

  function recordTender() {
    if (balance <= 0) {
      toast('This bill is already covered', 'danger');
      return;
    }
    const typed = amountInput.trim();
    const requested = typed ? parsePesos(typed) : balance;
    if (requested <= 0) {
      toast('Enter an amount greater than zero', 'danger');
      return;
    }
    if (needsRef && !refNo.trim()) {
      toast(`${TENDER_LABELS[method]} needs a reference number`, 'danger');
      return;
    }
    // Only cash can overshoot, because only cash gives change back. Booking a
    // 500 e-wallet transfer against a 104 bill would put 500 in the day's
    // GCash total and leave the wallet statement impossible to reconcile.
    if (method !== 'cash' && requested > balance) {
      toast(
        `That is more than the ${peso(balance, settings.currency)} due. ` +
          `Record the exact amount.`,
        'danger',
      );
      return;
    }

    if (method === 'cash') {
      // Cash: the customer may hand over more than the balance.
      const applied = cents(Math.min(requested, Math.max(balance, 0)));
      const change = cents(requested - applied);
      addTender(order.id, {
        method,
        amountCents: applied,
        tenderedCents: requested,
        changeCents: change,
        refNo: null,
      });
      if (change > 0) {
        toast(`Change due ${peso(change, settings.currency)}`, 'success');
      }
    } else {
      addTender(order.id, {
        method,
        amountCents: requested,
        tenderedCents: null,
        changeCents: null,
        refNo: refNo.trim() || null,
      });
    }

    setAmountInput('');
    setRefNo('');
  }

  function finish() {
    if (needsId) {
      toast('Record the Senior / PWD ID number first', 'danger');
      return;
    }
    if (overRecorded) {
      toast(
        `The bill changed after payment was recorded. Remove the tender and ` +
          `take it again for ${peso(bill.amountDue, settings.currency)}.`,
        'danger',
      );
      return;
    }
    if (closeOrder(order.id)) {
      onPaid(order.id);
      onClose();
    } else {
      toast('Payment does not cover the amount due', 'danger');
    }
  }

  const totalChange = order.tenders.reduce((sum, t) => sum + (t.changeCents ?? 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Payment — ${order.label}`}
      width="lg"
      footer={
        <Button
          size="lg"
          fullWidth
          variant="success"
          disabled={balance > 0 || overRecorded || served.length === 0}
          onClick={finish}
        >
          {balance > 0
            ? `${peso(balance, settings.currency)} still due`
            : overRecorded
              ? `Over by ${peso(cents(-balance), settings.currency)} — re-record`
              : `Complete — ${peso(bill.amountDue, settings.currency)}`}
        </Button>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        {/* ── Left: the bill ─────────────────────────────────────── */}
        <section>
          {pending.length > 0 && (
            <div className="mb-3 flex gap-2 rounded-md border border-warn/40 bg-warn/5 p-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <p className="min-w-0 text-[11.5px] leading-relaxed text-ink-2">
                <strong className="text-warn">
                  {pending.length} item{pending.length > 1 ? 's' : ''} still pending
                </strong>{' '}
                — {pending.map((l) => `${l.qty}x ${l.name}`).join(', ')}. Pending items
                are not on this bill. Close the sale now and they go out unpaid for.
              </p>
            </div>
          )}

          <ul className="mb-3 flex list-none flex-col gap-1 p-0">
            {served.map((line) => (
              <li
                key={line.lineNo}
                className="flex items-baseline justify-between gap-3 text-[12.5px]"
              >
                <span className="min-w-0 truncate">
                  {line.qty}× {line.name}
                </span>
                <span className="tnum shrink-0 font-semibold">
                  {peso(cents(line.unitCents * line.qty), settings.currency)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="flex flex-col gap-1 border-t border-line pt-2.5 text-[12.5px]">
            <Row label="Gross" value={peso(bill.gross, settings.currency)} />

            {bill.vatExemptSale > 0 && (
              <Row
                label={`${settings.vatLabel}-exempt sale`}
                value={peso(bill.vatExemptSale, settings.currency)}
                tone="note"
              />
            )}
            {bill.discount > 0 && (
              <Row
                label={statutory ? 'Statutory discount (20%)' : 'Discount'}
                value={`−${peso(bill.discount, settings.currency)}`}
                tone="note"
              />
            )}
            {settings.vatRegistered && bill.vat > 0 && (
              <Row
                label={`${settings.vatLabel} (${(settings.vatRate * 100).toFixed(0)}%)`}
                value={peso(bill.vat, settings.currency)}
              />
            )}

            <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-2">
              <dt className="text-[11px] font-bold tracking-wide uppercase">
                Amount due
              </dt>
              <dd className="tnum text-[20px] leading-none font-extrabold">
                {peso(bill.amountDue, settings.currency)}
              </dd>
            </div>
          </dl>

          {statutory && (
            <div className="mt-3 flex gap-2 rounded-md border border-note/30 bg-note/5 p-2.5">
              <Info size={13} className="mt-0.5 shrink-0 text-note" aria-hidden />
              <div className="min-w-0 text-[11px] leading-relaxed text-ink-2">
                {bill.trace.map((step, i) => (
                  <p key={i}>{step}</p>
                ))}
                {bill.deductibleDiscount > 0 && (
                  <p className="mt-1 font-semibold text-note">
                    Deductible from gross income:{' '}
                    {peso(bill.deductibleDiscount, settings.currency)}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Right: discount + tender ───────────────────────────── */}
        <section className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
              Discount
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {DISCOUNTS.map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={order.discountKind === kind}
                  onClick={() => setDiscount(order.id, { discountKind: kind })}
                  className={cn(
                    'rounded-md border px-1 py-2 text-[12px] font-semibold transition-colors',
                    order.discountKind === kind
                      ? 'border-note bg-note text-white'
                      : 'border-line bg-raised text-ink-2 hover:bg-ground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {order.discountKind === 'custom' && (
            <Field
              label="Percent off"
              type="number"
              min={0}
              max={100}
              suffix="%"
              value={order.customPercent}
              onChange={(e) =>
                setDiscount(order.id, { customPercent: Number(e.target.value) || 0 })
              }
            />
          )}

          {statutory && (
            <div className="flex flex-col gap-2.5 rounded-md border border-line bg-raised p-2.5">
              <Field
                label="ID number"
                placeholder="OSCA / PWD ID"
                hint="Required on record under RA 9994 / RA 10754."
                value={order.discountIdNo ?? ''}
                onChange={(e) => setDiscount(order.id, { discountIdNo: e.target.value })}
              />
              <Field
                label="Name on ID"
                placeholder="Full name"
                value={order.discountIdName ?? ''}
                onChange={(e) =>
                  setDiscount(order.id, { discountIdName: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Diners"
                  type="number"
                  min={1}
                  value={order.diners}
                  onChange={(e) =>
                    setDiscount(order.id, { diners: Math.max(1, Number(e.target.value)) })
                  }
                />
                <Field
                  label="Eligible"
                  type="number"
                  min={1}
                  value={order.eligibleDiners}
                  onChange={(e) =>
                    setDiscount(order.id, {
                      eligibleDiners: Math.max(1, Number(e.target.value)),
                    })
                  }
                />
              </div>
              <p className="text-[10.5px] leading-snug text-ink-3">
                On a shared bill the discount applies only to the eligible diner&rsquo;s
                share (RR 7-2010).
              </p>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
              Tender
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {TENDER_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    'rounded-md border px-1 py-2 text-[12px] font-semibold transition-colors',
                    method === m
                      ? 'border-accent bg-accent text-white'
                      : 'border-line bg-raised text-ink-2 hover:bg-ground',
                  )}
                >
                  {TENDER_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <Field
            label={method === 'cash' ? 'Cash received' : 'Amount'}
            type="text"
            inputMode="decimal"
            placeholder={peso(Math.max(balance, 0), '').trim()}
            hint={
              method === 'cash'
                ? 'Leave blank to tender the exact balance.'
                : 'Split the bill by recording more than one tender.'
            }
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') recordTender();
            }}
          />

          {needsRef && (
            <Field
              label="Reference number"
              placeholder="13-digit reference"
              hint="Needed to reconcile against the wallet statement at close."
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
            />
          )}

          <Button variant="secondary" fullWidth onClick={recordTender}>
            Record {TENDER_LABELS[method]}
          </Button>

          {order.tenders.length > 0 && (
            <ul className="flex list-none flex-col gap-1 p-0">
              {order.tenders.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12px]"
                >
                  <span className="font-semibold">{TENDER_LABELS[t.method]}</span>
                  {t.refNo && (
                    <span className="truncate font-mono text-[10.5px] text-ink-3">
                      {t.refNo}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="tnum font-bold">
                    {peso(t.amountCents, settings.currency)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove tender"
                    onClick={() => removeTender(order.id, t.id)}
                    className="rounded p-0.5 text-ink-3 hover:text-bad"
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {overRecorded && (
            <p className="rounded-md border border-bad/40 bg-bad/5 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">
              <strong className="text-bad">
                Recorded payment is {peso(cents(-balance), settings.currency)} over
                the total.
              </strong>{' '}
              The bill changed after this was taken. Remove the tender above and
              record {peso(bill.amountDue, settings.currency)} instead.
            </p>
          )}

          {/* Hidden while the tender is over-recorded: the change was worked out
              against the previous total, and a cashier reading it would hand
              back the wrong money. The block above says what to do instead. */}
          {totalChange > 0 && !overRecorded && (
            <p className="rounded-md bg-good/10 px-2.5 py-2 text-[13px] font-bold text-good">
              Change due {peso(totalChange, settings.currency)}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'note';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className={cn('tnum font-semibold', tone === 'note' && 'text-note')}>
        {value}
      </dd>
    </div>
  );
}
