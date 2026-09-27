/**
 * Inventory in and out of the app as a spreadsheet.
 *
 * A CSV is the one format every shop's owner already has: Excel, Google
 * Sheets, LibreOffice, and the phone's own share sheet all open one, and all
 * of them save one. This is deliberately not a proprietary file.
 *
 * Nothing here writes. `previewImport` reads a file into something the screen
 * can show and the store can be handed, and the store makes the single write
 * — so the owner always sees what a file will do before it does it.
 */

import type { Features } from './presets';
import { parsePesos } from './money';
import { decimalsAllowed, formatQty, parseQty, qty, type Qty } from './qty';
import type { Product, ProductKind } from './types';

/** The columns of the template, in the order a spreadsheet expects them. */
export const CSV_COLUMNS = [
  'name',
  'sku',
  'category',
  'kind',
  'unit',
  'price',
  'cost',
  'reorder_level',
  'opening_qty',
] as const;

const HEADER_LINE = CSV_COLUMNS.join(', ');

/**
 * RFC 4180, with the three things real files do anyway: a UTF-8 BOM off the
 * front (Excel puts one there), CRLF or bare LF line endings (both turn up),
 * and a blank line at the end. Fields are returned exactly as written, minus
 * the quoting; nothing is trimmed here.
 */
export function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let started = false;
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
    started = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quoted) {
      // A quote inside a quoted field is a doubled one; anything else ends it.
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      started = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += ch;
      started = true;
    }
  }
  // A file with no final newline still has a last row worth reading.
  if (field !== '' || row.length > 0 || started) endRow();

  // A spreadsheet's trailing newline is not an item, and neither is the blank
  // line an owner left after it.
  while (rows.length > 0 && rows[rows.length - 1]!.every((f) => f.trim() === '')) {
    rows.pop();
  }
  return rows;
}

/** Quote only what has to be quoted: a comma, a quote or a line break. */
function quoteField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** CRLF endings, because that is what the RFC says and what Excel expects. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => `${row.map(quoteField).join(',')}\r\n`).join('');
}

/** One line of a file that passed every rule, and the product it becomes. */
export interface ImportRow {
  /** Line number in the file, the header being line 1 — what the owner sees. */
  row: number;
  product: Omit<Product, 'id' | 'active'>;
  openingQty: Qty;
  /** The id of the item this line updates, or null when it is a new one. */
  matchId: string | null;
}

export interface ImportPreview {
  rows: ImportRow[];
  errors: { row: number; message: string }[];
}

const KINDS: readonly string[] = ['stock', 'service'];

/**
 * Read a file into rows and errors without touching anything.
 *
 * A file is somebody's day of work typed into a spreadsheet, so one bad line
 * must not void the other three hundred. Bad rows are reported and left out;
 * the good ones are returned and can be imported on their own.
 */
export function previewImport(
  text: string,
  existing: Product[],
  features: Features,
): ImportPreview {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], errors: [{ row: 1, message: 'That file is empty.' }] };
  }

  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const index = new Map(header.map((h, i) => [h, i]));
  const missing = CSV_COLUMNS.filter((c) => !index.has(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        { row: 1, message: `The first line is missing: ${missing.join(', ')}. Expected: ${HEADER_LINE}.` },
      ],
    };
  }
  const cell = (row: string[], column: string): string => (row[index.get(column)!] ?? '').trim();

  const rows: ImportRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const bySku = new Map(existing.map((p) => [p.sku, p]));
  const seen = new Set<string>();

  for (let i = 1; i < table.length; i += 1) {
    const source = table[i]!;
    // A blank line inside a file is nobody's item.
    if (source.every((f) => f.trim() === '')) continue;
    const line = i + 1;
    const problems: string[] = [];
    const add = (message: string) => problems.push(message);

    const name = cell(source, 'name');
    if (name === '') add('Name is missing.');

    const kindText = cell(source, 'kind').toLowerCase();
    const kind = KINDS.includes(kindText) ? (kindText as ProductKind) : null;
    if (kind === null) add('Kind must be stock or service.');

    const unit = cell(source, 'unit') || (kind === 'service' ? 'job' : 'pcs');
    const decimals = decimalsAllowed(unit, features);

    const priceText = cell(source, 'price');
    const priceCents = parsePesos(priceText);
    // parsePesos reads ₱25 and 1,250 happily, and turns anything else into 0 —
    // which on a shelf of a hundred items is not a shrug, it is a giveaway.
    if (priceText === '') add('Price is missing.');
    else if (!/\d/.test(priceText)) add('Price is not a number.');
    else if (priceCents < 0) add('Price cannot be negative.');

    const costText = cell(source, 'cost');
    const costCents = parsePesos(costText === '' ? '0' : costText);
    if (costCents < 0) add('Cost cannot be negative.');

    // A service is never on a shelf, so it has no reorder level to read.
    const levelText = cell(source, 'reorder_level');
    let reorderLevel: Qty | null = null;
    if (kind === 'stock' && levelText !== '') {
      reorderLevel = parseQty(levelText, decimals);
      if (reorderLevel === null) add(`${levelText} is not a whole number of ${unit}.`);
    }

    const openingText = cell(source, 'opening_qty');
    let openingQty: Qty = qty(0);
    if (kind === 'stock' && openingText !== '') {
      const parsed = parseQty(openingText, decimals);
      if (parsed === null) add(`${openingText} is not a whole number of ${unit}.`);
      else openingQty = parsed;
    }

    const sku = cell(source, 'sku');
    let matchId: string | null = null;
    if (sku !== '') {
      if (seen.has(sku)) add(`SKU ${sku} appears twice in this file.`);
      seen.add(sku);
      matchId = bySku.get(sku)?.id ?? null;
    }

    if (problems.length > 0) {
      for (const message of problems) errors.push({ row: line, message });
      continue;
    }

    rows.push({
      row: line,
      product: {
        name,
        kind: kind!,
        sku: sku === '' ? null : sku,
        category: cell(source, 'category'),
        unit,
        priceCents,
        costCents,
        vatExempt: false,
        reorderLevel,
      },
      openingQty,
      matchId,
    });
  }

  return { rows, errors };
}

/** A blank file with the right columns, so "Download template" is something to fill in. */
export function csvTemplate(): string {
  return toCsv([CSV_COLUMNS as unknown as string[]]);
}

/**
 * Every item, in the format the template uses, with today's on-hand count in
 * the last column. Round-trips: an owner can export, edit prices in a
 * spreadsheet, and import the file back over the top.
 */
export function exportProducts(products: Product[], stock: Record<string, Qty>): string {
  return toCsv([
    CSV_COLUMNS as unknown as string[],
    ...products.map((p) => [
      p.name,
      p.sku ?? '',
      p.category,
      p.kind,
      p.unit,
      (p.priceCents / 100).toFixed(2),
      (p.costCents / 100).toFixed(2),
      p.reorderLevel === null ? '' : formatQty(p.reorderLevel),
      formatQty(stock[p.id] ?? qty(0)),
    ]),
  ]);
}
