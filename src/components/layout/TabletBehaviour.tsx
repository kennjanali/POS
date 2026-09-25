'use client';

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';

import { useAuth } from '@/store/useAuth';

/** Away from the app this long and it asks for a PIN on return. */
const AUTO_LOCK_MS = 5 * 60_000;

/**
 * How the till behaves as a device rather than a web page. Renders nothing.
 *
 *  - Signed in, the screen stays on: a till that dims mid-order is a nuisance.
 *  - Android's back button steps back through the app but never closes it
 *    from the main screen, which a waiter would otherwise do by accident.
 *  - Leave the app (home button, another app, screen off) for five minutes and
 *    it is locked on return, so an unattended tablet is not left signed in.
 */
export function TabletBehaviour() {
  const signedIn = useAuth((s) => s.session !== null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void (signedIn ? KeepAwake.keepAwake() : KeepAwake.allowSleep());
  }, [signedIn]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Any listener replaces Capacitor's default, which exits the app.
    const listener = App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
    });
    return () => void listener.then((l) => l.remove());
  }, []);

  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt >= AUTO_LOCK_MS) {
        useAuth.getState().lock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return null;
}
