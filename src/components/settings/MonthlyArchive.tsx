'use client';

import { useMemo, useRef, useState } from 'react';
import { Archive, Check, Download, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { peso, fmtDate } from '@/lib/format';
import {
  archivableMonths,
  archiveFileName,
  describeBadArchive,
  monthLabel,
  type MonthlyArchive as Archived,
} from '@/lib/archive';
import { TENDER_LABELS, TENDER_METHODS } from '@/lib/types';
import { usePos } from '@/store/usePos';

/**
 * Month-end: write the month out, read it back, then let it leave the device.
 *
 * The read-back is the point. A download that silently failed or landed
 * truncated looks exactly like one that worked, and "remove from device" is
 * not a thing to do on faith — so the file has to come back in before the
 * sales go out.
 */
export function MonthlyArchive() {
  // Derived here rather than through a store method: a selector that returns
  // a fresh array re-renders forever. Same reason as DefaultPinBar.
  const orders = usePos((s) => s.orders);
  const months = useMemo(() => archivableMonths(orders), [orders]);
  const build = usePos((s) => s.buildMonthlyArchive);
  const prune = usePos((s) => s.pruneArchivedMonth);
  const currency = usePos((s) => s.settings.currency);

  const fileRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Archived | null>(null);
  const [exported, setExported] = useState<Set<string>>(new Set());
  const [confirmPrune, setConfirmPrune] = useState(false);

  function exportMonth(month: string) {
    const archive = build(month);
    const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = archiveFileName(month);
    link.click();
    // Revoking in the same tick can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setExported((prev) => new Set(prev).add(month));
    toast(`Saved ${archiveFileName(month)}`, 'success');
  }

  function openArchive(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const problem = describeBadArchive(parsed);
        if (problem) {
          toast(problem, 'danger');
          return;
        }
        setLoaded(parsed as Archived);
      } catch {
        toast('That file is not readable JSON', 'danger');
      }
    };
    reader.onerror = () => toast('Could not read that file', 'danger');
    reader.readAsText(file);
  }

  const stillOnDevice = loaded
    ? months.some((m) => m.month === loaded.month)
    : false;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-ink-2">
        At the end of each month, save it as a file and keep it somewhere safe — a
        OneDrive or Google Drive folder gives you an off-device copy automatically.
        This is your backup.
      </p>
      <p className="text-[12px] leading-relaxed text-ink-2">
        Sales stay on the device and stay searchable whether or not you save them,
        so there is no need to remove anything. If you ever do want a month gone,
        open its file here first — it can only be removed once the file has been
        checked against what is on the device.
      </p>

      {months.length === 0 ? (
        <p className="rounded-md border border-line bg-raised px-3 py-2.5 text-[12.5px] text-ink-3">
          No finished months yet. The month in progress stays on the device until
          it ends.
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {months.map(({ month, orders, net }) => (
            <li
              key={month}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-raised px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">
                  {monthLabel(month)}
                </span>
                <span className="text-[11px] text-ink-3">
                  {orders} sale{orders === 1 ? '' : 's'} · {peso(net, currency)}
                </span>
              </span>
              {exported.has(month) && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-good">
                  <Check size={12} aria-hidden />
                  Saved
                </span>
              )}
              <Button size="sm" variant="secondary" onClick={() => exportMonth(month)}>
                <Download size={13} aria-hidden />
                {exported.has(month) ? 'Save again' : 'Save file'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" fullWidth onClick={() => fileRef.current?.click()}>
          <FolderOpen size={14} aria-hidden />
          Open a saved month
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) openArchive(file);
          e.target.value = '';
        }}
      />

      <Modal
        open={loaded !== null}
        onClose={() => setLoaded(null)}
        title={loaded ? monthLabel(loaded.month) : ''}
        width="lg"
        footer={
          stillOnDevice ? (
            <Button fullWidth variant="danger" onClick={() => setConfirmPrune(true)}>
              <Archive size={14} aria-hidden />
              Remove this month from the device
            </Button>
          ) : (
            <Button fullWidth variant="secondary" onClick={() => setLoaded(null)}>
              Close
            </Button>
          )
        }
      >
        {loaded && <Summary archive={loaded} currency={currency} onDevice={stillOnDevice} />}
      </Modal>

      <Modal
        open={confirmPrune}
        onClose={() => setConfirmPrune(false)}
        title="Remove month from device"
        width="sm"
        footer={
          <Button
            fullWidth
            variant="danger"
            onClick={() => {
              if (!loaded) return;
              const result = prune(loaded);
              setConfirmPrune(false);
              if (result.ok) {
                setLoaded(null);
                toast(`${monthLabel(loaded.month)} removed from this device`, 'success');
              } else {
                toast(result.error, 'danger');
              }
            }}
          >
            Yes, remove it
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          {loaded && (
            <>
              <strong>{monthLabel(loaded.month)}</strong> —{' '}
              {loaded.totals.orders + loaded.totals.voided} sales — will be deleted
              from this device. The file you just opened becomes the only copy.
            </>
          )}
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          You do not have to do this — keeping the month costs you nothing in
          speed. Only remove it if you want the device tidy. Afterwards you can
          still reopen the file here for the numbers, but those sales will no
          longer show on the Orders page or the Dashboard.
        </p>
      </Modal>
    </div>
  );
}

function Summary({
  archive,
  currency,
  onDevice,
}: {
  archive: Archived;
  currency: string;
  onDevice: boolean;
}) {
  const t = archive.totals;
  const topProducts = t.byProduct.slice(0, 8);
  const maxRevenue = topProducts[0]?.revenue ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-ink-3">
        Saved {fmtDate(Date.parse(archive.exportedAt))} · {archive.businessName}
        {!onDevice && ' · already removed from this device'}
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
        <Cell label="Net sales" value={peso(t.net, currency)} big />
        <Cell label="Sales" value={String(t.orders)} />
        <Cell label="Gross profit" value={peso(t.grossProfit, currency)} />
        <Cell label="Discounts" value={peso(t.discount, currency)} />
        {t.vat > 0 && <Cell label="Output VAT" value={peso(t.vat, currency)} />}
        <Cell label="Voided" value={String(t.voided)} />
      </div>

      {t.busiestDay && (
        <p className="text-[12px] text-ink-2">
          Best day was <strong>{t.busiestDay.date}</strong> at{' '}
          {peso(t.busiestDay.net, currency)}.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h4 className="mb-2 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
            Collected by tender
          </h4>
          <dl className="flex flex-col gap-1">
            {TENDER_METHODS.filter((m) => t.byTender[m] > 0).map((m) => (
              <div key={m} className="flex justify-between text-[12.5px]">
                <dt className="text-ink-2">{TENDER_LABELS[m]}</dt>
                <dd className="tnum font-bold">{peso(t.byTender[m], currency)}</dd>
              </div>
            ))}
          </dl>

          {t.byBranch.length > 1 && (
            <>
              <h4 className="mt-3 mb-2 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
                By branch
              </h4>
              <dl className="flex flex-col gap-1">
                {t.byBranch.map((b) => (
                  <div key={b.branchId} className="flex justify-between text-[12.5px]">
                    <dt className="min-w-0 truncate text-ink-2">{b.name}</dt>
                    <dd className="tnum shrink-0 font-bold">{peso(b.net, currency)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[10.5px] font-bold tracking-wide text-ink-2 uppercase">
            Best sellers
          </h4>
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {topProducts.map((p) => (
              <li key={p.productId} className="flex flex-col gap-1">
                <span className="flex justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="tnum shrink-0 text-ink-2">
                    {p.qty} · {peso(p.revenue, currency)}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="h-1 rounded-full bg-accent"
                  style={{ width: `${Math.max(4, (p.revenue / maxRevenue) * 100)}%` }}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Cell({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-raised p-2.5">
      <p className="text-[10px] font-bold tracking-wide text-ink-3 uppercase">{label}</p>
      <p className={cn('tnum mt-0.5 leading-none font-extrabold', big ? 'text-[19px]' : 'text-[15px]')}>
        {value}
      </p>
    </div>
  );
}
