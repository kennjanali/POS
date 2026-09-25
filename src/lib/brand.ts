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
