'use client';

import { useEffect, useRef } from 'react';

import { toast } from '@/components/ui/Toast';
import { autoBackupDue, backupFileName, downloadBackup } from '@/lib/backup';
import { usePos } from '@/store/usePos';

/** How often the clock is checked. A minute is precise enough for 23:59. */
const TICK_MS = 60_000;

/**
 * Saves the day's backup by itself, and renders nothing.
 *
 * Polling the clock rather than sleeping until 23:59: a tablet that suspends
 * overnight never fires a long timer, and the wake-up would be silently
 * skipped. A minute tick also covers the catch-up case — open the till the
 * next morning and yesterday is saved before anything else happens.
 *
 * Mounted outside the sign-in gate on purpose. Locking the till at closing
 * time is exactly when a backup is wanted, and the lock screen is still the
 * app running.
 */
export function AutoBackup() {
  const hydrated = usePos((s) => s.hydrated);
  // A download in flight must not be started twice by the next tick.
  const running = useRef(false);

  useEffect(() => {
    if (!hydrated) return;

    const attempt = () => {
      if (running.current) return;
      const state = usePos.getState();
      if (!autoBackupDue(state.lastBackupAt, state.unbackedUp())) return;

      running.current = true;
      try {
        if (downloadBackup(state.exportSnapshot())) {
          state.recordBackup();
          toast(`Saved ${backupFileName()}`, 'success');
        } else {
          // Chrome blocks unattended downloads in some configurations. Saying
          // so is the whole point — a backup that silently never happened is
          // the failure this feature exists to prevent.
          toast(
            'Could not save the daily backup automatically. Open Settings and save it.',
            'danger',
          );
        }
      } finally {
        running.current = false;
      }
    };

    attempt();
    const timer = window.setInterval(attempt, TICK_MS);
    return () => window.clearInterval(timer);
  }, [hydrated]);

  return null;
}
