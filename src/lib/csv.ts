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
  return parse(text).rows;
}

/**
 * The parser itself. `openQuote` is the record (1-based) where a quote was
 * opened and never closed: everything after it was swallowed into one field,
 * and the preview has to say so rather than quietly lose the rest of the file.
 */
function parse(text: string): { rows: string[][]; openQuote: number | null } {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let started = false;
  let quoted = false;
  let openedAt = 0;

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
      openedAt = rows.length + 1;
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
  const openQuote = quoted ? openedAt : null;
  // A file with no final newline still has a last row worth reading.
  if (field !== '' || row.length > 0 || started) endRow();

  // A spreadsheet's trailing newline is not an item, and neither is the blank
  // line an owner left after it.
  while (rows.length > 0 && rows[rows.length - 1]!.every((f) => f.trim() === '')) {
    rows.pop();
  }
  return { rows, openQuote };
}

/**
 * A spreadsheet runs a cell that starts with = + - or @ as a formula, so a
 * product called "=HYPERLINK(...)" would do something when the file is opened.
 * Text cells like that go out with a leading apostrophe, and come back in
 * without it.
 */
const FORMULA = /^'?[=+\-@]/;
const guardText = (text: string) => (FORMULA.test(text) ? `'${text}` : text);
const unguardText = (text: string) => (/^'(?='?[=+\-@])/.test(text) ? text.slice(1) : text);

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
 * An amount as a spreadsheet writes one: `25`, `1,250.50`, `₱25`, `PHP 25`.
 * parsePesos reads far more than that — `12abc` as 12, `ask me` as 0 — so the
 * cell is checked before it is read.
 */
function isAmount(text: string): boolean {
  // Thousands in groups of three, at most two decimals: "1,2,3" and "25.505"
  // are typos, not prices.
  return /^-?\s*(?:₱|php|p)?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/i.test(text);
}

/** A quantity cell: blank or zero means none; anything else goes through parseQty. */
function readQty(text: string, decimals: boolean): Qty | null {
  if (text === '' || /^(?:0+(?:\.0*)?|0*\.0+)$/.test(text)) return qty(0);
  return parseQty(text, decimals);
}

/** Names match the way an owner reads them: ignoring case and stray spaces. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

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
  onHand: Record<string, Qty> = {},
): ImportPreview {
  const { rows: table, openQuote } = parse(text);
  if (openQuote !== null) {
    // The last record holds the unclosed quote and everything after it.
    table.splice(openQuote - 1);
  }
  if (table.length === 0) {
    const message =
      openQuote === 1
        ? 'A quote (") on the first line is never closed, so the file could not be read.'
        : 'That file is empty.';
    return { rows: [], errors: [{ row: 1, message }] };
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
  const cell = (row: string[], column: string): string =>
    unguardText((row[index.get(column)!] ?? '').trim());

  const rows: ImportRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const bySku = new Map(existing.filter((p) => p.sku !== null).map((p) => [p.sku, p]));
  // An item without a SKU is found by its name — the export writes items
  // without one, and importing that file back must update them, not copy them.
  const byName = new Map<string, Product[]>();
  for (const p of existing) {
    if (p.sku !== null) continue;
    const key = nameKey(p.name);
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const matched = new Set<string>();

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
    else if (!isAmount(priceText)) add('Price is not a number.');
    else if (priceCents < 0) add('Price cannot be negative.');

    const costText = cell(source, 'cost');
    const costCents = parsePesos(costText === '' ? '0' : costText);
    if (costText !== '' && !isAmount(costText)) add('Cost is not a number.');
    else if (costCents < 0) add('Cost cannot be negative.');

    const quantityProblem = (text: string) =>
      decimals ? `${text} is not a quantity of ${unit}.` : `${text} is not a whole number of ${unit}.`;

    // A service is never on a shelf, so it has no reorder level to read.
    const levelText = cell(source, 'reorder_level');
    let reorderLevel: Qty | null = null;
    if (kind === 'stock' && levelText !== '') {
      reorderLevel = readQty(levelText, decimals);
      if (reorderLevel === null) add(quantityProblem(levelText));
    }

    const sku = cell(source, 'sku');
    let match: Product | null = null;
    if (sku !== '') {
      if (seen.has(sku)) add(`SKU ${sku} appears twice in this file.`);
      seen.add(sku);
      match = bySku.get(sku) ?? null;
    }
    // A new SKU may be one the owner just filled in for an item that had none,
    // so an unknown SKU still looks for the item by name.
    if (match === null && name !== '') {
      const key = nameKey(name);
      if (sku === '') {
        if (seenNames.has(key)) add(`${name} appears twice in this file. Give one of them a SKU.`);
        seenNames.add(key);
      }
      const named = byName.get(key) ?? [];
      if (named.length > 1) add(`More than one item is called ${name}. Give it a SKU to choose one.`);
      match = named.length === 1 ? named[0]! : null;
    }
    if (match) {
      if (matched.has(match.id)) add(`${match.name} is on more than one line of this file.`);
      matched.add(match.id);
    }

    if (match && kind !== null && match.kind !== kind) {
      // Sales and the stock ledger are filed under the kind; a stocked item
      // turned into a service would strand what is on the shelf.
      add(`${match.name} is a ${match.kind === 'stock' ? 'stock item' : 'service'} and stays one.`);
    }
    if (match && match.kind === 'stock' && unit !== match.unit && !decimals) {
      const held = onHand[match.id] ?? qty(0);
      if (held % 1000 !== 0) {
        add(`${formatQty(held)} ${match.unit} is on hand, which is not a whole number of ${unit}.`);
      }
    }

    // A matched item has been counted already: its opening_qty is not read, or
    // importing the same file twice would double the shelf.
    const openingText = cell(source, 'opening_qty');
    let openingQty: Qty = qty(0);
    if (kind === 'stock' && match === null) {
      const parsed = readQty(openingText, decimals);
      if (parsed === null) add(quantityProblem(openingText));
      else openingQty = parsed;
    }
    const matchId = match?.id ?? null;

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

  if (openQuote !== null) {
    errors.push({
      row: openQuote,
      message: 'A quote (") on this line is never closed, so it and the lines after it could not be read.',
    });
  }
  return { rows, errors };
}

/**
 * Excel opens a CSV as the PC's own code page unless the file starts with a
 * UTF-8 BOM, and then Ñ and ₱ come out garbled. parseCsv takes it off again.
 */
const BOM = '﻿';

/** A blank file with the right columns, so "Download template" is something to fill in. */
export function csvTemplate(): string {
  return BOM + toCsv([CSV_COLUMNS as unknown as string[]]);
}

/**
 * Every item, in the format the template uses, with today's on-hand count in
 * the last column. Round-trips: an owner can export, edit prices in a
 * spreadsheet, and import the file back over the top.
 */
export function exportProducts(products: Product[], stock: Record<string, Qty>): string {
  return BOM + toCsv([
    CSV_COLUMNS as unknown as string[],
    ...products.map((p) => [
      guardText(p.name),
      guardText(p.sku ?? ''),
      guardText(p.category),
      p.kind,
      guardText(p.unit),
      (p.priceCents / 100).toFixed(2),
      (p.costCents / 100).toFixed(2),
      p.reorderLevel === null ? '' : formatQty(p.reorderLevel),
      formatQty(stock[p.id] ?? qty(0)),
    ]),
  ]);
}
