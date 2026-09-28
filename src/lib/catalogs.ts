/**
 * Sample catalog. Setup's last question: does the owner start from a short
 * list of everyday items and services, from a spreadsheet, or from nothing?
 *
 * A starting point, not a fixture. The owner edits or deletes every line, and
 * once it is loaded the products belong to the shop, not to this file. It
 * mixes goods and services on purpose: Inventory is whatever the shop sells.
 */

import { uuidv7 } from './id';
import { cents, type Centavos } from './money';
import { qty, type Qty } from './qty';
import type { Product, ProductKind } from './types';

/** What a line is and what the shop sells it for. */
export interface CatalogItem {
  name: string;
  kind: ProductKind;
  /** Grouping in the Inventory list. '' when the list is flat. */
  category: string;
  unit: string;
  priceCents: Centavos;
  costCents: Centavos;
  /** How much of a stocked item is on the shelf the first day; 0 for a service. */
  openingQty: Qty;
}

/** What a fresh branch of a shop that already has a catalogue gets on the
 *  shelf, for the owner's own products. */
export const OPENING_STOCK = qty(30);

/** A catalog line as it is written below: pesos and a plain opening count. */
export interface Draft {
  name: string;
  category: string;
  price: number;
  cost: number;
  unit: string;
  opening: number;
}

/** Stocked goods: counted on a shelf. */
export function stockLine(draft: Draft): CatalogItem {
  return {
    name: draft.name,
    kind: 'stock',
    category: draft.category,
    unit: draft.unit,
    priceCents: cents(draft.price * 100),
    costCents: cents(draft.cost * 100),
    openingQty: qty(draft.opening),
  };
}

/** A service is never on a shelf, so its opening count is always nothing. */
export function serviceLine(draft: Draft): CatalogItem {
  return { ...stockLine(draft), kind: 'service', openingQty: qty(0) };
}

/** Lines with an opening count are goods; the rest are services. */
export const byOpening = (draft: Draft): CatalogItem =>
  draft.opening > 0 ? stockLine(draft) : serviceLine(draft);

/**
 * Everyday goods any small shop might carry, some sold by the metre or the
 * kilo, and three services. Opening counts sit above the default reorder
 * level, so a new shop does not open to a "Running low" list.
 */
export const SAMPLE_CATALOG: CatalogItem[] = [
  { name: 'Bottled Water 500ml', category: 'Drinks', price: 20, cost: 12, unit: 'pcs', opening: 48 },
  { name: 'Softdrink 1.5L', category: 'Drinks', price: 85, cost: 65, unit: 'pcs', opening: 24 },
  { name: 'Instant Noodles', category: 'Groceries', price: 18, cost: 12, unit: 'pcs', opening: 60 },
  { name: 'Rice (per kg)', category: 'Groceries', price: 55, cost: 45, unit: 'kg', opening: 50 },
  { name: 'Sugar (per kg)', category: 'Groceries', price: 75, cost: 62, unit: 'kg', opening: 20 },
  { name: 'Cooking Oil 1L', category: 'Groceries', price: 120, cost: 98, unit: 'pcs', opening: 12 },
  { name: 'Laundry Soap', category: 'Household', price: 30, cost: 22, unit: 'pcs', opening: 40 },
  { name: 'Batteries AA (pair)', category: 'Household', price: 60, cost: 40, unit: 'pcs', opening: 20 },
  { name: 'Padlock', category: 'Hardware', price: 180, cost: 120, unit: 'pcs', opening: 12 },
  { name: 'Electrical Wire (per m)', category: 'Hardware', price: 28, cost: 18, unit: 'm', opening: 100 },
  { name: 'Nylon Rope (per m)', category: 'Hardware', price: 15, cost: 8, unit: 'm', opening: 60 },
  { name: 'Delivery', category: 'Services', price: 50, cost: 0, unit: 'job', opening: 0 },
  { name: 'Repair Labor (per hour)', category: 'Services', price: 250, cost: 0, unit: 'hr', opening: 0 },
  { name: 'Gift Wrapping', category: 'Services', price: 30, cost: 5, unit: 'job', opening: 0 },
].map(byOpening);

export interface CatalogSeed {
  products: Product[];
  /** Opening on hand by product id, stocked lines only. Setup books each of
   *  these as an `opening` move, so the first count is on the record. */
  opening: Record<string, Qty>;
}

/** Catalog lines as products, ready to sell, each with its opening stock.
 *  Ids are minted here: from this moment the products are the shop's own. */
export function seedCatalog(items: CatalogItem[] = SAMPLE_CATALOG): CatalogSeed {
  const products: Product[] = [];
  const opening: Record<string, Qty> = {};
  for (const item of items) {
    const product: Product = {
      id: uuidv7(),
      name: item.name,
      kind: item.kind,
      sku: null,
      category: item.category,
      unit: item.unit,
      priceCents: item.priceCents,
      costCents: item.costCents,
      vatExempt: false,
      active: true,
      reorderLevel: null,
    };
    products.push(product);
    if (item.kind === 'stock') opening[product.id] = item.openingQty;
  }
  return { products, opening };
}
