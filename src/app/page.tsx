'use client';

import { useMemo } from 'react';

import { DailyCloses } from '@/components/dashboard/DailyCloses';
import { SetupChecklist } from '@/components/today/SetupChecklist';
import { businessDate, peso } from '@/lib/format';
import { formatQty } from '@/lib/qty';
import { daySummary } from '@/lib/today';
import { TENDER_LABELS, TENDER_METHODS } from '@/lib/types';
import { can } from '@/lib/permissions';
import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';

export default function TodayPage() {
  const orders = usePos((s) => s.orders);
  const products = usePos((s) => s.products);
  const lowStockOf = usePos((s) => s.lowStock);
  const settings = usePos((s) => s.settings);
  // Low stock is the owner's working list; staff see the day's money only.
  const isOwner = useAuth((s) => can(s.session, 'inventory.manage'));
  // Past days' summaries are reports; staff see today's money only.
  const seesSummaries = useAuth((s) => can(s.session, 'reports.view'));

  const day = businessDate(Date.now());
  const s = useMemo(() => daySummary(orders, day), [orders, day]);
  const taken = TENDER_METHODS.filter((m) => s.collected[m] > 0);

  const lowStock = isOwner ? lowStockOf() : [];
  const names = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);

  return (
    <div className="scroll-y h-full">
      <div className="grid gap-3 p-4">
        {isOwner && <SetupChecklist />}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          <Tile label="Net sales" value={peso(s.net, settings.currency)} big />
          <Tile label="Sales" value={String(s.sales)} />
          <Tile label="Collected" value={peso(s.collectedTotal, settings.currency)} />
          {settings.vatRegistered && <Tile label="VAT collected" value={peso(s.vat, settings.currency)} />}
          <Tile label="Expected cash in drawer" value={peso(s.expectedCash, settings.currency)} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              Sales today
            </h3>
            <dl className="flex flex-col gap-1.5">
              <Row label="Gross" value={peso(s.gross, settings.currency)} />
              {s.promoDiscount > 0 && (
                <Row label="Promo codes" value={`-${peso(s.promoDiscount, settings.currency)}`} />
              )}
              {s.ownerDiscount > 0 && (
                <Row label="Owner discounts" value={`-${peso(s.ownerDiscount, settings.currency)}`} />
              )}
              <Row label="Net sales" value={peso(s.net, settings.currency)} total />
            </dl>
            {s.cancelled > 0 && (
              <p className="mt-3 border-t border-line pt-2 text-[11.5px] text-ink-2">
                {s.cancelled} sale{s.cancelled === 1 ? '' : 's'} cancelled today -{' '}
                {peso(s.cancelledCents, settings.currency)}.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              Collected today
            </h3>
            {taken.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-ink-3">
                Nothing collected yet today.
              </p>
            ) : (
              <dl className="flex flex-col gap-1.5">
                {taken.map((m) => (
                  <div key={m} className="flex items-baseline justify-between text-[12.5px]">
                    <dt className="text-ink-2">{TENDER_LABELS[m]}</dt>
                    <dd className="tnum font-bold">{peso(s.collected[m], settings.currency)}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between border-t border-line pt-1.5 text-[12.5px]">
                  <dt className="text-ink-2">Total</dt>
                  <dd className="tnum font-bold">{peso(s.collectedTotal, settings.currency)}</dd>
                </div>
              </dl>
            )}
          </section>

          {isOwner && (
            <section className="rounded-lg border border-line bg-surface p-3.5">
              <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
                Running low
              </h3>
              {lowStock.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-ink-3">
                  Nothing is at its reorder level.
                </p>
              ) : (
                <ul className="flex list-none flex-col gap-1.5 p-0">
                  {lowStock.map((item) => (
                    <li
                      key={item.productId}
                      className="flex items-baseline justify-between gap-3 text-[12.5px]"
                    >
                      <span className="min-w-0 truncate font-semibold">
                        {names.get(item.productId) ?? item.productId}
                      </span>
                      <span className="tnum shrink-0 text-ink-2">
                        {formatQty(item.available)} left · reorder at {formatQty(item.level)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {seesSummaries && <DailyCloses />}
      </div>
    </div>
  );
}

function Row({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between text-[12.5px] ${total ? 'border-t border-line pt-1.5' : ''}`}
    >
      <dt className="text-ink-2">{label}</dt>
      <dd className="tnum font-bold">{value}</dd>
    </div>
  );
}

function Tile({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-[10.5px] font-bold tracking-wide text-ink-3 uppercase">{label}</p>
      <p className={`tnum mt-1 font-extrabold leading-none ${big ? 'text-[24px]' : 'text-[18px]'}`}>
        {value}
      </p>
    </div>
  );
}
