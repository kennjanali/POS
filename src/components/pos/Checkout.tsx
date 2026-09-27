'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Smartphone, Split, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { peso } from '@/lib/format';
import { discountRequest } from '@/lib/migrate';
import { addC, cents, parsePesos, type Centavos } from '@/lib/money';
import { can } from '@/lib/permissions';
import { formatQty, lineTotal } from '@/lib/qty';
import { computeBill } from '@/lib/tax';
import {
  REFERENCED_METHODS,
  TENDER_LABELS,
  TENDER_METHODS,
  type Order,
  type TenderMethod,
} from '@/lib/types';
import { useAuth } from '@/store/useAuth';
import { billedLines, usePos, type UserResult } from '@/store/usePos';

const DISCOUNTS = [
  { kind: 'none', label: 'No discount' },
  { kind: 'owner', label: 'Discount %' },
] as const;

interface CheckoutProps {
  order: Order;
  open: boolean;
  onClose: () => void;
  onPaid: (orderId: string) => void;
}

export function Checkout({ order, open, onClose, onPaid }: CheckoutProps) {
  const settings = usePos((s) => s.settings);
  const clearDiscount = usePos((s) => s.clearDiscount);
  const setOwnerDiscountPercent = usePos((s) => s.setOwnerDiscountPercent);
  const addTender = usePos((s) => s.addTender);
  const removeTender = usePos((s) => s.removeTender);
  const closeOrder = usePos((s) => s.closeOrder);
  const payExact = usePos((s) => s.payExact);
  const canDiscount = useAuth((s) => can(s.session, 'discount.owner'));

  const [method, setMethod] = useState<TenderMethod>('cash');
  const [amountInput, setAmountInput] = useState('');
  const [refNo, setRefNo] = useState('');
  /** Other / split: every method, part payments and change. */
  const [splitPicked, setSplitPicked] = useState(false);
  /** GCash picked: waiting for its reference number. */
  const [gcash, setGcash] = useState(false);

  const { serveStep } = settings.features;
  const billed = billedLines(order, serveStep);
  // With a serve step only served lines are billed. Anything still pending
  // when the sale closes leaves the kitchen unpaid for and never comes off
  // stock. Without one, every line is billed.
  const pending = serveStep ? order.lines.filter((l) => !l.served && !l.voided) : [];

  const bill = useMemo(() => {
    const gross = billed.reduce<Centavos>(
      (sum, l) => addC(sum, lineTotal(l.unitCents, l.qty)),
      cents(0),
    );
    return computeBill(gross, settings, discountRequest(order.discount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.lines, order.discount, settings]);

  // What the till keeps once change is handed back — the figure that has to
  // match the bill. See keptByTill in the store.
  const kept = order.tenders.reduce(
    (sum, t) => sum + (t.tenderedCents ?? t.amountCents) - (t.changeCents ?? 0),
    0,
  );
  const balance = cents(bill.amountDue - kept);
  // Negative balance means a discount was applied or a line voided after the
  // payment was recorded, leaving a payment that is now too large.
  const overRecorded = kept > bill.amountDue;
  const needsRef = REFERENCED_METHODS.includes(method);
  const ownerPercent = order.discount.kind === 'owner' ? (order.discount.percent ?? 0) : null;
  // A payment already taken is only visible, and removable, in the split view.
  const split = splitPicked || order.tenders.length > 0;

  function showRefusal(result: UserResult) {
    if (!result.ok) toast(result.error, 'danger');
  }

  function close() {
    setSplitPicked(false);
    setGcash(false);
    setRefNo('');
    setAmountInput('');
    onClose();
  }

  function paid() {
    onPaid(order.id);
    close();
  }

  function pay(how: 'cash' | 'gcash') {
    const result = payExact(order.id, how, how === 'gcash' ? refNo : undefined);
    if (result.ok) paid();
    else toast(result.error, 'danger');
  }

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
          `Enter the exact amount.`,
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
    if (overRecorded) {
      toast(
        `The bill changed after payment was taken. Remove the payment and ` +
          `take it again for ${peso(bill.amountDue, settings.currency)}.`,
        'danger',
      );
      return;
    }
    const result = closeOrder(order.id);
    if (result.ok) paid();
    else toast(result.error, 'danger');
  }

  const totalChange = order.tenders.reduce((sum, t) => sum + (t.changeCents ?? 0), 0);
  const due = peso(bill.amountDue, settings.currency);

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Payment — ${order.label}`}
      width="lg"
      footer={
        split ? (
          <Button
            size="lg"
            fullWidth
            variant="success"
            disabled={balance > 0 || overRecorded || billed.length === 0}
            onClick={finish}
          >
            {balance > 0
              ? `${peso(balance, settings.currency)} still due`
              : overRecorded
                ? `Over by ${peso(cents(-balance), settings.currency)} — take it again`
                : `Complete — ${due}`}
          </Button>
        ) : undefined
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
                — {pending.map((l) => `${formatQty(l.qty)}x ${l.name}`).join(', ')}. Pending items
                are not on this bill. Close the sale now and they go out unpaid for.
              </p>
            </div>
          )}

          <ul className="mb-3 flex list-none flex-col gap-1 p-0">
            {billed.map((line) => (
              <li
                key={line.lineNo}
                className="flex items-baseline justify-between gap-3 text-[12.5px]"
              >
                <span className="min-w-0 truncate">
                  {formatQty(line.qty)}× {line.name}
                </span>
                <span className="tnum shrink-0 font-semibold">
                  {peso(lineTotal(line.unitCents, line.qty), settings.currency)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="flex flex-col gap-1 border-t border-line pt-2.5 text-[12.5px]">
            <Row label="Gross" value={peso(bill.gross, settings.currency)} />

            {bill.discount > 0 && (
              <Row
                label="Discount"
                value={`−${peso(bill.discount, settings.currency)}`}
                tone="note"
              />
            )}

            <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-2">
              <dt className="text-[11px] font-bold tracking-wide uppercase">
                Amount due
              </dt>
              <dd className="tnum text-[20px] leading-none font-extrabold">{due}</dd>
            </div>
            {settings.vatRegistered && (
              <Row
                label={`${settings.vatLabel} (${Math.round(settings.vatRate * 100)}%) included`}
                value={peso(bill.vat, settings.currency)}
              />
            )}
          </dl>
        </section>

        {/* ── Right: discount + payment ──────────────────────────── */}
        <section className="flex flex-col gap-4">
          {canDiscount && (
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
                Discount
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {DISCOUNTS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={order.discount.kind === kind}
                    onClick={() =>
                      showRefusal(
                        kind === 'none'
                          ? clearDiscount(order.id)
                          : setOwnerDiscountPercent(order.id, ownerPercent ?? 0),
                      )
                    }
                    className={cn(
                      'min-h-11 rounded-md border px-1 py-2 text-[12px] font-semibold transition-colors',
                      order.discount.kind === kind
                        ? 'border-note bg-note text-white'
                        : 'border-line bg-raised text-ink-2 hover:bg-ground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {canDiscount && ownerPercent !== null && (
            <Field
              label="Percent off"
              type="number"
              min={0}
              max={100}
              suffix="%"
              value={ownerPercent}
              onChange={(e) =>
                showRefusal(setOwnerDiscountPercent(order.id, Number(e.target.value) || 0))
              }
            />
          )}

          {!split ? (
            <div className="flex flex-col gap-2">
              <p className="text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
                Payment
              </p>
              <Button
                size="lg"
                fullWidth
                variant="success"
                disabled={billed.length === 0}
                onClick={() => pay('cash')}
              >
                <Banknote size={17} aria-hidden />
                Exact cash — {due}
              </Button>

              {gcash ? (
                <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
                  <Field
                    label="GCash reference number"
                    placeholder="13-digit reference"
                    inputMode="numeric"
                    autoFocus
                    value={refNo}
                    onChange={(e) => setRefNo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && refNo.trim()) pay('gcash');
                    }}
                  />
                  <Button
                    fullWidth
                    disabled={!refNo.trim() || billed.length === 0}
                    onClick={() => pay('gcash')}
                  >
                    Paid by GCash — {due}
                  </Button>
                </div>
              ) : (
                <Button
                  size="lg"
                  fullWidth
                  variant="secondary"
                  disabled={billed.length === 0}
                  onClick={() => setGcash(true)}
                >
                  <Smartphone size={17} aria-hidden />
                  GCash
                </Button>
              )}

              <Button
                fullWidth
                variant="ghost"
                disabled={billed.length === 0}
                onClick={() => {
                  setGcash(false);
                  setRefNo('');
                  setSplitPicked(true);
                }}
              >
                <Split size={15} aria-hidden />
                Other / split
              </Button>
            </div>
          ) : (
            <>
              <div>
                <p className="mb-1.5 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
                  Payment
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {TENDER_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={method === m}
                      onClick={() => setMethod(m)}
                      className={cn(
                        'min-h-11 rounded-md border px-1 py-2 text-[12px] font-semibold transition-colors',
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
                    ? 'Leave blank for the exact balance.'
                    : 'Split the bill by adding more than one payment.'
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
                  hint="Needed to check against the wallet statement at the end of the day."
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value)}
                />
              )}

              <Button variant="secondary" fullWidth onClick={recordTender}>
                Add {TENDER_LABELS[method]} payment
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
                        aria-label="Remove payment"
                        onClick={() => removeTender(order.id, t.id)}
                        className="grid size-10 place-items-center rounded text-ink-3 hover:text-bad"
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
                    The payment is {peso(cents(-balance), settings.currency)} over the
                    total.
                  </strong>{' '}
                  The bill changed after it was taken. Remove the payment above and take{' '}
                  {due} instead.
                </p>
              )}

              {/* Hidden while the payment is over: the change was worked out
                  against the previous total, and a cashier reading it would hand
                  back the wrong money. The block above says what to do instead. */}
              {totalChange > 0 && !overRecorded && (
                <p className="rounded-md bg-good/10 px-2.5 py-2 text-[13px] font-bold text-good">
                  Change due {peso(totalChange, settings.currency)}
                </p>
              )}
            </>
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
