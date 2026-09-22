'use client';

import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { backupIsDue, downloadBackup } from '@/lib/backup';
import { usePos } from '@/store/usePos';

/**
 * The one reminder in the app that is allowed to be in the way.
 *
 * Sales are already safe on this device; this is about there being a second
 * copy. It appears only when today's takings are not in any backup yet, and
 * it names the number at risk rather than saying something vague, because
 * "3 sales" and "180 sales" are very different mornings.
 */
export function BackupBar() {
  const lastBackupAt = usePos((s) => s.lastBackupAt);
  const atRisk = usePos((s) => s.unbackedUp());
  const exportSnapshot = usePos((s) => s.exportSnapshot);
  const recordBackup = usePos((s) => s.recordBackup);

  if (atRisk === 0 || !backupIsDue(lastBackupAt)) return null;

  function save() {
    if (downloadBackup(exportSnapshot())) {
      recordBackup();
      toast('Backup saved — keep it in your Drive folder', 'success');
    } else {
      toast('The browser blocked the download. Check its download settings.', 'danger');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2">
      <ShieldAlert size={15} className="shrink-0 text-warn" aria-hidden />
      <p className="min-w-0 flex-1 text-[12px] leading-snug">
        <strong>
          {atRisk === 1
            ? '1 sale exists only on this device.'
            : `${atRisk} sales exist only on this device.`}
        </strong>{' '}
        <span className="text-ink-2">
          {lastBackupAt === null
            ? 'No backup has ever been saved.'
            : `Last backup was ${new Date(lastBackupAt).toLocaleDateString('en-PH', {
                month: 'short',
                day: 'numeric',
              })}.`}{' '}
          Save today&rsquo;s before you close up.
        </span>
      </p>
      <Button size="sm" onClick={save}>
        Back up now
      </Button>
    </div>
  );
}
