'use client';

import { useRef, useState } from 'react';
import { Download, FlaskConical, Info, Upload } from 'lucide-react';

import { BranchManager } from '@/components/settings/BranchManager';
import { LicenseSettings } from '@/components/settings/LicenseSettings';
import { MonthlyArchive } from '@/components/settings/MonthlyArchive';
import { PrinterSettings } from '@/components/settings/PrinterSettings';
import { RecoveryCode } from '@/components/settings/RecoveryCode';
import { UserManager } from '@/components/settings/UserManager';
import { Button } from '@/components/ui/Button';
import { Field, Toggle } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { computeBill } from '@/lib/tax';
import { cents } from '@/lib/money';
import { peso, fmtDate } from '@/lib/format';
import { backupFileName, saveBackup } from '@/lib/backup';
import { canShareFiles, SAVE_LOCATION, shareSavedFile } from '@/lib/files';
import { PRESETS, type Features } from '@/lib/presets';
import { formatQty, qty } from '@/lib/qty';
import type { DataSnapshot, Settings } from '@/lib/types';
import { usePos } from '@/store/usePos';

/** One toggle per switch, in plain words. */
const FEATURE_LABELS: Record<keyof Features, string> = {
  openOrders: 'Tables / jobs stay open until paid',
  serveStep: 'Serve items before payment',
  services: 'Sell services, not only items',
  quotes: 'Make quotations',
  vehiclePlate: 'Write the plate number on tickets',
  measuredUnits: 'Sell by the metre or kilo (2.5 m, 0.75 kg)',
};

export default function SettingsPage() {
  const settings = usePos((s) => s.settings);
  const updateSettings = usePos((s) => s.updateSettings);
  const update = (patch: Partial<Settings>) => {
    const result = updateSettings(patch);
    if (!result.ok) toast(result.error, 'danger');
  };
  const licensed = usePos((s) => s.licensed !== null);
  const exportSnapshot = usePos((s) => s.exportSnapshot);
  const importSnapshot = usePos((s) => s.importSnapshot);
  const resetAll = usePos((s) => s.resetAll);
  const recordBackup = usePos((s) => s.recordBackup);
  const lastBackupAt = usePos((s) => s.lastBackupAt);
  const loadDemoData = usePos((s) => s.loadDemoData);
  const audit = usePos((s) => s.audit);
  const users = usePos((s) => s.users);

  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmGoLive, setConfirmGoLive] = useState(false);

  // Live worked example so the owner can see what the tax settings actually do.
  const sample = cents(50_000);
  const plain = computeBill(sample, settings, { kind: 'none' });
  const discounted = computeBill(sample, settings, { kind: 'percent', percent: 10 });

  async function download() {
    if (!(await saveBackup(exportSnapshot()))) {
      toast('The backup could not be saved. Check storage and download settings.', 'danger');
      return;
    }
    // Recorded here too, so saving from Settings clears the reminder the
    // same way the automatic backup does.
    recordBackup();
    toast(`Backup saved to ${SAVE_LOCATION}`, 'success');
    // On the tablet, hand it straight to Drive or Messenger: a file on the
    // same device is not yet a copy that survives losing it.
    if (canShareFiles()) {
      await shareSavedFile(backupFileName()).catch(() => undefined);
    }
  }

  function upload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as DataSnapshot;
        // The store validates the contents and refuses anything it cannot
        // safely restore over the books — this only has to survive the parse.
        const result = importSnapshot(parsed);
        if (result.ok) {
          toast(`Restored ${parsed.orders?.length ?? 0} orders`, 'success');
        } else {
          toast(result.error, 'danger');
        }
      } catch {
        toast('That file is not readable JSON', 'danger');
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
          : 'Only available in training mode',
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
            label="Receipt footer"
            value={settings.receiptFooter}
            onChange={(e) => update({ receiptFooter: e.target.value })}
          />
        </Section>

        {/* ── License ──────────────────────────────────────────── */}
        <Section title="License">
          <LicenseSettings />
        </Section>

        {/* ── Tax ──────────────────────────────────────────────── */}
        <Section title="Tax">
          <Toggle
            label="VAT registered"
            hint="A business under PHP 3M annual gross usually files percentage tax instead. Leave this off if you are not VAT-registered — charging VAT without registration is its own problem."
            checked={settings.vatRegistered}
            onChange={(vatRegistered) => update({ vatRegistered })}
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
                {settings.vatRegistered &&
                  ` — ${settings.vatLabel} ${peso(plain.vat, settings.currency)} included`}
              </p>
              <p>
                With a 10% discount, pays{' '}
                <strong className="tnum">
                  {peso(discounted.amountDue, settings.currency)}
                </strong>
                {settings.vatRegistered &&
                  ` — ${settings.vatLabel} ${peso(discounted.vat, settings.currency)} included`}
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
            value={formatQty(settings.lowStockAt)}
            onChange={(e) => update({ lowStockAt: qty(Number(e.target.value) || 0) })}
          />
          <Toggle
            label="Training mode"
            hint={
              !settings.trainingMode
                ? 'This install is live. Training mode cannot be turned back on, so fabricated sales can never be written over the books.'
                : licensed
                  ? 'Marks every slip as training, and unlocks Load and Remove demo data. Turning this off is permanent — it cannot be switched back on.'
                  : 'Activate a license below to go live. Until then every slip is marked as training.'
            }
            checked={settings.trainingMode}
            disabled={!settings.trainingMode || !licensed}
            onChange={() => setConfirmGoLive(true)}
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

        {/* ── Receipt printer ──────────────────────────────────── */}
        <Section title="Receipt printer">
          <PrinterSettings />
        </Section>

        {/* ── Recovery code ────────────────────────────────────── */}
        <Section title="Recovery code">
          <RecoveryCode />
        </Section>

        {/* ── Monthly archive ──────────────────────────────────── */}
        <Section title="Monthly archive" className="lg:col-span-2">
          <MonthlyArchive />
        </Section>

        {/* ── Data ─────────────────────────────────────────────── */}
        <Section title="Data">
          <p className="text-[12px] leading-relaxed text-ink-2">
            Every sale is saved to this device the moment it happens. A backup is
            the second copy — save one at the end of each trading day and keep it
            in a OneDrive or Google Drive folder.
          </p>
          <p className="text-[12px] font-semibold">
            {lastBackupAt
              ? `Last backup: ${fmtDate(lastBackupAt)}`
              : 'No backup has ever been saved from this device.'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => void download()}>
              <Download size={14} aria-hidden />
              {canShareFiles() ? 'Save and share backup' : 'Download backup'}
            </Button>
            <Button variant="secondary" fullWidth onClick={() => fileRef.current?.click()}>
              <Upload size={14} aria-hidden />
              Restore
            </Button>
          </div>
          {licensed && <CloudBackupNow />}
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
                : 'Only available in training mode'
            }
          >
            <FlaskConical size={14} aria-hidden />
            Load demo data
          </Button>
          <Button
            variant="danger"
            fullWidth
            disabled={!settings.trainingMode}
            onClick={() => setConfirmReset(true)}
            title={
              settings.trainingMode
                ? undefined
                : 'Only available in training mode'
            }
          >
            Remove demo data
          </Button>
          {!settings.trainingMode && (
            <p className="text-[11px] leading-relaxed text-ink-3">
              Demo data is a training-mode tool. This install is live, so sales
              cannot be loaded or wiped from here — restore a backup instead.
            </p>
          )}
        </Section>

        {/* ── More options ─────────────────────────────────────── */}
        <Section title="More options">
          <p className="text-[12px] leading-relaxed text-ink-2">
            Your shop type ({PRESETS[settings.shopType].label}) set these. Change any of them here.
          </p>
          {(Object.keys(FEATURE_LABELS) as (keyof Features)[]).map((key) => (
            <Toggle
              key={key}
              label={FEATURE_LABELS[key]}
              checked={settings.features[key]}
              onChange={(on) => update({ features: { ...settings.features, [key]: on } })}
            />
          ))}
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
        title="Load demo data"
        width="sm"
        footer={
          <Button fullWidth onClick={loadDemo}>
            Load demo data
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Writes 30 days of pretend trading — roughly 40 orders a day across three
          branches, with some owner discounts, every tender type, a few
          voided sales, and live tables on the floor right now. Today is included,
          so the Dashboard has something to show straight away.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          <strong>Every order, stock movement and order number already on this
          device is replaced.</strong>{' '}
          Menu items and settings are kept, and branches you added yourself stay.
        </p>
      </Modal>

      <Modal
        open={confirmGoLive}
        onClose={() => setConfirmGoLive(false)}
        title="Turn off training mode"
        width="sm"
        footer={
          <Button
            fullWidth
            variant="danger"
            onClick={() => {
              update({ trainingMode: false });
              setConfirmGoLive(false);
              toast('Training mode is off — this install is now live', 'success');
            }}
          >
            Go live — this cannot be undone
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Order slips stop being marked <strong>TRAINING MODE</strong> and every sale
          starts counting for real.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          <strong>This is permanent.</strong> Training mode cannot be turned back
          on, and with it off the demo loader and &ldquo;Clear all sales
          data&rdquo; are locked for good — so fabricated sales can never be
          written over your books.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          Clear out any practice sales <em>before</em> you do this.
        </p>
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Remove demo data"
        width="sm"
        footer={
          <Button
            fullWidth
            variant="danger"
            onClick={() => {
              const cleared = resetAll();
              setConfirmReset(false);
              toast(
                cleared
                  ? 'Demo data removed'
                  : 'Only available in training mode',
                cleared ? 'success' : 'danger',
              );
            }}
          >
            Yes, remove it
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Removes every order and stock movement on this device, leaving an empty
          till to practise on. Menu items, branches, staff and settings all stay,
          the activity log keeps a note that this happened, and invoice numbers
          carry on rather than restarting. This cannot be undone.
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

/** The nightly cloud copy, on demand — say, before a tablet goes in for repair. */
function CloudBackupNow() {
  const lastCloudBackupAt = usePos((s) => s.lastCloudBackupAt);
  const upload = usePos((s) => s.uploadCloudBackup);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await upload();
    setBusy(false);
    if (result.ok) toast('Encrypted backup saved to the cloud.', 'success');
    else toast(result.error, 'danger');
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-[12px] font-semibold">
        {lastCloudBackupAt
          ? `Last cloud backup: ${fmtDate(lastCloudBackupAt)}`
          : 'Nothing backed up to the cloud yet. It happens by itself each night.'}
      </p>
      <Button variant="secondary" disabled={busy} onClick={() => void run()}>
        <Upload size={14} aria-hidden />
        {busy ? 'Backing up…' : 'Back up to the cloud now'}
      </Button>
    </div>
  );
}
