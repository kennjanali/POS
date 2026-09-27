'use client';

import { useEffect } from 'react';

import { APP_VERSION, LICENSE_SERVER_URL } from '@/lib/brand';
import { deviceInfo } from '@/lib/device';
import { usePos } from '@/store/usePos';

const EVERY_MS = 60 * 60_000;

/**
 * Reports in to the license server: app version, tablet, last backup, and
 * error count. Health only — no sales figures ever leave the tablet.
 *
 * Licensed installs only, and only when online. A failed or offline beat is
 * simply tried again later. Renders nothing.
 */
export function Heartbeat() {
  const licensed = usePos((s) => s.licensed !== null);

  useEffect(() => {
    if (!licensed) return;

    const beat = async () => {
      if (!navigator.onLine) return;
      const s = usePos.getState();
      try {
        await fetch(`${LICENSE_SERVER_URL}/api/heartbeat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            license: s.license,
            appVersion: APP_VERSION,
            ...(await deviceInfo()),
            // The off-tablet copy is the one that matters when a tablet is lost.
            lastBackupAt: s.lastCloudBackupAt,
            errorCount: s.persistError ? 1 : 0,
          }),
        });
      } catch {
        /* offline or server down: the next beat tries again */
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
