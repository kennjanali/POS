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
 * `oldestPendingAt` is when the oldest thing not yet covered happened (null
 * when nothing is waiting).
 *
 *   closing   — it is 23:59 and something is waiting;
 *   catch-up  — something waiting is from an earlier day, so that night
 *               ended without it (the tablet was off or asleep).
 *
 * Keyed on *when* the pending work happened, not on how much there is: with
 * a count, the first sale of a new day looked like a missed night and ran the
 * job mid-morning, and the 23:59 run then skipped as "already done today",
 * leaving the rest of the day uncovered.
 */
export function endOfDayDue(oldestPendingAt: number | null, now: number = Date.now()): boolean {
  if (oldestPendingAt === null) return false;
  const clock = new Date(now);
  if (clock.getHours() * 60 + clock.getMinutes() >= CUTOFF_MINUTES) return true;
  return businessDate(oldestPendingAt) < businessDate(now);
}
