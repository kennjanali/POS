/**
 * The permission matrix. One module, one table.
 *
 * Every access decision in the app — a nav link, a route guard, a disabled
 * button, a store mutation — resolves through `can()`. Scattering
 * `role === 'staff'` checks through components is how an access model rots:
 * the eighth check written six months later disagrees with the first seven and
 * nobody notices until staff void a sale.
 *
 * This is client-side. It keeps people on the job they were given; anyone with
 * browser devtools on the till can work around it, so it is not a defence
 * against a determined insider.
 */

import type { Features } from './presets';
import type { Role } from './types';

export type Permission =
  /** Ring up a sale: open it, add and change lines before payment. */
  | 'sell'
  | 'order.serve'
  | 'order.pay'
  | 'quote.make'
  | 'promo.apply'
  | 'today.view'
  /** A discount the owner gives by hand, not a promo code. */
  | 'discount.owner'
  /** Void a sale or a line on it. */
  | 'sale.cancel'
  | 'quote.cancel'
  /** Stock, products, prices and promo codes. */
  | 'inventory.manage'
  /** Sales history and reports beyond today. */
  | 'reports.view'
  | 'settings.manage'
  | 'users.manage';

const STAFF: readonly Permission[] = [
  'sell',
  'order.serve',
  'order.pay',
  'quote.make',
  'promo.apply',
  'today.view',
];

const OWNER: readonly Permission[] = [
  ...STAFF,
  'discount.owner',
  'sale.cancel',
  'quote.cancel',
  'inventory.manage',
  'reports.view',
  'settings.manage',
  'users.manage',
];

const MATRIX: Record<Role, readonly Permission[]> = {
  superadmin: OWNER,
  staff: STAFF,
};

export const ROLES: readonly Role[] = ['superadmin', 'staff'];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Owner',
  staff: 'Staff',
};

export const ROLE_HINTS: Record<Role, string> = {
  superadmin: 'Everything, including users and settings.',
  staff: "Takes sales and payments, makes quotes, sees today's sales.",
};

/** Minimum an actor has to be for a permission question. Both `User` and the
 *  in-memory session satisfy it. */
export interface Actor {
  role: Role;
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  // A session saved by an older build can still say 'waiter' until AuthGate
  // re-reads the user; an unknown role holds nothing rather than throwing.
  return MATRIX[actor.role]?.includes(permission) ?? false;
}

// ── Routes ─────────────────────────────────────────────────────────────
// The nav order is also the fallback order: a signed-in user lands on the
// first route they are allowed to see.

export interface RouteSpec {
  href: string;
  label: string;
  permission: Permission;
  /** Off for some shop types, whatever the role. A hidden route stays a
   *  stranger: not in the nav, and not reachable by typing it. */
  feature?: keyof Features;
}

export const ROUTES: readonly RouteSpec[] = [
  { href: '/', label: 'Today', permission: 'today.view' },
  { href: '/sell', label: 'Sell', permission: 'sell' },
  { href: '/quotes', label: 'Quotations', permission: 'quote.make', feature: 'quotes' },
  { href: '/orders', label: 'Sales', permission: 'reports.view' },
  { href: '/inventory', label: 'Inventory', permission: 'inventory.manage' },
  { href: '/month', label: 'This month', permission: 'reports.view' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
];

/** `trailingSlash: true` means every path arrives as `/orders/`. */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** What the shop has turned on. Absent means "no feature gates to check". */
export type FeatureFlags = Partial<Features> | undefined;

function switchedOn(route: RouteSpec, features: FeatureFlags): boolean {
  return route.feature === undefined || features?.[route.feature] === true;
}

export function routesFor(actor: Actor | null, features?: FeatureFlags): RouteSpec[] {
  return ROUTES.filter((route) => can(actor, route.permission) && switchedOn(route, features));
}

export function canVisit(actor: Actor | null, pathname: string, features?: FeatureFlags): boolean {
  const route = ROUTES.find((r) => r.href === normalizePath(pathname));
  // An unknown path is not a permission question — let the router 404 it.
  if (!route) return true;
  return can(actor, route.permission) && switchedOn(route, features);
}

/** Where this actor belongs when they sign in, or when they land somewhere
 *  they are not allowed to be. */
export function landingFor(actor: Actor | null, features?: FeatureFlags): string {
  return routesFor(actor, features)[0]?.href ?? '/';
}

// ── The one account rule that is not a permission ──────────────────────

/** Minimum shape for the last-superadmin question. */
export interface Account {
  id: string;
  role: Role;
  active: boolean;
}

/**
 * True when `id` is the only active superadmin left. That account cannot be
 * deactivated or demoted: there would be nobody able to manage users, and on
 * a device with no server and no password reset that is unrecoverable.
 */
export function isLastActiveSuperadmin(accounts: Account[], id: string): boolean {
  const admins = accounts.filter((a) => a.active && a.role === 'superadmin');
  return admins.length === 1 && admins[0]?.id === id;
}
