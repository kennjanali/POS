// Standalone verification of the demo data generator. The point of demo data
// is to look at a working app, so it has to obey the same invariants the real
// paths do: frozen totals that match the tax engine, gapless per-branch
// invoice numbers, and a stock ledger that reconciles.
// Run: node scripts/verify-demo.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = mkdtempSync(join(tmpdir(), 'demo-'));

function emit(name, file) {
  const src = readFileSync(file, 'utf8');
  const js = ts
    .transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText // relative specifiers need an extension once they are real files
    .replace(/from '\.\/([a-z]+)'/g, "from './$1.js'");
  writeFileSync(join(dir, `${name}.js`), js);
}

for (const name of ['money', 'tax', 'format', 'id', 'seed', 'demo']) {
  emit(name, `src/lib/${name}.ts`);
}

const load = (name) => import(pathToFileURL(join(dir, `${name}.js`)).href);
const { buildDemoData } = await load('demo');
const { computeBill } = await load('tax');
const { DEFAULT_BRANCH, DEFAULT_PRODUCTS, DEFAULT_SETTINGS, OPENING_STOCK } =
  await load('seed');
const { businessDate } = await load('format');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

// Run against a VAT-registered profile too — the frozen-total check is only
// interesting when there is actually VAT and a statutory exemption in play.
for (const settings of [
  DEFAULT_SETTINGS,
  { ...DEFAULT_SETTINGS, vatRegistered: true },
]) {
  const label = settings.vatRegistered ? 'VAT-registered' : 'non-VAT';
  console.log(`\n— ${label} —`);

  const days = 30;
  const ordersPerDay = 40;
  const data = buildDemoData({
    products: DEFAULT_PRODUCTS,
    settings,
    mainBranch: DEFAULT_BRANCH,
    days,
    ordersPerDay,
  });

  check('three branches generated', data.branches.length === 3, `got ${data.branches.length}`);

  // ── volume ───────────────────────────────────────────────────────────
  const dates = new Set(data.orders.map((o) => businessDate(o.openedAt)));
  check(`${days} distinct business dates`, dates.size === days, `got ${dates.size}`);

  const perDayPerBranch = data.orders.length / (days * data.branches.length);
  check(
    `~${ordersPerDay} orders per branch per day`,
    perDayPerBranch > ordersPerDay * 0.75 && perDayPerBranch < ordersPerDay * 1.3,
    `got ${perDayPerBranch.toFixed(1)} (${data.orders.length} orders total)`,
  );

  const statuses = { open: 0, closed: 0, voided: 0 };
  for (const o of data.orders) statuses[o.status]++;
  check('open orders exist on the floor', statuses.open > 0, `open ${statuses.open}`);
  check('voided orders exist', statuses.voided > 0, `voided ${statuses.voided}`);
  check(
    'closed orders dominate',
    statuses.closed > data.orders.length * 0.9,
    `closed ${statuses.closed} of ${data.orders.length}`,
  );

  // ── frozen totals match the tax engine ───────────────────────────────
  let mismatch = 0;
  let netTotal = 0;
  let underpaid = 0;
  const kinds = new Set();
  for (const order of data.orders) {
    if (order.status === 'open') continue;
    const served = order.lines.filter((l) => l.served && !l.voided);
    const gross = served.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
    const bill = computeBill(gross, settings, {
      kind: order.discountKind,
      customPercent: order.customPercent,
      diners: order.diners,
      eligibleDiners: order.eligibleDiners,
    });
    kinds.add(order.discountKind);
    if (
      order.grossCents !== bill.gross ||
      order.netCents !== bill.amountDue ||
      order.vatCents !== bill.vat ||
      order.vatableCents !== bill.vatableSale ||
      order.vatExemptCents !== bill.vatExemptSale ||
      order.discountCents !== bill.discount
    ) {
      mismatch++;
    }
    const paid = order.tenders.reduce((s, t) => s + t.amountCents, 0);
    if (paid < order.netCents) underpaid++;
    if (order.status === 'closed') netTotal += order.netCents;
  }
  check('every frozen total matches computeBill', mismatch === 0, `${mismatch} mismatched`);
  check('every settled order is paid in full', underpaid === 0, `${underpaid} underpaid`);
  check(
    'all four discount kinds represented',
    kinds.size === 4,
    [...kinds].sort().join(', '),
  );
  console.log(`      net sales over the month: ${(netTotal / 100).toFixed(2)}`);

  // ── invoice numbers: gapless and chronological, per branch ───────────
  for (const branch of data.branches) {
    const rows = data.orders
      .filter((o) => o.branchId === branch.id)
      .sort((a, b) => a.openedAt - b.openedAt);
    const seqs = rows.map((o) => Number(o.invoiceNo.split('-')[1]));
    const gapless = seqs.every((n, i) => n === i + 1);
    const prefixed = rows.every((o) => o.invoiceNo.startsWith(`${branch.branchCode}-`));
    check(`${branch.name}: invoice sequence gapless and in time order`, gapless);
    check(`${branch.name}: invoice numbers carry the branch code`, prefixed);
    check(
      `${branch.name}: invoiceSeq matches the last invoice issued`,
      data.invoiceSeq[branch.id] === rows.length,
      `seq ${data.invoiceSeq[branch.id]} vs ${rows.length} orders`,
    );
  }

  // ── stock ledger reconciles with the on-hand map ─────────────────────
  const ledger = {};
  for (const move of data.stockMoves) {
    ledger[move.branchId] ??= {};
    ledger[move.branchId][move.productId] =
      (ledger[move.branchId][move.productId] ?? 0) + move.delta;
  }
  let drift = 0;
  let negative = 0;
  for (const branch of data.branches) {
    for (const product of DEFAULT_PRODUCTS) {
      const onHand = data.stock[branch.id]?.[product.id] ?? 0;
      if (onHand !== (ledger[branch.id]?.[product.id] ?? 0)) drift++;
      if (onHand < 0) negative++;
    }
  }
  check('on-hand equals the sum of every stock move', drift === 0, `${drift} adrift`);
  check('no product ends the month negative', negative === 0, `${negative} negative`);

  const opening = data.stockMoves.filter((m) => m.reason === 'opening');
  check(
    'one opening count per product per branch',
    opening.length === DEFAULT_PRODUCTS.length * data.branches.length &&
      opening.every((m) => m.delta === OPENING_STOCK),
  );
  const sales = data.stockMoves.filter((m) => m.reason === 'sale');
  check('sale moves are all deductions', sales.every((m) => m.delta < 0));
  check(
    'every sale move references its order',
    sales.every((m) => typeof m.refOrderId === 'string'),
  );
}

// Determinism: the same options must produce the same money, so two people
// reading the dashboard see the same figures.
const opts = {
  products: DEFAULT_PRODUCTS,
  settings: DEFAULT_SETTINGS,
  mainBranch: DEFAULT_BRANCH,
  days: 5,
  ordersPerDay: 10,
  now: Date.UTC(2026, 0, 15, 12),
};
const a = buildDemoData(opts);
const b = buildDemoData(opts);
const money = (d) => d.orders.map((o) => `${o.invoiceNo}:${o.netCents}`).join('|');
console.log('\n— determinism —');
check('same options produce identical sales', money(a) === money(b));

console.log(
  failures === 0
    ? '\nAll demo-data checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
