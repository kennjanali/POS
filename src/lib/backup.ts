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

/** Minutes past midnight at which the day's backup is taken: 23:59. */
export const CUTOFF_MINUTES = 23 * 60 + 59;

/**
 * Should the day's backup run right now, unattended?
 *
 * Two moments, because a till is not reliably awake at midnight:
 *
 *   closing   — the clock has reached 23:59 and today has not been saved;
 *   catch-up  — the app is being used on a later day than the last backup,
 *               so yesterday closed without one and this is the first chance.
 *
 * Both require sales that are not in a backup yet, so an idle day never
 * produces a file and a quiet morning never triggers one twice.
 */
export function autoBackupDue(
  lastBackupAt: number | null,
  unsavedSales: number,
  now: number = Date.now(),
): boolean {
  if (unsavedSales <= 0) return false;
  if (!backupIsDue(lastBackupAt, now)) return false;

  const clock = new Date(now);
  const minutes = clock.getHours() * 60 + clock.getMinutes();
  if (minutes >= CUTOFF_MINUTES) return true;

  // Earlier in the day: only if a previous day was never saved.
  return lastBackupAt === null || businessDate(lastBackupAt) < businessDate(now);
}
