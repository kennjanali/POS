'use client';

import { useMemo, useState } from 'react';

import { cn } from '@/components/ui/cn';
import { businessDate, peso } from '@/lib/format';
import { cents, scale } from '@/lib/money';
import { TENDER_LABELS, TENDER_METHODS, type TenderMethod } from '@/lib/types';
import { usePos } from '@/store/usePos';

/**
 * Technology fee. Accrues on every settled sale and is invoiced once a year,
 * so the headline below is the calendar year to date rather than whatever
 * range the buttons are on.
 *
 * Charged on net sales — what the business actually took, after senior, PWD
 * and custom discounts — not on the menu-price total, so it never bills on
 * money the carinderia never received.
 */
const TECH_FEE_RATE = 0.03;

type Range = 'today' | '7d' | '30d' | 'all';

const RANGES: { key: Range; label: string; days: number | null }[] = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
];

export default function DashboardPage() {
  const orders = usePos((s) => s.orders);
  const products = usePos((s) => s.products);
  const settings = usePos((s) => s.settings);
  const branchId = usePos((s) => s.activeBranchId);
  const branches = usePos((s) => s.branches);

  const [range, setRange] = useState<Range>('today');

  const stats = useMemo(() => {
    const spec = RANGES.find((r) => r.key === range);
    const now = Date.now();
    const today = businessDate(now);

    const inRange = (at: number) => {
      if (spec?.days === 0) return businessDate(at) === today;
      if (spec?.days == null) return true;
      return at >= now - spec.days * 86_400_000;
    };
    const closedInRange = orders.filter(
      (o) => o.status === 'closed' && inRange(o.closedAt ?? o.openedAt),
    );
    const scoped = closedInRange.filter((o) => o.branchId === branchId);

    let net = 0;
    let discount = 0;
    let vat = 0;
    let cost = 0;
    const byTender: Record<TenderMethod, number> = {
      cash: 0,
      gcash: 0,
      maya: 0,
      card: 0,
      bank: 0,
      other: 0,
    };
    const byProduct = new Map<string, { qty: number; revenue: number }>();

    for (const order of scoped) {
      net += order.netCents;
      discount += order.discountCents;
      vat += order.vatCents;
      for (const tender of order.tenders) {
        byTender[tender.method] += tender.amountCents;
      }
      for (const line of order.lines) {
        if (!line.served || line.voided) continue;
        // Cost as it stood when the sale happened. Falling back to the
        // product's current cost is only for lines written before the field
        // existed — for anything since, re-pricing the menu must not rewrite
        // last month's margin.
        const historic = line.costCents;
        cost +=
          (historic ?? products.find((p) => p.id === line.productId)?.costCents ?? 0) *
          line.qty;
        const entry = byProduct.get(line.productId) ?? { qty: 0, revenue: 0 };
        entry.qty += line.qty;
        entry.revenue += line.unitCents * line.qty;
        byProduct.set(line.productId, entry);
      }
    }

    const top = [...byProduct.entries()]
      .map(([id, v]) => ({
        name: products.find((p) => p.id === id)?.name ?? id,
        ...v,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // Voids belong to the window the void happened in, like every other tile
    // here. Left unfiltered, "Today" reported every void ever recorded.
    const voided = orders.filter(
      (o) =>
        o.status === 'voided' &&
        o.branchId === branchId &&
        inRange(o.voidedAt ?? o.closedAt ?? o.openedAt),
    ).length;

    // Every branch over the same window, so the figures on screen can be
    // compared without switching the till back and forth.
    const byBranch = branches.map((branch) => {
      const rows = closedInRange.filter((o) => o.branchId === branch.id);
      const branchNet = rows.reduce((sum, o) => sum + o.netCents, 0);
      return {
        branch,
        count: rows.length,
        net: branchNet,
        average: rows.length ? Math.round(branchNet / rows.length) : 0,
      };
    });

    // Fee bases. Both span every branch on this install: it is one licence
    // and one yearly invoice, not a per-branch charge, so scoping these to
    // the branch on screen would under-report what is owed.
    const feeRangeBase = closedInRange.reduce((sum, o) => sum + o.netCents, 0);
    const year = today.slice(0, 4);
    const feeYearBase = orders.reduce(
      (sum, o) =>
        o.status === 'closed' &&
        businessDate(o.closedAt ?? o.openedAt).slice(0, 4) === year
          ? sum + o.netCents
          : sum,
      0,
    );

    // An empty range and an empty till look identical on screen, and one of
    // them means "nothing sold yet this morning" while the other means
    // something is wrong. Counting what is on the device tells them apart.
    const onDevice = orders.filter(
      (o) => o.status === 'closed' && o.branchId === branchId,
    ).length;

    return {
      onDevice,
      byBranch,
      year,
      feeRangeBase,
      feeYearBase,
      count: scoped.length,
      net,
      discount,
      vat,
      cost,
      grossProfit: net - vat - cost,
      average: scoped.length ? Math.round(net / scoped.length) : 0,
      byTender,
      top,
      voided,
    };
  }, [orders, products, range, branchId, branches]);

  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';
  const maxRevenue = stats.top[0]?.revenue ?? 1;
  const maxBranchNet = Math.max(1, ...stats.byBranch.map((b) => b.net));

  return (
    <div className="scroll-y h-full">
      <div className="flex flex-wrap gap-1 border-b border-line bg-surface px-4 py-2.5">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={range === r.key}
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
              range === r.key
                ? 'border-accent bg-accent text-white'
                : 'border-line bg-raised text-ink-2 hover:bg-ground',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 p-4">
        {stats.count === 0 && stats.onDevice > 0 && (
          <p className="rounded-lg border border-info/40 bg-info/5 px-3.5 py-3 text-[12.5px] leading-relaxed">
            <strong>No settled sales in this period.</strong>{' '}
            <span className="text-ink-2">
              This branch has {stats.onDevice.toLocaleString('en-PH')} on the device
              overall — pick a wider range above to see them. Only paid-up sales
              count here, so tables still open on the floor are not included.
            </span>
          </p>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          <Stat label="Net sales" value={peso(cents(stats.net), settings.currency)} big />
          <Stat label="Orders" value={String(stats.count)} />
          <Stat
            label="Average order"
            value={peso(cents(stats.average), settings.currency)}
          />
          <Stat
            label="Gross profit"
            value={peso(cents(stats.grossProfit), settings.currency)}
            tone={stats.grossProfit >= 0 ? 'good' : 'bad'}
          />
          <Stat
            label="Discounts given"
            value={peso(cents(stats.discount), settings.currency)}
            tone="note"
          />
          {settings.vatRegistered && (
            <Stat label="Output VAT" value={peso(cents(stats.vat), settings.currency)} />
          )}
          <Stat label="Voided orders" value={String(stats.voided)} tone="bad" />
        </div>

        {stats.byBranch.length > 1 && (
          <section className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              By branch
            </h3>
            <ul className="flex list-none flex-col gap-2.5 p-0">
              {stats.byBranch.map(({ branch, count, net, average }) => (
                <li key={branch.id} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: branch.color }}
                      />
                      <span className="truncate font-semibold">{branch.name}</span>
                      {branch.id === branchId && (
                        <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-accent uppercase">
                          On till
                        </span>
                      )}
                    </span>
                    <span className="tnum shrink-0">
                      <strong>{peso(cents(net), settings.currency)}</strong>
                      <span className="ml-2 text-ink-3">
                        {count} order{count === 1 ? '' : 's'} · avg{' '}
                        {peso(cents(average), settings.currency)}
                      </span>
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="h-1 rounded-full"
                    style={{
                      background: branch.color,
                      width: `${Math.max(2, (net / maxBranchNet) * 100)}%`,
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Tender breakdown — this IS the Z-reading breakdown BIR wants. */}
          <section className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              Collected by tender
            </h3>
            <dl className="flex flex-col gap-1.5">
              {TENDER_METHODS.map((m) => (
                <div key={m} className="flex items-baseline justify-between text-[12.5px]">
                  <dt className="text-ink-2">{TENDER_LABELS[m]}</dt>
                  <dd className="tnum font-bold">
                    {peso(cents(stats.byTender[m]), settings.currency)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-3">
              Reconcile the GCash and Maya figures against the wallet statement before
              closing. Reference numbers are on each order in the history.
            </p>
          </section>

          <section className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              Best sellers
            </h3>
            {stats.top.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-ink-3">
                No sales in this period yet.
              </p>
            ) : (
              <ul className="flex list-none flex-col gap-2 p-0">
                {stats.top.map((item) => (
                  <li key={item.name} className="flex flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
                      <span className="min-w-0 truncate font-semibold">{item.name}</span>
                      <span className="tnum shrink-0 text-ink-2">
                        {item.qty} · {peso(cents(item.revenue), settings.currency)}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="h-1 rounded-full bg-accent"
                      style={{
                        width: `${Math.max(4, (item.revenue / maxRevenue) * 100)}%`,
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Technology fee. Third child of a two-column grid, so it sits
              under the tender card rather than beside it. */}
          <section className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
              Technology fee
            </h3>

            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-semibold text-ink-2">
                {stats.year} to date
              </span>
              <span className="tnum text-[22px] leading-none font-extrabold text-accent">
                {peso(
                  scale(cents(stats.feeYearBase), TECH_FEE_RATE),
                  settings.currency,
                )}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
              {(TECH_FEE_RATE * 100).toFixed(0)}% of{' '}
              {peso(cents(stats.feeYearBase), settings.currency)} in net sales, across
              every branch on this device.
            </p>

            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
              <span className="text-[12.5px] text-ink-2">{rangeLabel}</span>
              <span className="tnum text-[13px] font-bold">
                {peso(
                  scale(cents(stats.feeRangeBase), TECH_FEE_RATE),
                  settings.currency,
                )}
              </span>
            </div>

            <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-3">
              Billed once a year. This is what keeps the POS maintained — security
              fixes, changes to BIR rules, and new features — so the till you are
              running stays supported instead of frozen on the day it shipped.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'good' | 'bad' | 'note';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-[10.5px] font-bold tracking-wide text-ink-3 uppercase">
        {label}
      </p>
      <p
        className={cn(
          'tnum mt-1 leading-none font-extrabold',
          big ? 'text-[24px]' : 'text-[18px]',
          tone === 'good' && 'text-good',
          tone === 'bad' && 'text-bad',
          tone === 'note' && 'text-note',
        )}
      >
        {value}
      </p>
    </div>
  );
}
