/**
 * Sample catalogs. The wizard's fourth question: does the owner start from a
 * short, ordinary menu for their kind of shop, or from nothing?
 *
 * These are starting points, not fixtures. The owner edits or deletes every
 * line, and once a catalog is loaded the products belong to the shop, not to
 * this file. Nothing here is read after setup except the demo month's fallback.
 */

import { uuidv7 } from './id';
import { cents, type Centavos } from './money';
import type { ShopType } from './presets';
import { qty, type Qty } from './qty';
import type { Product, ProductKind } from './types';

/** What a stocked line is and what the shop sells it for. */
export interface CatalogItem {
  name: string;
  kind: ProductKind;
  /** Grouping in the catalogue list. '' when the menu is one flat list. */
  category: string;
  unit: string;
  priceCents: Centavos;
  costCents: Centavos;
  /** How much of a stocked item is on the shelf the first day. */
  openingQty: Qty;
}

/** What a fresh branch of a shop that already has a catalogue gets on the
 *  shelf, for the owner's own products. */
export const OPENING_STOCK = qty(30);

/** Today's carinderia menu, unchanged. The common twelve. */
const RESTAURANT: CatalogItem[] = [
  { name: 'Chicken Paa', category: '', price: 89, cost: 50, unit: 'pcs', opening: 30 },
  { name: 'Chicken Pecho', category: '', price: 99, cost: 55, unit: 'pcs', opening: 30 },
  { name: 'Half Chicken', category: '', price: 175, cost: 95, unit: 'pcs', opening: 20 },
  { name: 'Pork BBQ', category: '', price: 35, cost: 18, unit: 'pcs', opening: 100 },
  { name: 'Pork Chop BBQ', category: '', price: 120, cost: 65, unit: 'pcs', opening: 30 },
  { name: 'Limpio', category: '', price: 150, cost: 80, unit: 'pcs', opening: 20 },
  { name: 'Kanin (1 cup)', category: '', price: 15, cost: 6, unit: 'cup', opening: 60 },
  { name: 'Garlic Rice', category: '', price: 25, cost: 10, unit: 'cup', opening: 60 },
  { name: 'Coke 1.5L', category: '', price: 85, cost: 45, unit: 'btl', opening: 24 },
  { name: 'Softdrinks', category: '', price: 35, cost: 18, unit: 'pcs', opening: 60 },
  { name: 'Atchara', category: '', price: 20, cost: 8, unit: 'serving', opening: 40 },
  { name: 'Sawsawan Set', category: '', price: 15, cost: 5, unit: 'set', opening: 40 },
].map(stocked);

/** A hardware store sells by the piece and by the measure. */
const RETAIL: CatalogItem[] = [
  { name: 'Wire 1.0mm', category: 'Electrical', price: 18, cost: 11, unit: 'm', opening: 500 },
  { name: 'Wire 2.0mm', category: 'Electrical', price: 28, cost: 19, unit: 'm', opening: 300 },
  { name: 'Insulation Tape', category: 'Electrical', price: 35, cost: 20, unit: 'roll', opening: 80 },
  { name: 'Nails 1 inch', category: 'Fasteners', price: 95, cost: 62, unit: 'kg', opening: 50 },
  { name: 'Nails 2 inch', category: 'Fasteners', price: 110, cost: 74, unit: 'kg', opening: 40 },
  { name: 'Common Nails 3 inch', category: 'Fasteners', price: 125, cost: 85, unit: 'kg', opening: 40 },
  { name: 'Screw Assortment', category: 'Fasteners', price: 90, cost: 52, unit: 'box', opening: 30 },
  { name: 'Cutting Disc 4"', category: 'Hardware', price: 55, cost: 28, unit: 'pcs', opening: 50 },
  { name: 'Sandpaper 80 grit', category: 'Paint', price: 25, cost: 12, unit: 'pcs', opening: 60 },
  { name: 'Paint (white, 1L)', category: 'Paint', price: 380, cost: 290, unit: 'btl', opening: 24 },
  { name: 'Paint (white, 4L)', category: 'Paint', price: 1350, cost: 1050, unit: 'pail', opening: 10 },
  { name: 'Cement', category: 'Building', price: 65, cost: 48, unit: 'kg', opening: 200 },
  { name: 'Sand', category: 'Building', price: 35, cost: 22, unit: 'kg', opening: 300 },
  { name: 'PVC Pipe 1/2"', category: 'Plumbing', price: 75, cost: 52, unit: 'm', opening: 60 },
].map(stocked);

/** Tires by size, mags, and the work done to fit them. */
const AUTO: CatalogItem[] = [
  { name: 'Tire 185/65 R14', category: 'Tires', price: 3200, cost: 2450, unit: 'pcs', opening: 20 },
  { name: 'Tire 195/65 R15', category: 'Tires', price: 3850, cost: 3000, unit: 'pcs', opening: 16 },
  { name: 'Tire 205/55 R16', category: 'Tires', price: 4600, cost: 3600, unit: 'pcs', opening: 12 },
  { name: 'Tire 215/60 R17', category: 'Tires', price: 5800, cost: 4550, unit: 'pcs', opening: 8 },
  { name: 'Alloy Mag 14"', category: 'Wheels', price: 8500, cost: 6200, unit: 'pcs', opening: 6 },
  { name: 'Alloy Mag 15"', category: 'Wheels', price: 9800, cost: 7200, unit: 'pcs', opening: 4 },
  { name: 'Steel Mag 14"', category: 'Wheels', price: 3200, cost: 2100, unit: 'pcs', opening: 6 },
  { name: 'Tire Vulcanization (small)', category: 'Service', price: 350, cost: 120, unit: 'pcs', opening: 0 },
  { name: 'Tire Vulcanization (large)', category: 'Service', price: 500, cost: 180, unit: 'pcs', opening: 0 },
  { name: 'Wheel Alignment', category: 'Service', price: 800, cost: 250, unit: 'pcs', opening: 0 },
  { name: 'Wheel Balancing', category: 'Service', price: 300, cost: 80, unit: 'pcs', opening: 0 },
  { name: 'Labor (per hour)', category: 'Service', price: 200, cost: 0, unit: 'hr', opening: 0 },
  { name: 'Engine Oil 10W-40', category: 'Supplies', price: 380, cost: 290, unit: 'L', opening: 40 },
  { name: 'Oil Filter', category: 'Supplies', price: 250, cost: 160, unit: 'pcs', opening: 30 },
].map((line) => (line.opening > 0 ? stocked(line) : service(line)));

/** Wash sizes, wax, and the inside of the car. */
const CARWASH: CatalogItem[] = [
  { name: 'Regular Wash', category: 'Wash', price: 250, cost: 60, unit: 'pcs', opening: 0 },
  { name: 'SUV Wash', category: 'Wash', price: 350, cost: 90, unit: 'pcs', opening: 0 },
  { name: 'Van Wash', category: 'Wash', price: 450, cost: 120, unit: 'pcs', opening: 0 },
  { name: 'Engine Wash', category: 'Wash', price: 600, cost: 180, unit: 'pcs', opening: 0 },
  { name: 'Underbody Wash', category: 'Wash', price: 500, cost: 160, unit: 'pcs', opening: 0 },
  { name: 'Wax (car)', category: 'Wax', price: 700, cost: 200, unit: 'pcs', opening: 0 },
  { name: 'Wax (SUV)', category: 'Wax', price: 950, cost: 280, unit: 'pcs', opening: 0 },
  { name: 'Tire Shine', category: 'Wax', price: 150, cost: 40, unit: 'pcs', opening: 0 },
  { name: 'Interior Vacuum', category: 'Interior', price: 200, cost: 50, unit: 'pcs', opening: 0 },
  { name: 'Interior Detailing', category: 'Interior', price: 1200, cost: 350, unit: 'pcs', opening: 0 },
  { name: 'Dashboard Wax', category: 'Interior', price: 400, cost: 110, unit: 'pcs', opening: 0 },
  { name: 'Shampoo', category: 'Supplies', price: 120, cost: 70, unit: 'L', opening: 40 },
  { name: 'Microfiber Towel', category: 'Supplies', price: 80, cost: 35, unit: 'pcs', opening: 60 },
].map((line) => (line.opening > 0 ? stocked(line) : service(line)));

/** One catalog per shop type, offered by the wizard's fourth question. */
export const SAMPLE_CATALOGS: Record<ShopType, CatalogItem[]> = {
  restaurant: RESTAURANT,
  retail: RETAIL,
  auto: AUTO,
  carwash: CARWASH,
  // The owner picked "general" because nothing else fitted. The retail shelf is
  // the least presumptuous thing to offer them. A copy, so editing one catalog
  // in a test or on screen cannot reach into the other.
  general: [...RETAIL],
};

export interface CatalogSeed {
  products: Product[];
  /** Opening on hand by product id, stocked lines only. The wizard books each
   *  of these as an `opening` move, so the first count is on the record. */
  opening: Record<string, Qty>;
}

/** A shop type's catalog as products, ready to sell, each with its opening
 *  stock. Ids are minted here: the catalogue is a starting point, and from
 *  this moment the products are the shop's own. */
export function seedCatalog(shopType: ShopType): CatalogSeed {
  const products: Product[] = [];
  const opening: Record<string, Qty> = {};
  for (const item of SAMPLE_CATALOGS[shopType]) {
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

/** A catalog line before it is split into kind and money. */
interface Draft {
  name: string;
  category: string;
  /** Pesos; the tables below are written the way a price list is. */
  price: number;
  cost: number;
  unit: string;
  /** Plain count until the tables are built. */
  opening: number;
}

function stocked(draft: Draft): CatalogItem {
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

/** Services are never stocked, so their opening count is always nothing. */
function service(draft: Draft): CatalogItem {
  return { ...stocked(draft), kind: 'service', openingQty: qty(0) };
}
