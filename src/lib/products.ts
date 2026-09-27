import type { Product } from './types';

/** What the sort reads. `category` is optional until products carry one. */
type Sortable = Pick<Product, 'name'> & { category?: string };

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The order products are shown in: category, then name, ignoring case.
 * Storage hands them back in id order, which nobody chose, so screens sort
 * rather than trust the array. Returns a new array.
 */
export function sortProducts<T extends Sortable>(products: readonly T[]): T[] {
  return [...products].sort(
    (a, b) => compare(a.category ?? '', b.category ?? '') || compare(a.name, b.name),
  );
}
