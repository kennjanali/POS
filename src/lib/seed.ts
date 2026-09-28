import { DEFAULT_FEATURES, DEFAULT_TICKET_LABEL } from './features';
import { qty } from './qty';
import type { Branch, Settings } from './types';

export const BRANCH_COLORS = [
  '#ff5c1a',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#db2777',
];

export const DEFAULT_SETTINGS: Settings = {
  // Filled in by the setup wizard. Every install is a different business.
  businessName: '',
  address: '',
  currency: '\u20b1',
  receiptFooter: 'Salamat! Come again',
  showStock: true,
  lowStockAt: qty(10),
  trainingMode: true,

  // A small shop under PHP 3M annual gross is a percentage-tax filer, not a
  // VAT filer. v6 hard-coded VAT on. The honest default is off — switch it on
  // in Settings once the business is actually VAT-registered.
  vatRegistered: false,
  vatRate: 0.12,
  vatLabel: 'VAT',

  features: { ...DEFAULT_FEATURES },
  ticketLabel: DEFAULT_TICKET_LABEL,
  contactNumber: '',
  quoteValidDays: 7,
  checklistDismissed: [],
};

export const DEFAULT_BRANCH: Branch = {
  id: 'BR001',
  name: 'Main Branch',
  address: '',
  branchCode: '00000',
  color: '#ff5c1a',
  active: true,
};
