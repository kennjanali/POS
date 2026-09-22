/**
 * Daily backup.
 *
 * Sales are written to the device the moment they happen, so nothing is lost
 * to a closed tab, a flat battery or a reload. The device itself is the risk:
 * lose it, or let someone clear the browser's data, and the sales go with it.
 *
 * One file a day is the whole answer. Keep it in a OneDrive or Google Drive
 * folder and the copy leaves the building by itself.
 */

import { businessDate } from './format';
import type { DataSnapshot } from './types';

export function backupFileName(at: number = Date.now()): string {
  return `kramgen-backup-${businessDate(at)}.json`;
}

/**
 * Hand the file to the browser. Returns false if the browser refused, so the
 * caller never records a backup that did not actually happen.
 */
export function downloadBackup(snapshot: DataSnapshot): boolean {
  try {
    const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    link.click();
    // Revoking in the same tick can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/** True when the last backup was not taken today. */
export function backupIsDue(lastBackupAt: number | null, now: number = Date.now()): boolean {
  if (lastBackupAt === null) return true;
  return businessDate(lastBackupAt) !== businessDate(now);
}
