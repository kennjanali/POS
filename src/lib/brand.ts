/**
 * What the product is called. The customer's own business name lives in
 * Settings; this is the software's.
 *
 * The slug is for anywhere `@` cannot go — file names, mostly. Storage keys
 * deliberately do NOT derive from it: renaming the product must never move a
 * customer's data (see idb.ts, usePos.ts, useAuth.ts).
 */
export const PRODUCT_NAME = 'POS@034';
export const PRODUCT_SLUG = 'pos034';

/** From package.json, inlined by next.config.ts at build time. Stamped on
 *  every backup so a file says which build wrote it. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

/** Activation, heartbeat and cloud backup (license-server/). */
export const LICENSE_SERVER_URL = 'https://pos034-license.kennkennali.workers.dev';
