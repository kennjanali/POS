'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';

import { QuoteSlip } from '@/components/quotes/QuoteSlip';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { Tip } from '@/components/ui/Tip';
import { businessDate, fmtDate, peso } from '@/lib/format';
import { can } from '@/lib/permissions';
import { quoteStatus } from '@/lib/quotes';
import { formatQty, lineTotal } from '@/lib/qty';
import type { Quote } from '@/lib/types';
import { useAuth } from '@/store/useAuth';
import { usePos } from '@/store/usePos';

type Shown = Quote & { shown: 'open' | 'expired' | 'converted' | 'cancelled' };

const CHIP: Record<Shown['shown'], string> = {
  open: 'bg-good/10 text-good',
  expired: 'bg-warn/10 text-warn',
  converted: 'bg-accent/10 text-accent',
  cancelled: 'bg-ink-4/10 text-ink-3',
};

export default function QuotesPage() {
  const router = useRouter();
  const session = useAuth((s) => s.session);
  const quotes = usePos((s) => s.quotes);
  const settings = usePos((s) => s.settings);
  const convertQuote = usePos((s) => s.convertQuote);
  const requote = usePos((s) => s.requote);
  const cancelQuote = usePos((s) => s.cancelQuote);

  const [slip, setSlip] = useState<string | null>(null);
  const [expired, setExpired] = useState<Shown | null>(null);
  const [cancelling, setCancelling] = useState<Shown | null>(null);
  const [reason, setReason] = useState('');

  const today = businessDate(Date.now());
  const mayCancel = can(session, 'quote.cancel');
  const currency = settings.currency;
  // A retail shop has one cart and no tickets, so a converted quote goes
  // straight to payment. Anywhere else it joins the floor and waits its turn.
  const sendToPayment = !settings.features.openOrders;

  const rows = useMemo<Shown[]>(
    () =>
      [...quotes]
        .map((q) => ({ ...q, shown: quoteStatus(q, today) }))
        .sort((a, b) => b.createdAt - a.createdAt),
    [quotes, today],
  );
  const stillOpen = rows.filter((r) => r.shown === 'open' || r.shown === 'expired');

  function convert(quote: Shown) {
    const result = convertQuote(quote.id, undefined, { confirmExpired: quote.shown === 'expired' });
    if (!result.ok) return toast(result.error, 'danger');
    toast(`${quote.quoteNo} converted to a sale.`, 'success');
    if (sendToPayment) router.push(`/sell?pay=${result.orderId}`);
  }

  function reQuote(quote: Shown) {
    const result = requote(quote.id);
    if (!result.ok) return toast(result.error, 'danger');
    const fresh = usePos.getState().quotes.find((q) => q.id === result.quoteId);
    toast(`Re-quoted as ${fresh?.quoteNo ?? 'a new quotation'}.`, 'success');
  }

  function confirmCancel() {
    if (!cancelling) return;
    const result = cancelQuote(cancelling.id, reason);
    if (!result.ok) return toast(result.error, 'danger');
    toast(`${cancelling.quoteNo} cancelled.`, 'success');
    setCancelling(null);
    setReason('');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3 empty:hidden">
        <Tip id="quotes">Save a cart as a quote, then turn it into a sale later.</Tip>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
        <h1 className="text-[15px] font-bold tracking-tight">Quotations</h1>
        <span className="text-[11px] font-bold tracking-wide text-ink-3 uppercase">
          {stillOpen.length} open
        </span>
      </div>

      <div className="scroll-y flex-1 p-4">
        {rows.length === 0 ? (
          <Empty
            icon={FileText}
            title="No quotations yet"
            action="Build a cart as usual, then use Save as quote on the payment screen."
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((quote) => (
              <li key={quote.id} className="rounded-md border border-line bg-surface px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-bold">
                      {quote.quoteNo}
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase',
                          CHIP[quote.shown],
                        )}
                      >
                        {quote.shown}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-3">
                      {fmtDate(quote.createdAt)}
                      {quote.customerName ? ` · ${quote.customerName}` : ''}
                      {` · holds until ${quote.validUntil}`}
                    </p>
                  </div>
                  <p className="tnum text-[15px] font-extrabold">
                    {peso(quote.netCents, currency)}
                  </p>
                </div>

                <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0 text-[12px] text-ink-2">
                  {quote.lines.map((l) => (
                    <li key={l.lineNo} className="flex justify-between gap-3">
                      <span className="truncate">
                        {formatQty(l.qty)} {l.unit} {l.name}
                      </span>
                      <span className="tnum shrink-0">
                        {peso(lineTotal(l.unitCents, l.qty), currency)}
                      </span>
                    </li>
                  ))}
                  {quote.discountCents > 0 && (
                    <li className="flex justify-between gap-3 text-ink-3">
                      <span>Discount</span>
                      <span className="tnum shrink-0">-{peso(quote.discountCents, currency)}</span>
                    </li>
                  )}
                </ul>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <SmallButton onClick={() => setSlip(quote.id)}>Print / Share</SmallButton>
                  {quote.shown === 'open' || quote.shown === 'expired' ? (
                    <>
                      <SmallButton
                        onClick={() =>
                          quote.shown === 'expired' ? setExpired(quote) : convert(quote)
                        }
                      >
                        Convert
                      </SmallButton>
                      <SmallButton onClick={() => reQuote(quote)}>Re-quote</SmallButton>
                      {mayCancel && (
                        <SmallButton
                          tone="bad"
                          onClick={() => {
                            setCancelling(quote);
                            setReason('');
                          }}
                        >
                          Cancel
                        </SmallButton>
                      )}
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <QuoteSlip quoteId={slip} onClose={() => setSlip(null)} />

      {/* An expired quote is a promise the shop no longer has to keep, so
          turning it into a sale is a fresh one and is confirmed, not assumed. */}
      <Modal
        open={expired !== null}
        onClose={() => setExpired(null)}
        title="This quotation has expired"
        width="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setExpired(null)}>
              Not now
            </Button>
            <Button
              fullWidth
              onClick={() => {
                if (expired) convert(expired);
                setExpired(null);
              }}
            >
              Convert anyway
            </Button>
          </div>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          {expired?.quoteNo} held its prices only until {expired?.validUntil}. The lines still go
          on the sale at the old prices — check them against today&apos;s first, or re-quote it
          instead.
        </p>
      </Modal>

      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={`Cancel ${cancelling?.quoteNo ?? 'this quotation'}`}
        width="sm"
        footer={
          <Button fullWidth variant="danger" disabled={!reason.trim()} onClick={confirmCancel}>
            Cancel quotation
          </Button>
        }
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
          The quotation stays on the record as cancelled and can never be converted. A reason is
          required so it can be traced later.
        </p>
        <Field
          label="Reason"
          placeholder="Customer bought it elsewhere, price too high"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmCancel();
          }}
        />
      </Modal>
    </div>
  );
}

function SmallButton({
  onClick,
  children,
  tone,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'bad';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-10 rounded border px-2.5 text-[12px] font-semibold',
        tone === 'bad'
          ? 'border-bad/40 bg-bad/5 text-bad hover:border-bad'
          : 'border-line bg-raised hover:border-accent',
      )}
    >
      {children}
    </button>
  );
}
