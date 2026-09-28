'use client';

import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toast';
import { usePos } from '@/store/usePos';

/**
 * License status, or the box to activate one. Activation needs internet
 * once; after that the license is checked offline on every launch.
 */
export function LicenseSettings() {
  const licensed = usePos((s) => s.licensed);
  const activate = usePos((s) => s.activate);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  if (licensed) {
    return (
      <div className="flex items-start gap-2.5 rounded-md border border-good/30 bg-good/5 px-3 py-2.5">
        <BadgeCheck size={16} className="mt-0.5 shrink-0 text-good" aria-hidden />
        <div className="min-w-0 text-[12.5px] leading-relaxed">
          <p className="font-semibold">Licensed to {licensed.businessName}</p>
          <p className="text-ink-3">
            {licensed.licenseId} · updates until {licensed.updatesUntil}
          </p>
        </div>
      </div>
    );
  }

  // The app on the tablet is what gets licensed; the web demo never is.
  if (!Capacitor.isNativePlatform()) {
    return (
      <p className="text-[12px] leading-relaxed text-ink-2">
        This is the web demo. Licenses are activated in the Android app; the demo always stays in
        practice mode.
      </p>
    );
  }

  async function submit() {
    setBusy(true);
    const result = await activate(key);
    setBusy(false);
    if (result.ok) toast('License activated.', 'success');
    else toast(result.error, 'danger');
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-ink-2">
        Enter the license key you received. It needs internet once; after that the license is
        checked on this tablet, offline.
      </p>
      <Field
        label="License key"
        placeholder="XXXX-XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="font-mono tracking-[2px] uppercase"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <Button disabled={!key.trim() || busy} onClick={() => void submit()}>
        {busy ? 'Activating…' : 'Activate'}
      </Button>
    </div>
  );
}
