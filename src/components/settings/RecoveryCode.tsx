'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { generateRecoveryCode } from '@/lib/crypto';
import { usePos } from '@/store/usePos';

/**
 * Issue a new recovery code when the written one is lost. The old code stops
 * working, and the new one is shown once — the same rule as at setup.
 */
export function RecoveryCode() {
  const replace = usePos((s) => s.replaceRecoveryCode);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function issue() {
    setBusy(true);
    const code = generateRecoveryCode();
    await replace(code);
    setBusy(false);
    setShown(code);
    toast('New recovery code issued. The old one no longer works.', 'success');
  }

  if (shown) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] leading-relaxed text-ink-2">
          Write this down and keep it away from the device. It will not be shown again.
        </p>
        <p className="rounded-lg border border-line bg-raised py-3 text-center font-mono text-[20px] font-bold tracking-[3px] select-all">
          {shown}
        </p>
        <Button variant="secondary" onClick={() => setShown(null)}>
          I have written it down
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-ink-2">
        The recovery code resets an owner&apos;s PIN from the lock screen and opens the
        cloud backups on a new tablet. Lost the copy from setup? Issue a new one — the old code
        stops working here, but cloud backups made before today still need it.
      </p>
      <Button variant="secondary" disabled={busy} onClick={issue}>
        <KeyRound size={14} aria-hidden />
        Issue a new recovery code
      </Button>
    </div>
  );
}
