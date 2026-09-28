'use client';

import { useState } from 'react';
import { CloudDownload } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { downloadBackup, listBackups, openBackup, type CloudBackup } from '@/lib/cloudBackup';
import { usePos } from '@/store/usePos';

/**
 * A replacement tablet: bring the books back from the nightly cloud backup
 * instead of starting over. The license key finds the backups; the recovery
 * code is the only thing that can open them. Staff sign in with the PINs
 * they already had.
 */
export function RestoreBackup({ onCancel }: { onCancel: () => void }) {
  const setupFromBackup = usePos((s) => s.setupFromBackup);
  const activate = usePos((s) => s.activate);

  const [licenseKey, setLicenseKey] = useState('');
  const [code, setCode] = useState('');
  const [backups, setBackups] = useState<CloudBackup[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Something went wrong.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  const find = () =>
    run(async () => {
      const found = await listBackups(licenseKey);
      if (found.length === 0) throw new Error('No backups found for that license yet.');
      setBackups(found);
      setChosen(found[0]?.name ?? null);
    });

  const restore = () =>
    run(async () => {
      if (!chosen) return;
      const { bytes, salt } = await downloadBackup(licenseKey, chosen);
      const snapshot = await openBackup(bytes, code, salt);
      if (!snapshot) throw new Error('That recovery code does not open this backup.');
      const restored = await setupFromBackup(snapshot, code);
      if (!restored.ok) throw new Error(restored.error);
      // Best effort: the old tablet may still hold the license.
      const activated = await activate(licenseKey);
      toast(
        activated.ok
          ? 'Restored and activated. Sign in with your PIN.'
          : `Restored. ${activated.error} Then activate in Settings.`,
        activated.ok ? 'success' : 'danger',
      );
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2.5">
        <CloudDownload size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Bring back sales, items, staff and settings from the last nightly backup. You need the{' '}
          <strong>license key</strong> and the <strong>recovery code</strong> written down at setup.
        </p>
      </div>
      <Field
        label="License key"
        placeholder="XXXX-XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoComplete="off"
        className="font-mono tracking-[2px] uppercase"
        value={licenseKey}
        onChange={(e) => setLicenseKey(e.target.value)}
      />

      {backups === null ? (
        <Button fullWidth size="lg" disabled={!licenseKey.trim() || busy} onClick={() => void find()}>
          {busy ? 'Looking…' : 'Find backups'}
        </Button>
      ) : (
        <>
          <ul className="flex list-none flex-col gap-1.5 p-0" role="radiogroup" aria-label="Backup to restore">
            {backups.slice(0, 7).map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen === b.name}
                  onClick={() => setChosen(b.name)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between rounded-md border px-3 text-[13px] font-semibold',
                    chosen === b.name ? 'border-accent bg-accent/10' : 'border-line bg-raised',
                  )}
                >
                  {b.name.replace('.bin', '')}
                  <span className="text-[11px] font-normal text-ink-3">{Math.ceil(b.size / 1024)} KB</span>
                </button>
              </li>
            ))}
          </ul>
          <Field
            label="Recovery code"
            placeholder="XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            className="font-mono tracking-[2px] uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button fullWidth size="lg" disabled={!code.trim() || !chosen || busy} onClick={() => void restore()}>
            {busy ? 'Restoring…' : 'Restore this backup'}
          </Button>
        </>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="min-h-10 self-center px-3 text-[12px] font-semibold text-ink-3 hover:text-accent"
      >
        Back to new setup
      </button>
    </div>
  );
}
