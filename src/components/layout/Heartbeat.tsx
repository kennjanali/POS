'use client';

import { useEffect } from 'react';

import { APP_VERSION, LICENSE_SERVER_URL } from '@/lib/brand';
import { deviceInfo } from '@/lib/device';
import { usePos } from '@/store/usePos';

const EVERY_MS = 60 * 60_000;

/**
 * Reports in to the license server: app version, tablet, last backup, and
 * every daily close the server has not acknowledged yet — the technology
 * fee's base. Sends one number per day, never sales detail.
 *
 * Licensed installs only, and only when online. A failed or offline beat is
 * simply tried again later; unacknowledged closes wait on the tablet and all
 * go in the next beat that lands. Renders nothing.
 */
export function Heartbeat() {
  const licensed = usePos((s) => s.licensed !== null);

  useEffect(() => {
    if (!licensed) return;

    const beat = async () => {
      if (!navigator.onLine) return;
      const s = usePos.getState();
      try {
        const response = await fetch(`${LICENSE_SERVER_URL}/api/heartbeat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            license: s.license,
            appVersion: APP_VERSION,
            ...(await deviceInfo()),
            // The off-tablet copy is the one that matters when a tablet is lost.
            lastBackupAt: s.lastCloudBackupAt,
            errorCount: s.persistError ? 1 : 0,
            // Training sales are never billed: no closes until the install is live.
            closes: s.settings.trainingMode ? [] : s.closes.filter((c) => c.no > s.closesAckedThrough),
          }),
        });
        if (!response.ok) return;
        const { ackThrough } = (await response.json()) as { ackThrough?: number };
        if (typeof ackThrough === 'number') s.recordCloseAck(ackThrough);
      } catch {
        /* offline or server down: the next beat carries everything */
      }
    };

    void beat();
    const timer = window.setInterval(() => void beat(), EVERY_MS);
    window.addEventListener('online', beat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', beat);
    };
  }, [licensed]);

  return null;
}
