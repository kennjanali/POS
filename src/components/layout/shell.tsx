'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ShellValue {
  theme: Theme;
  toggleTheme: () => void;
  railCollapsed: boolean;
  toggleRail: () => void;
  newOrderOpen: boolean;
  openNewOrder: () => void;
  closeNewOrder: () => void;
}

const ShellContext = createContext<ShellValue | null>(null);

const THEME_KEY = 'kramgen.theme';
const RAIL_KEY = 'kramgen.rail';

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  // Chrome preferences are small and synchronous — localStorage is the right
  // tool here. Business data lives in IndexedDB.
  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_KEY);
    const savedRail = window.localStorage.getItem(RAIL_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme);
    if (savedRail === 'collapsed') setRailCollapsed(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.rail = railCollapsed ? 'collapsed' : 'expanded';
    window.localStorage.setItem(THEME_KEY, theme);
    window.localStorage.setItem(RAIL_KEY, railCollapsed ? 'collapsed' : 'expanded');
  }, [theme, railCollapsed]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    [],
  );
  const toggleRail = useCallback(() => setRailCollapsed((c) => !c), []);
  const openNewOrder = useCallback(() => setNewOrderOpen(true), []);
  const closeNewOrder = useCallback(() => setNewOrderOpen(false), []);

  return (
    <ShellContext.Provider
      value={{
        theme,
        toggleTheme,
        railCollapsed,
        toggleRail,
        newOrderOpen,
        openNewOrder,
        closeNewOrder,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside ShellProvider');
  return value;
}
