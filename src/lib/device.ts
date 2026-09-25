/**
 * Which tablet this is, for binding a license to it. Android's device id is
 * unique per app-signing key and device, survives reinstalling the app, and
 * changes on a factory reset — exactly when re-activation should happen.
 * Only its SHA-256 leaves the tablet.
 *
 * The web demo has no stable device identity, so it can never be licensed
 * and stays in training mode.
 */

import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

/** Android version and tablet model, for the vendor dashboard. */
export async function deviceInfo(): Promise<{ os: string; model: string } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const info = await Device.getInfo();
  return { os: `Android ${info.osVersion}`, model: `${info.manufacturer} ${info.model}` };
}

let cached: Promise<string | null> | null = null;

export function deviceFingerprint(): Promise<string | null> {
  cached ??= (async () => {
    if (!Capacitor.isNativePlatform()) return null;
    const { identifier } = await Device.getId();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identifier));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  })().catch(() => null);
  return cached;
}
