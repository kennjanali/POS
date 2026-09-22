/**
 * The permission matrix. One module, one table.
 *
 * Every access decision in the app — a nav link, a route guard, a disabled
 * button, a store mutation — resolves through `can()`. Scattering
 * `role === 'waiter'` checks through components is how an access model rots:
 * the eighth check written six months later disagrees with the first seven and
 * nobody notices until a waiter voids a sale.
 *
 * This is client-side, and a static export has no middleware to enforce it.
 * It keeps people on the job they were given; it is not a security boundary.
 * That arrives with Supabase RLS — see supabase/002_rls.sql.
 */

import type { Role } from './types';

export type Permission =
  /** See the floor and the menu grid. */
  | 'pos.use'
  | 'order.open'
  | 'order.item'
  | 'order.serve'
  | 'order.pay'
  | 'order.void'
  | 'line.void'
  /** The Orders history page. */
  | 'orders.view'
  | 'inventory.view'
  | 'stock.adjust'
  | 'product.edit'
  | 'dashboard.view'
  | 'settings.manage'
  | 'users.manage';

const WAITER: readonly Permission[] = [
  'pos.use',
  'order.open',
  'order.item',
  'order.serve',
  'order.pay',
  // Read-only history, so a waiter can check their own service went through
  // correctly. Reading a sale is not the same as unmaking one: 'order.void'
  // stays off this list and the void control is hidden accordingly.
  'orders.view',
];

const PURCHASER: readonly Permission[] = ['inventory.view', 'stock.adjust', 'product.edit'];

const SUPERADMIN: readonly Permission[] = [
  ...WAITER,
  ...PURCHASER,
  'order.void',
  'line.void',
  'dashboard.view',
  'settings.manage',
  'users.manage',
];

const MATRIX: Record<Role, readonly Permission[]> = {
  superadmin: SUPERADMIN,
  waiter: WAITER,
  purchaser: PURCHASER,
};

export const ROLES: readonly Role[] = ['superadmin', 'waiter', 'purchaser'];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadmin',
  waiter: 'Waiter',
  purchaser: 'Purchaser',
};

export const ROLE_HINTS: Record<Role, string> = {
  superadmin: 'Everything, including users and settings.',
  waiter: 'The POS floor only — open orders, serve, take payment.',
  purchaser: 'Inventory only — stock counts and menu items.',
};

/** Minimum an actor has to be for a permission question. Both `User` and the
 *  in-memory session satisfy it. */
export interface Actor {
  role: Role;
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  return MATRIX[actor.role].includes(permission);
}

// ── Routes ─────────────────────────────────────────────────────────────
// The nav order is also the fallback order: a signed-in user lands on the
// first route they are allowed to see.

export interface RouteSpec {
  href: string;
  label: string;
  permission: Permission;
}

export const ROUTES: readonly RouteSpec[] = [
  { href: '/', label: 'POS', permission: 'pos.use' },
  { href: '/orders', label: 'Orders', permission: 'orders.view' },
  { href: '/inventory', label: 'Inventory', permission: 'inventory.view' },
  { href: '/dashboard', label: 'Dashboard', permission: 'dashboard.view' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
];

/** `trailingSlash: true` means every path arrives as `/orders/`. */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function routesFor(actor: Actor | null): RouteSpec[] {
  return ROUTES.filter((route) => can(actor, route.permission));
}

export function canVisit(actor: Actor | null, pathname: string): boolean {
  const route = ROUTES.find((r) => r.href === normalizePath(pathname));
  // An unknown path is not a permission question — let the router 404 it.
  if (!route) return true;
  return can(actor, route.permission);
}

/** Where this actor belongs when they sign in, or when they land somewhere
 *  they are not allowed to be. */
export function landingFor(actor: Actor | null): string {
  return routesFor(actor)[0]?.href ?? '/';
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
