import { describe, expect, it } from 'vitest';

import { sortProducts } from './products';

const names = (products: { name: string }[]) => products.map((p) => p.name);

describe('sortProducts', () => {
  it('orders by name, ignoring case', () => {
    const products = ['Liempo', 'Atchara', 'kanin'].map((name, i) => ({ id: `p${i}`, name }));
    expect(names(sortProducts(products))).toEqual(['Atchara', 'kanin', 'Liempo']);
  });

  it('lets the name decide, never the id', () => {
    const products = [
      { id: 'p2', name: 'Pork BBQ' },
      { id: 'p10', name: 'Atchara' },
      { id: '0199a1b2-0000-7000-8000-000000000000', name: 'Sawsawan Set' },
    ];
    expect(sortProducts(products).map((p) => p.id)).toEqual([
      'p10',
      'p2',
      '0199a1b2-0000-7000-8000-000000000000',
    ]);
  });

  it('puts category first, and a missing category sorts as empty', () => {
    const products = [
      { id: 'a', name: 'Adobo', category: 'Mains' },
      { id: 'b', name: 'Coke', category: 'drinks' },
      { id: 'c', name: 'Zest' },
    ];
    expect(names(sortProducts(products))).toEqual(['Zest', 'Coke', 'Adobo']);
  });

  it('leaves the list it was given alone', () => {
    const products = [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }];
    sortProducts(products);
    expect(names(products)).toEqual(['B', 'A']);
  });
});
