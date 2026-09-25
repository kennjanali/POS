import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { PRODUCT_NAME } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: 'Offline-first point of sale for Philippine restaurants.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // The on-screen keyboard shrinks the page instead of covering it, so a
  // dialog's field and its buttons stay above the keys on a tablet.
  interactiveWidget: 'resizes-content',
  themeColor: '#080808',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-rail="expanded" suppressHydrationWarning>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
