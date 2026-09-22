'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronsLeft,
  ClipboardList,
  LayoutDashboard,
  Moon,
  Package,
  PlusCircle,
  Settings as SettingsIcon,
  ShoppingCart,
  Sun,
} from 'lucide-react';

import { usePos } from '@/store/usePos';
import { useAuth } from '@/store/useAuth';
import { can, normalizePath, routesFor } from '@/lib/permissions';
import { useShell } from './shell';
import { cn } from '@/components/ui/cn';

/** Icons only. Which links exist, and who sees them, is permissions.ts. */
const ICONS: Record<string, typeof ShoppingCart> = {
  '/': ShoppingCart,
  '/orders': ClipboardList,
  '/inventory': Package,
  '/dashboard': LayoutDashboard,
  '/settings': SettingsIcon,
};

export function Sidebar() {
  const pathname = usePathname();
  const { railCollapsed, toggleRail, theme, toggleTheme, openNewOrder } = useShell();
  const session = useAuth((s) => s.session);
  const nav = routesFor(session);
  const canOpenOrders = can(session, 'order.open');
  const openCount = usePos((s) =>
    s.orders.filter((o) => o.status === 'open' && o.branchId === s.activeBranchId)
      .length,
  );

  const normalized = normalizePath(pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-200 flex w-[var(--rail-w)] flex-col overflow-hidden border-r border-rail-line bg-rail transition-[width] duration-200"
    >
      {/* Wordmark */}
      <div className="flex min-h-[58px] shrink-0 items-center gap-2.5 overflow-hidden border-b border-rail-line px-3.5 py-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent">
          <ShoppingCart size={15} className="text-white" aria-hidden />
        </span>
        {!railCollapsed && (
          <span className="min-w-0 whitespace-nowrap">
            <span className="block text-[18px] leading-none font-extrabold tracking-tight text-white">
              KRAM<span className="text-accent">GEN</span>
            </span>
            <span className="mt-0.5 block text-[8.5px] tracking-[2px] text-ink-3 uppercase">
              Point of Sale
            </span>
          </span>
        )}
      </div>

      {/* Links */}
      <ul className="scroll-y flex flex-1 list-none flex-col gap-0.5 p-1.5">
        {nav.map(({ href, label }) => {
          const Icon = ICONS[href] ?? ShoppingCart;
          const active = normalized === href;
          return (
            <li key={href}>
              <Link
                href={href}
                title={railCollapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2.5',
                  'text-[12.5px] whitespace-nowrap transition-colors duration-100',
                  active
                    ? 'bg-rail-active font-semibold text-white'
                    : 'font-medium text-[#4a4a4a] hover:bg-rail-hover hover:text-[#ccc]',
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 w-[2.5px] rounded-r-sm bg-accent"
                  />
                )}
                <Icon
                  size={16}
                  strokeWidth={1.7}
                  className={cn('shrink-0', active ? 'opacity-100' : 'opacity-50')}
                  aria-hidden
                />
                {!railCollapsed && <span className="min-w-0 flex-1">{label}</span>}
                {!railCollapsed && href === '/orders' && openCount > 0 && (
                  <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[9px] leading-none font-bold text-white">
                    {openCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Actions */}
      <div className="flex shrink-0 flex-col gap-0.5 border-t border-rail-line p-1.5">
        {canOpenOrders && (
          <button
            type="button"
            onClick={openNewOrder}
            title={railCollapsed ? 'New order' : undefined}
            className="flex items-center gap-3 overflow-hidden rounded-md bg-accent px-3 py-2.5 text-[12.5px] font-bold whitespace-nowrap text-white transition-[filter] hover:brightness-110"
          >
            <PlusCircle size={16} className="shrink-0" aria-hidden />
            {!railCollapsed && <span>New order</span>}
          </button>
        )}

        <button
          type="button"
          onClick={toggleRail}
          aria-expanded={!railCollapsed}
          className="flex items-center gap-3 overflow-hidden rounded-md px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap text-[#4a4a4a] transition-colors hover:bg-rail-hover hover:text-[#ccc]"
        >
          <ChevronsLeft
            size={16}
            className={cn('shrink-0 transition-transform', railCollapsed && 'rotate-180')}
            aria-hidden
          />
          {!railCollapsed && <span>Collapse</span>}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center gap-3 overflow-hidden rounded-md px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap text-[#4a4a4a] transition-colors hover:bg-rail-hover hover:text-[#ccc]"
        >
          {theme === 'dark' ? (
            <Sun size={16} className="shrink-0" aria-hidden />
          ) : (
            <Moon size={16} className="shrink-0" aria-hidden />
          )}
          {!railCollapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>
      </div>
    </nav>
  );
}
