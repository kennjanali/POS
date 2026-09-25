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

import { PRODUCT_SLUG } from './brand';
import { saveJsonFile } from './files';
import { businessDate } from './format';
import type { DataSnapshot } from './types';

export function backupFileName(at: number = Date.now()): string {
  return `${PRODUCT_SLUG}-backup-${businessDate(at)}.json`;
}

/**
 * Save today's backup file. Resolves false if it did not land, so the caller
 * never records a backup that did not actually happen.
 */
export async function saveBackup(snapshot: DataSnapshot): Promise<boolean> {
  try {
    await saveJsonFile(backupFileName(), snapshot);
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
 * Is an end-of-day job — the daily close, then the backup — due right now?
 *
 * Two moments, because a till is not reliably awake at midnight:
 *
 *   closing   — the clock has reached 23:59 and it has not run today;
 *   catch-up  — the app is being used on a later day than it last ran, so
 *               yesterday ended without it and this is the first chance.
 *
 * Both require something new since it last ran (`pending`), so an idle day
 * produces nothing and a quiet morning never triggers it twice.
 */
export function endOfDayDue(
  lastRanAt: number | null,
  pending: number,
  now: number = Date.now(),
): boolean {
  if (pending <= 0) return false;
  if (!backupIsDue(lastRanAt, now)) return false;

  const clock = new Date(now);
  const minutes = clock.getHours() * 60 + clock.getMinutes();
  if (minutes >= CUTOFF_MINUTES) return true;

  // Earlier in the day: only if a previous day ended without it.
  return lastRanAt === null || businessDate(lastRanAt) < businessDate(now);
}
