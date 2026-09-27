import { describe, expect, it } from 'vitest';

import { migrateSnapshot } from './migrate';
import { applyPreset, PRESETS } from './presets';
import type { DataSnapshot } from './types';

describe('PRESETS', () => {
  it('gives Auto Parts & Service the spec §3 switches', () => {
    expect(PRESETS.auto.features).toEqual({
      openOrders: true,
      serveStep: false,
      services: true,
      quotes: true,
      vehiclePlate: true,
      measuredUnits: false,
    });
    expect(PRESETS.auto.ticketLabel).toBe('Job');
    expect(PRESETS.auto.orderTypes).toEqual(['walk-in', 'pickup', 'delivery']);
  });

  it('gives General the retail switches as its own object', () => {
    expect(PRESETS.general.features).toEqual(PRESETS.retail.features);
    expect(PRESETS.general.features).not.toBe(PRESETS.retail.features);
  });
});

describe('applyPreset', () => {
  it('has no quotes for a car wash, and hands back a copy', () => {
    const features = applyPreset('carwash');
    expect(features.quotes).toBe(false);
    features.quotes = true;
    expect(PRESETS.carwash.features.quotes).toBe(false);
  });
});

describe('migrateSnapshot, shop type', () => {
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

  it('makes an existing install a restaurant with the restaurant switches', () => {
    const { settings } = migrateSnapshot(v7);
    expect(settings.shopType).toBe('restaurant');
    expect(settings.features).toEqual({
      openOrders: true,
      serveStep: true,
      services: false,
      quotes: false,
      vehiclePlate: false,
      measuredUnits: false,
    });
    expect(settings.contactNumber).toBe('');
    expect(settings.quoteValidDays).toBe(7);
    expect(settings.checklistDismissed).toEqual([]);
    expect(settings.businessName).toBe('Old Shop');
  });
});
