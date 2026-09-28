/**
 * The switches every shop can turn on or off.
 *
 * POS-034 is one general POS: Inventory holds whatever the shop sells,
 * products and services alike, and nothing asks what kind of shop it is.
 * Every shop starts on the same defaults and the owner changes any switch in
 * Settings → More options. Behaviour is decided by a switch, never by a type
 * of business. The niches live on only as demo businesses (see demo.ts).
 */

import type { OrderType, Settings } from './types';

export interface Features {
  /** Sales stay open until paid, e.g. tables, jobs or a queue. */
  openOrders: boolean;
  /** Lines are served before payment. */
  serveStep: boolean;
  quotes: boolean;
  vehiclePlate: boolean;
  /** Decimal quantities, e.g. 2.5 m or 0.75 kg. */
  measuredUnits: boolean;
}

/** Where every shop starts: one cart per sale, quotes, and selling by measure. */
export const DEFAULT_FEATURES: Features = {
  openOrders: false,
  serveStep: false,
  quotes: true,
  vehiclePlate: false,
  measuredUnits: true,
};

/** What an open sale is called until the owner renames it. */
export const DEFAULT_TICKET_LABEL = 'Sale';

/** A copy of the stored switches with every known one present, and nothing else. */
export function withDefaults(saved: Partial<Features> | undefined): Features {
  const features = { ...DEFAULT_FEATURES };
  for (const key of Object.keys(DEFAULT_FEATURES) as (keyof Features)[]) {
    if (typeof saved?.[key] === 'boolean') features[key] = saved[key];
  }
  return features;
}

/** A shop that serves before payment is serving food; any other sells over the counter. */
export function orderTypesFor(features: Features): OrderType[] {
  return features.serveStep ? ['dine-in', 'takeout', 'delivery'] : ['walk-in', 'pickup', 'delivery'];
}

/** What an open sale is called on screen: "Sale", or the owner's own word. */
export function ticketWord(settings: Pick<Settings, 'ticketLabel'>): string {
  return settings.ticketLabel?.trim() || DEFAULT_TICKET_LABEL;
}
