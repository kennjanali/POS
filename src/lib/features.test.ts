import { describe, expect, it } from 'vitest';

import { DEFAULT_FEATURES, orderTypesFor, ticketWord, withDefaults } from './features';
import { migrateSnapshot, settingsFromSaved } from './migrate';
import { DEFAULT_SETTINGS } from './seed';
import type { DataSnapshot, Settings } from './types';

describe('the general defaults', () => {
  it('start every shop with quotes and selling by measure, and nothing else', () => {
    expect(DEFAULT_FEATURES).toEqual({
      openOrders: false,
      serveStep: false,
      quotes: true,
      vehiclePlate: false,
      measuredUnits: true,
    });
    expect(DEFAULT_SETTINGS.features).toEqual(DEFAULT_FEATURES);
    expect(DEFAULT_SETTINGS.ticketLabel).toBe('Sale');
    expect('shopType' in DEFAULT_SETTINGS).toBe(false);
  });

  it('are handed out as a copy', () => {
    const features = withDefaults(undefined);
    features.quotes = false;
    expect(DEFAULT_FEATURES.quotes).toBe(true);
  });
});

describe('orderTypesFor and ticketWord', () => {
  it('offers food order types only with a serve step', () => {
    expect(orderTypesFor(DEFAULT_FEATURES)).toEqual(['walk-in', 'pickup', 'delivery']);
    expect(orderTypesFor({ ...DEFAULT_FEATURES, serveStep: true })).toEqual(['dine-in', 'takeout', 'delivery']);
  });

  it('calls an open sale a Sale unless the owner renamed it', () => {
    expect(ticketWord({ ticketLabel: 'Sale' })).toBe('Sale');
    expect(ticketWord({ ticketLabel: ' Job ' })).toBe('Job');
    expect(ticketWord({ ticketLabel: '   ' })).toBe('Sale');
  });
});

describe('settingsFromSaved', () => {
  it('loads settings saved with a shop type: the type goes, its switches stay', () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      shopType: 'auto',
      features: { openOrders: true, serveStep: false, services: true, quotes: true, vehiclePlate: true, measuredUnits: false },
    } as unknown as Partial<Settings>;
    const settings = settingsFromSaved(saved, DEFAULT_SETTINGS);
    expect('shopType' in settings).toBe(false);
    expect(settings.features).toEqual({
      openOrders: true,
      serveStep: false,
      quotes: true,
      vehiclePlate: true,
      measuredUnits: false,
    });
  });

  it('fills what an older blob lacks from the defaults', () => {
    const settings = settingsFromSaved({ businessName: 'Old' } as Partial<Settings>, DEFAULT_SETTINGS);
    expect(settings.businessName).toBe('Old');
    expect(settings.ticketLabel).toBe('Sale');
    expect(settings.features).toEqual(DEFAULT_FEATURES);
  });
});

describe('migrateSnapshot, v7', () => {
  const v7 = {
    version: 7,
    exportedAt: '2026-01-01T00:00:00.000Z',
    settings: { businessName: 'Old Shop', pricesIncludeVat: true },
    orders: [
      { id: 'o1', type: 'grab', discountKind: 'none' },
      { id: 'o2', type: 'panda', discountKind: 'none' },
      { id: 'o3', type: 'takeout', discountKind: 'none' },
    ],
  } as unknown as DataSnapshot;

  it('turns GrabFood and FoodPanda orders into delivery', () => {
    const s = migrateSnapshot(v7);
    expect(s.orders.map((o) => o.type)).toEqual(['delivery', 'delivery', 'takeout']);
  });

  it('keeps a v7 install working as the restaurant it was: tables, served before payment', () => {
    const { settings } = migrateSnapshot(v7);
    expect('shopType' in settings).toBe(false);
    expect(settings.features).toEqual({
      openOrders: true,
      serveStep: true,
      quotes: false,
      vehiclePlate: false,
      measuredUnits: false,
    });
    expect(settings.ticketLabel).toBe('Table');
    expect(settings.contactNumber).toBe('');
    expect(settings.quoteValidDays).toBe(7);
    expect(settings.checklistDismissed).toEqual([]);
    expect(settings.businessName).toBe('Old Shop');
  });
});
