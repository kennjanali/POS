import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app wraps the same static export the web demo serves.
 *
 * Frozen from the first customer install:
 *  - appId decides the app's data sandbox and which installs an update replaces.
 *  - The web origin (https://localhost, from androidScheme and the default
 *    hostname) decides where the WebView keeps its storage, and is a secure
 *    context — which PIN hashing needs. Never point hostname at a real domain.
 * Changing either hides every sale already on the tablet.
 */
const config: CapacitorConfig = {
  appId: 'dev.kennjanali.pos034',
  appName: 'POS@034',
  webDir: 'out',
  server: { androidScheme: 'https' },
};

export default config;
