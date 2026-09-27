/**
 * Shop types. A preset is only a set of default switch values: nothing in the
 * app asks which shop type it is, only which switches are on. The owner can
 * change any switch later in Settings → More options.
 */

import type { OrderType } from './types';

export type ShopType = 'restaurant' | 'retail' | 'auto' | 'carwash' | 'general';

export interface Features {
  /** Tables, jobs or a queue stay open until paid. */
  openOrders: boolean;
  /** Lines are served before payment. */
  serveStep: boolean;
  services: boolean;
  quotes: boolean;
  vehiclePlate: boolean;
  /** Decimal quantities, e.g. 2.5 m or 0.75 kg. */
  measuredUnits: boolean;
}

export interface Preset {
  label: string;
  features: Features;
  /** What an open order is called. Null when orders never stay open. */
  ticketLabel: 'Table' | 'Job' | 'Queue' | null;
  orderTypes: OrderType[];
}

const SHOP_ORDER_TYPES: OrderType[] = ['walk-in', 'pickup', 'delivery'];

const RETAIL_FEATURES: Features = {
  openOrders: false,
  serveStep: false,
  services: true,
  quotes: true,
  vehiclePlate: false,
  measuredUnits: true,
};

export const PRESETS: Record<ShopType, Preset> = {
  restaurant: {
    label: 'Restaurant / Food',
    features: {
      openOrders: true,
      serveStep: true,
      services: false,
      quotes: false,
      vehiclePlate: false,
      measuredUnits: false,
    },
    ticketLabel: 'Table',
    orderTypes: ['dine-in', 'takeout', 'delivery'],
  },
  retail: {
    label: 'Retail / Hardware',
    features: RETAIL_FEATURES,
    ticketLabel: null,
    orderTypes: SHOP_ORDER_TYPES,
  },
  auto: {
    label: 'Auto Parts & Service',
    features: {
      openOrders: true,
      serveStep: false,
      services: true,
      quotes: true,
      vehiclePlate: true,
      measuredUnits: false,
    },
    ticketLabel: 'Job',
    orderTypes: SHOP_ORDER_TYPES,
  },
  carwash: {
    label: 'Car Wash / Service',
    features: {
      openOrders: true,
      serveStep: false,
      services: true,
      quotes: false,
      vehiclePlate: true,
      measuredUnits: false,
    },
    ticketLabel: 'Queue',
    orderTypes: SHOP_ORDER_TYPES,
  },
  // The owner picks; until then, the same starting point as retail.
  general: {
    label: 'General',
    features: { ...RETAIL_FEATURES },
    ticketLabel: null,
    orderTypes: SHOP_ORDER_TYPES,
  },
};

/** The preset's switches, as a copy the caller may change. */
export function applyPreset(t: ShopType): Features {
  return { ...PRESETS[t].features };
}

/** What an open order is called on screen: the preset's word, or "Order". */
export function ticketWord(t: ShopType): string {
  return PRESETS[t].ticketLabel ?? 'Order';
}
