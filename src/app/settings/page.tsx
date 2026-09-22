'use client';

import { useRef, useState } from 'react';
import { Download, FlaskConical, Info, Upload } from 'lucide-react';

import { BranchManager } from '@/components/settings/BranchManager';
import { UserManager } from '@/components/settings/UserManager';
import { Button } from '@/components/ui/Button';
import { Field, Toggle } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { computeBill } from '@/lib/tax';
import { cents } from '@/lib/money';
import { peso } from '@/lib/format';
import type { DataSnapshot } from '@/lib/types';
import { usePos } from '@/store/usePos';

export default function SettingsPage() {
  const settings = usePos((s) => s.settings);
  const update = usePos((s) => s.updateSettings);
  const exportSnapshot = usePos((s) => s.exportSnapshot);
  const importSnapshot = usePos((s) => s.importSnapshot);
  const resetAll = usePos((s) => s.resetAll);
  const loadDemoData = usePos((s) => s.loadDemoData);
  const audit = usePos((s) => s.audit);
  const users = usePos((s) => s.users);

  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);

  // Live worked example so the owner can see what the tax settings actually do.
  const sample = cents(50_000);
  const plain = computeBill(sample, settings, { kind: 'none' });
  const senior = computeBill(sample, settings, { kind: 'senior' });

  function download() {
    const snapshot = exportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kramgen-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded', 'success');
  }

  function upload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as DataSnapshot;
        if (!Array.isArray(parsed.products)) throw new Error('Not a KRAMGEN backup');
        importSnapshot(parsed);
        toast(`Restored ${parsed.orders?.length ?? 0} orders`, 'success');
      } catch {
        toast('That file is not a KRAMGEN backup', 'danger');
      }
    };
    reader.onerror = () => toast('Could not read that file', 'danger');
    reader.readAsText(file);
  }

  function loadDemo() {
    setConfirmDemo(false);
    toast('Building a month of demo trading...');
    // A month across three branches is a few thousand orders. Yield first so
    // the toast actually paints before the main thread goes away.
    window.setTimeout(() => {
      const count = loadDemoData();
      toast(
        count > 0
          ? `Loaded ${count.toLocaleString('en-PH')} demo orders`
          : 'Demo data is only available in training mode',
        count > 0 ? 'success' : 'danger',
      );
    }, 50);
  }

  return (
    <div className="scroll-y h-full">
      <div className="mx-auto grid max-w-4xl gap-4 p-4 lg:grid-cols-2">
        {/* ── Business ─────────────────────────────────────────── */}
        <Section title="Business">
          <Field
            label="Business name"
            value={settings.businessName}
            onChange={(e) => update({ businessName: e.target.value })}
          />
          <Field
            label="Address"
            value={settings.address}
            onChange={(e) => update({ address: e.target.value })}
          />
          <Field
            label="TIN"
            placeholder="000-000-000-00000"
            hint="Printed on the receipt header."
            value={settings.tin}
            onChange={(e) => update({ tin: e.target.value })}
          />
          <Field
            label="Receipt footer"
            value={settings.receiptFooter}
            onChange={(e) => update({ receiptFooter: e.target.value })}
          />
        </Section>

        {/* ── Tax ──────────────────────────────────────────────── */}
        <Section title="Tax">
          <Toggle
            label="VAT registered"
            hint="A business under PHP 3M annual gross usually files percentage tax instead. Leave this off if you are not VAT-registered — charging VAT without registration is its own problem."
            checked={settings.vatRegistered}
            onChange={(vatRegistered) => update({ vatRegistered })}
          />
          <Toggle
            label="Menu prices include VAT"
            hint="On a carinderia menu board they almost always do."
            checked={settings.pricesIncludeVat}
            onChange={(pricesIncludeVat) => update({ pricesIncludeVat })}
          />
          <Field
            label="VAT rate"
            type="number"
            min={0}
            max={100}
            step={0.5}
            suffix="%"
            value={(settings.vatRate * 100).toFixed(1)}
            onChange={(e) => update({ vatRate: (Number(e.target.value) || 0) / 100 })}
          />
          <Field
            label="VAT label"
            value={settings.vatLabel}
            onChange={(e) => update({ vatLabel: e.target.value })}
          />

          <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-2.5">
            <Info size={13} className="mt-0.5 shrink-0 text-info" aria-hidden />
            <div className="min-w-0 text-[11.5px] leading-relaxed">
              <p className="mb-1 font-bold">
                On a {peso(sample, settings.currency)} bill, right now:
              </p>
              <p>
                Regular customer pays{' '}
                <strong className="tnum">
                  {peso(plain.amountDue, settings.currency)}
                </strong>
              </p>
              <p>
                Senior / PWD pays{' '}
                <strong className="tnum">
                  {peso(senior.amountDue, settings.currency)}
                </strong>{' '}
                — 20% off the VAT-exclusive amount, VAT-exempt (RA 9994 / RA 10754).
              </p>
            </div>
          </div>
        </Section>

        {/* ── Floor ────────────────────────────────────────────── */}
        <Section title="Floor">
          <Toggle
            label="Show stock on menu tiles"
            checked={settings.showStock}
            onChange={(showStock) => update({ showStock })}
          />
          <Field
            label="Low stock warning at"
            type="number"
            min={0}
            suffix="units"
            value={settings.lowStockAt}
            onChange={(e) => update({ lowStockAt: Number(e.target.value) || 0 })}
          />
          <Toggle
            label="Training mode"
            hint="Marks every receipt as not valid. Once the POS is BIR-registered it may not be switched back into training mode — turn this off at go-live and leave it off."
            checked={settings.trainingMode}
            onChange={(trainingMode) => update({ trainingMode })}
          />
        </Section>

        {/* ── Branches ─────────────────────────────────────────── */}
        <Section title="Branches" className="lg:col-span-2">
          <BranchManager />
        </Section>

        {/* ── Users ────────────────────────────────────────────── */}
        <Section title="Users" className="lg:col-span-2">
          <UserManager />
        </Section>

        {/* ── Data ─────────────────────────────────────────────── */}
        <Section title="Data">
          <p className="text-[12px] leading-relaxed text-ink-2">
            Sales are stored in this browser. Download a backup at the end of every
            trading day — there is no automatic copy anywhere else yet.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={download}>
              <Download size={14} aria-hidden />
              Download backup
            </Button>
            <Button variant="secondary" fullWidth onClick={() => fileRef.current?.click()}>
              <Upload size={14} aria-hidden />
              Restore
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            fullWidth
            disabled={!settings.trainingMode}
            onClick={() => setConfirmDemo(true)}
            title={
              settings.trainingMode
                ? undefined
                : 'Turn training mode on to load demo data'
            }
          >
            <FlaskConical size={14} aria-hidden />
            Load demo month
          </Button>
          <Button variant="danger" fullWidth onClick={() => setConfirmReset(true)}>
            Clear all sales data
          </Button>
        </Section>

        {/* ── Audit ────────────────────────────────────────────── */}
        <Section title="Activity" className="lg:col-span-2">
          {audit.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">Nothing recorded yet.</p>
          ) : (
            <ul className="scroll-y flex max-h-64 list-none flex-col gap-1 p-0">
              {audit.slice(0, 60).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline gap-2 border-b border-line/60 py-1 text-[12px]"
                >
                  <span className="tnum shrink-0 text-ink-3">
                    {new Date(entry.at).toLocaleTimeString('en-PH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="min-w-0 flex-1">{entry.message}</span>
                  {/* Who did it. Blank on entries written before this device
                      had users, and on demo data. */}
                  <span className="shrink-0 text-[11px] font-semibold text-ink-3">
                    {users.find((u) => u.id === entry.actorUserId)?.name ?? ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Modal
        open={confirmDemo}
        onClose={() => setConfirmDemo(false)}
        title="Load demo month"
        width="sm"
        footer={
          <Button fullWidth onClick={loadDemo}>
            Replace with demo data
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Writes 30 days of trading — roughly 40 orders a day across three branches,
          with senior, PWD and custom discounts, every tender type, a few voided
          sales, and live tables on the floor right now.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          <strong>Every existing order, stock movement and invoice number is
          replaced.</strong>{' '}
          Products and settings are kept, and branches you added yourself stay.
          Download a backup first if this device has real sales on it.
        </p>
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Clear all sales data"
        width="sm"
        footer={
          <Button
            fullWidth
            variant="danger"
            onClick={() => {
              resetAll();
              setConfirmReset(false);
              toast('Sales data cleared', 'success');
            }}
          >
            Yes, clear everything
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Every order, stock movement, and activity entry on this device is removed and
          the invoice sequence restarts. Download a backup first if you might need this
          history. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-line bg-surface p-4 ${className ?? ''}`}
    >
      <h2 className="mb-3 text-[11px] font-bold tracking-wide text-ink-2 uppercase">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
