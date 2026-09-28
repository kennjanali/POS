import { describe, expect, it } from 'vitest';

import { CSV_COLUMNS, exportProducts, parseCsv, previewImport, toCsv } from '@/lib/csv';
import { DEFAULT_FEATURES } from '@/lib/features';
import { qty } from '@/lib/qty';
import type { Product } from '@/lib/types';

const FEATURES = DEFAULT_FEATURES;

function existing(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Nails, 2"',
    kind: 'stock',
    sku: 'NA-01',
    category: 'Hardware',
    unit: 'pcs',
    priceCents: 1500 as Product['priceCents'],
    costCents: 900 as Product['costCents'],
    vatExempt: false,
    active: true,
    reorderLevel: null,
    ...over,
  };
}

/** What Excel needs at the front of a file to read it as UTF-8. */
const BOM = '﻿';

/** The template header, so a test never drifts from the real columns. */
const HEADER = CSV_COLUMNS.join(',');

/** A whole file: the header plus the given body rows, CRLF throughout. */
function file(...rows: string[]): string {
  return `${HEADER}\r\n${rows.map((r) => `${r}\r\n`).join('')}`;
}

describe('parseCsv', () => {
  it('reads a quoted field with a comma and a doubled quote, and drops the trailing blank', () => {
    expect(parseCsv('\ufeffname,price\r\n"Nails, 2""",15\r\n\r\n')).toEqual([
      ['name', 'price'],
      ['Nails, 2"', '15'],
    ]);
  });

  it('keeps a line break inside quotes on its own row', () => {
    expect(parseCsv('a\r\n"one\r\ntwo"\r\n')).toEqual([['a'], ['one\r\ntwo']]);
  });

  it('copes with lone LF line endings, which is what some apps write', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a trailing field with nothing after the last comma as blank', () => {
    expect(parseCsv('a,b,c\r\n1,2,\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('gives an empty file no rows at all', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\r\n\r\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes a comma and a quote, and ends the last row with CRLF', () => {
    expect(toCsv([['a,b', 'c"d']])).toBe('"a,b","c""d"\r\n');
  });

  it('leaves a plain field alone', () => {
    expect(toCsv([['pcs', '15']])).toBe('pcs,15\r\n');
  });

  it('quotes a field that holds a line break', () => {
    expect(toCsv([['one\ntwo']])).toBe('"one\ntwo"\r\n');
  });

  it('reads back what it wrote', () => {
    const rows = [
      ['name', 'note'],
      ['Adobo, thick', 'say "hi"'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('previewImport', () => {
  it('reads a good row into a product and an opening quantity', () => {
    const preview = previewImport(
      file('"Nails, 2""",NA-02,Hardware,stock,pcs,15,9,10,2'),
      [existing()],
      FEATURES,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toHaveLength(1);
    const [row] = preview.rows;
    expect(row?.row).toBe(2);
    expect(row?.matchId).toBeNull();
    expect(row?.openingQty).toBe(2000);
    expect(row?.product).toEqual({
      name: 'Nails, 2"',
      kind: 'stock',
      sku: 'NA-02',
      category: 'Hardware',
      unit: 'pcs',
      priceCents: 1500,
      costCents: 900,
      vatExempt: false,
      reorderLevel: 10000,
    });
  });

  it('says which row is missing a price, by its line in the file', () => {
    const preview = previewImport(file('Cement,CE-01,Hardware,stock,pcs,,70,10'), [], FEATURES);
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toEqual([{ row: 2, message: 'Price is missing.' }]);
  });

  it('matches a SKU already on the shelf, so the file updates it instead of duplicating it', () => {
    const preview = previewImport(
      file('Nails 2 inch,NA-01,Hardware,stock,pcs,18,9,,5'),
      [existing()],
      FEATURES,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.matchId).toBe('p1');
  });

  it('refuses a decimal opening quantity on a unit that is not sold by measure', () => {
    const preview = previewImport(
      file('Nails,NA-02,Hardware,stock,pcs,15,9,,2.5'),
      [],
      FEATURES,
    );
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0]?.row).toBe(2);
    expect(preview.errors[0]?.message).toBe('2.5 is not a whole number of pcs.');
  });

  it('accepts a decimal on a measured unit, because 2.5 m is the point of it', () => {
    const preview = previewImport(file('Wire,WI-01,Electrical,stock,m,45,30,,2.5'), [], FEATURES);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.openingQty).toBe(2500);
  });

  it('rejects a decimal outright when the shop is not set up to sell by measure', () => {
    const preview = previewImport(file('Wire,WI-01,Electrical,stock,m,45,30,,2.5'), [], {
      ...FEATURES,
      measuredUnits: false,
    });
    expect(preview.errors[0]?.message).toBe('2.5 is not a whole number of m.');
  });

  it('calls out a name left blank', () => {
    const preview = previewImport(file(',NA-02,Hardware,stock,pcs,15,9,,2'), [], FEATURES);
    expect(preview.errors).toEqual([{ row: 2, message: 'Name is missing.' }]);
  });

  it('rejects a kind that is neither stock nor service', () => {
    const preview = previewImport(file('Nails,NA-02,Hardware,part,pcs,15,9,,2'), [], FEATURES);
    expect(preview.errors[0]?.message).toBe('Kind must be stock or service.');
  });

  it('treats a blank reorder level as the shop default', () => {
    const preview = previewImport(file('Cement,CE-01,Hardware,stock,pcs,70,60,,'), [], FEATURES);
    expect(preview.rows[0]?.product.reorderLevel).toBeNull();
    expect(preview.rows[0]?.openingQty).toBe(0);
  });

  it('reads a reorder level against the same decimal rule as the quantity', () => {
    const bad = previewImport(file('Cement,CE-01,Hardware,stock,pcs,70,60,2.5,'), [], FEATURES);
    expect(bad.errors[0]?.message).toBe('2.5 is not a whole number of pcs.');
    const good = previewImport(file('Wire,WI-01,Electrical,stock,m,45,30,2.5,'), [], FEATURES);
    expect(good.errors).toEqual([]);
    expect(good.rows[0]?.product.reorderLevel).toBe(2500);
  });

  it('refuses the same SKU twice in one file, and flags the second one only', () => {
    const preview = previewImport(
      file('Nails,NA-01,Hardware,stock,pcs,15,9,,2', 'More nails,NA-01,Hardware,stock,pcs,16,9,,2'),
      [],
      FEATURES,
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.row).toBe(2);
    expect(preview.errors).toEqual([
      { row: 3, message: 'SKU NA-01 appears twice in this file.' },
    ]);
  });

  it('reads a row of nothing as no error at all, so a stray blank line is harmless', () => {
    const preview = previewImport(
      file('Cement,CE-01,Hardware,stock,pcs,70,60,10,40', ''),
      [],
      FEATURES,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toHaveLength(1);
  });

  it('wants every column, and says which are missing', () => {
    const preview = previewImport('name,sku\r\nCement,CE-01\r\n', [], FEATURES);
    expect(preview.rows).toEqual([]);
    expect(preview.errors[0]?.row).toBe(1);
    expect(preview.errors[0]?.message).toContain('category');
  });

  it('accepts the header in any case, because a spreadsheet may have capitalised it', () => {
    const preview = previewImport(
      'Name,SKU,Category,Kind,Unit,Price,Cost,Reorder_Level,Opening_Qty\r\nCement,CE-01,Hardware,stock,pcs,70,60,10,40\r\n',
      [],
      FEATURES,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toHaveLength(1);
  });

  it('keeps the good rows when some rows are bad, so one typo does not void a 300-row file', () => {
    const preview = previewImport(
      file('Cement,CE-01,Hardware,stock,pcs,70,60,10,40', ',NA-09,Hardware,stock,pcs,70,60,10,40'),
      [],
      FEATURES,
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);
  });

  it('never counts a service into stock: a service has nothing to open', () => {
    const preview = previewImport(file('Wash,WA-01,Care,service,job,250,0,,3'), [], FEATURES);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.product.reorderLevel).toBeNull();
    expect(preview.rows[0]?.openingQty).toBe(0);
  });

  it('refuses a price that came out negative rather than storing a credit', () => {
    const preview = previewImport(file('Cement,CE-01,Hardware,stock,pcs,-70,60,,10'), [], FEATURES);
    expect(preview.errors[0]?.message).toBe('Price cannot be negative.');
  });

  it('will not quietly price a shelf at zero when a cell has no digits in it', () => {
    const preview = previewImport(file('Cement,CE-01,Hardware,stock,pcs,ask me,60,,10'), [], FEATURES);
    expect(preview.rows).toEqual([]);
    expect(preview.errors[0]?.message).toBe('Price is not a number.');
  });

  it('reads a peso sign and a thousands separator in a price', () => {
    const preview = previewImport(file('Cement,CE-01,Hardware,stock,pcs,"₱1,250.50",60,,10'), [], FEATURES);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.product.priceCents).toBe(125050);
  });
});

describe('previewImport matching', () => {
  it('finds an item without a SKU by its name, ignoring case and spacing', () => {
    const shelf = [existing({ id: 'rice', name: 'Rice  Plain', sku: null })];
    const preview = previewImport(file('rice plain,,Grains,stock,pcs,20,10,,5'), shelf, FEATURES);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.matchId).toBe('rice');
  });

  it('will not guess between two items with the same name and no SKU', () => {
    const shelf = [
      existing({ id: 'a', name: 'Rice', sku: null }),
      existing({ id: 'b', name: 'Rice', sku: null }),
    ];
    const preview = previewImport(file('Rice,,Grains,stock,pcs,20,10,,5'), shelf, FEATURES);
    expect(preview.errors[0]?.message).toBe(
      'More than one item is called Rice. Give it a SKU to choose one.',
    );
  });

  it('refuses the same name twice in a file when neither row has a SKU', () => {
    const preview = previewImport(
      file('Rice,,Grains,stock,pcs,20,10,,5', 'rice,,Grains,stock,pcs,21,10,,5'),
      [],
      FEATURES,
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors).toEqual([
      { row: 3, message: 'rice appears twice in this file. Give one of them a SKU.' },
    ]);
  });

  it('will not turn a stock item into a service', () => {
    const preview = previewImport(
      file('Nails,NA-01,Hardware,service,job,18,9,,'),
      [existing()],
      FEATURES,
    );
    expect(preview.errors[0]?.message).toBe('Nails, 2" is a stock item and stays one.');
  });

  it('does not read opening_qty on a matched item, so a 0 or a leftover negative cannot block a price edit', () => {
    const preview = previewImport(
      file('Nails,NA-01,Hardware,stock,pcs,18,9,,0', 'Wire,W-1,Hardware,stock,pcs,5,1,,-2'),
      [existing(), existing({ id: 'w', name: 'Wire', sku: 'W-1' })],
      FEATURES,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows.map((r) => r.matchId)).toEqual(['p1', 'w']);
  });

  it('reads an opening quantity of 0 on a new item as nothing on the shelf', () => {
    const preview = previewImport(file('Cement,CE-01,Hardware,stock,pcs,70,60,,0'), [], FEATURES);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.openingQty).toBe(0);
  });

  it('refuses a unit change that would leave part of a unit on hand', () => {
    const wire = existing({ id: 'w', name: 'Wire', sku: 'W-1', unit: 'm' });
    const preview = previewImport(file('Wire,W-1,Hardware,stock,pcs,5,1,,'), [wire], FEATURES, {
      w: qty(2.5),
    });
    expect(preview.errors[0]?.message).toBe(
      '2.5 m is on hand, which is not a whole number of pcs.',
    );
  });

  it('refuses a price or a cost with letters in it rather than reading the digits', () => {
    const preview = previewImport(
      file('A,A-1,X,stock,pcs,12abc,1,,', 'B,B-1,X,stock,pcs,12,xyz,,'),
      [],
      FEATURES,
    );
    expect(preview.errors).toEqual([
      { row: 2, message: 'Price is not a number.' },
      { row: 3, message: 'Cost is not a number.' },
    ]);
  });
});

describe('previewImport, second round', () => {
  it('matches by name when the owner filled in a SKU for an item that had none', () => {
    const shelf = [existing({ id: 'coke', name: 'Coke', sku: null })];
    const preview = previewImport(file('Coke,CK-1,Drinks,stock,pcs,25,15,,5'), shelf, FEATURES);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.matchId).toBe('coke');
    expect(preview.rows[0]?.product.sku).toBe('CK-1');
  });

  it('refuses two lines that land on the same item', () => {
    const shelf = [existing({ id: 'coke', name: 'Coke', sku: null })];
    const preview = previewImport(
      file('Coke,CK-1,Drinks,stock,pcs,25,15,,', 'Coke,CK-2,Drinks,stock,pcs,26,15,,'),
      shelf,
      FEATURES,
    );
    expect(preview.errors).toEqual([{ row: 3, message: 'Coke is on more than one line of this file.' }]);
  });

  it('reads the amounts people type and refuses the typos', () => {
    const price = (text: string) =>
      previewImport(file(`A,A-1,X,stock,pcs,"${text}",1,,`), [], FEATURES);
    for (const ok of ['25', '₱1,250.50', 'PHP 25', 'P25', '1,250', '0.5']) {
      expect(price(ok).errors, ok).toEqual([]);
    }
    for (const bad of ['1,2,3', '1,,,', '--5', '-₱-5', '25.505', '.', '12abc']) {
      expect(price(bad).errors[0]?.message, bad).toBe('Price is not a number.');
    }
  });

  it('refuses "." as a quantity rather than reading it as none', () => {
    const preview = previewImport(file('A,A-1,X,stock,pcs,5,1,,.'), [], FEATURES);
    expect(preview.errors[0]?.message).toBe('. is not a whole number of pcs.');
  });

  it('says a quote on the header line is never closed', () => {
    const preview = previewImport('"name,sku\r\nA,1\r\n', [], FEATURES);
    expect(preview.errors[0]?.message).toBe(
      'A quote (") on the first line is never closed, so the file could not be read.',
    );
  });

  it("keeps a name that already starts with an apostrophe and a formula sign", () => {
    const csv = exportProducts([existing({ name: "'=already" })], {});
    expect(previewImport(csv, [], FEATURES).rows[0]?.product.name).toBe("'=already");
  });
});

describe('previewImport and broken files', () => {
  it('names the line of a quote that is never closed, and keeps the lines before it', () => {
    const preview = previewImport(
      file(
        'Cement,CE-01,Hardware,stock,pcs,70,60,,',
        '"Nails,NA-01,Hardware,stock,pcs,18,9,,',
        'Rice,RI-01,Grains,stock,pcs,45,30,,',
      ),
      [],
      FEATURES,
    );
    expect(preview.rows.map((r) => r.product.name)).toEqual(['Cement']);
    expect(preview.errors).toEqual([
      {
        row: 3,
        message: 'A quote (") on this line is never closed, so it and the lines after it could not be read.',
      },
    ]);
  });
});

describe('exportProducts and spreadsheet formulas', () => {
  it('writes a name that looks like a formula as text, and reads it back unchanged', () => {
    const risky = existing({ name: '=HYPERLINK("x")', sku: '+SKU' });
    const csv = exportProducts([risky], {});
    expect(parseCsv(csv)[1]!.slice(0, 2)).toEqual(['\'=HYPERLINK("x")', "'+SKU"]);

    const back = previewImport(csv, [], FEATURES);
    expect(back.errors).toEqual([]);
    expect(back.rows[0]?.product).toMatchObject({ name: '=HYPERLINK("x")', sku: '+SKU' });
  });
});

describe('exportProducts', () => {
  it('writes the same columns, with the on-hand count in opening_qty', () => {
    expect(exportProducts([existing({ unit: 'm' })], { p1: qty(2.4) })).toBe(
      `${BOM}${HEADER}\r\n"Nails, 2""",NA-01,Hardware,stock,m,15.00,9.00,,2.4\r\n`,
    );
  });

  it('leaves a product with no reorder level of its own blank rather than inventing one', () => {
    expect(exportProducts([existing({ unit: 'm', reorderLevel: qty(0.5) })], {})).toContain(
      ',m,15.00,9.00,0.5,0\r\n',
    );
  });

  it('exports a service with a job unit and nothing to count', () => {
    expect(exportProducts([existing({ kind: 'service', sku: null, unit: 'job' })], {})).toBe(
      `${BOM}${HEADER}\r\n"Nails, 2""",,Hardware,service,job,15.00,9.00,,0\r\n`,
    );
  });

  it('round-trips: a file it wrote imports back with the same numbers', () => {
    const csv = exportProducts([existing({ unit: 'm' })], { p1: qty(2.4) });
    const preview = previewImport(csv, [], FEATURES);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.product).toMatchObject({
      name: 'Nails, 2"',
      sku: 'NA-01',
      priceCents: 1500,
      costCents: 900,
    });
    expect(preview.rows[0]?.openingQty).toBe(2400);
  });
});
