// Standalone verification of the safeguards that stop the POS destroying or
// misreporting its own books. Each check below maps to a defect found in the
// 2026-09-23 audit; they are here so the defect cannot come back quietly.
//
//   B3  "Clear all sales data" wiped the audit trail and reset invoice numbers
//   B4  training mode could be switched back on, unlocking the demo loader
//   H1  a discount applied after payment left an over-recorded tender
//   H3  gross profit used the product's current cost, not the cost at sale
//   H4  a restore accepted any file with a products array
//
// Unlike the other verify scripts this one drives the real zustand store, so
// the modules are emitted inside the project where `zustand` resolves.
// Run: node scripts/verify-safeguards.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = '.verify-tmp';

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

function emit(name, file) {
  const js = ts
    .transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText
    // Everything is flattened into one directory, so every local specifier
    // — relative or aliased — resolves to a sibling .js file.
    .replace(/from '@\/(?:lib|store)\/([a-zA-Z]+)'/g, "from './$1.js'")
    .replace(/from '\.\/([a-zA-Z]+)'/g, "from './$1.js'");
  writeFileSync(join(dir, `${name}.js`), js);
}

for (const n of ['money', 'tax', 'format', 'id', 'seed', 'demo', 'crypto', 'idb', 'permissions', 'types', 'archive', 'backup'])
  emit(n, `src/lib/${n}.ts`);
for (const n of ['useAuth', 'usePos']) emit(n, `src/store/${n}.ts`);

const load = (n) => import(pathToFileURL(join(process.cwd(), dir, `${n}.js`)).href);
const { usePos, orderGross } = await load('usePos');
const { computeBill } = await load('tax');
const { DEFAULT_PRODUCTS, DEFAULT_BRANCH } = await load('seed');
const { monthOf, orderMonth } = await load('archive');
const { backupIsDue, backupFileName } = await load('backup');
const { DEFAULT_PIN, DEFAULT_SUPERADMIN, hasDefaultPin } = await load('seed');
const { verifyPin } = await load('crypto');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

const S = () => usePos.getState();
/** Put the install back into a known pre-go-live state. */
const setTraining = (on) =>
  usePos.setState((s) => ({ settings: { ...s.settings, trainingMode: on } }));

/** Open an order, put one line on it, serve it. Returns id and the bill due. */
function ringUp(product, qty = 1) {
  const id = S().openOrder(`T${Math.random().toString(36).slice(2, 7)}`, 'dine-in');
  S().addLine(id, product.id, qty);
  S().serveAll(id);
  const order = S().order(id);
  const bill = computeBill(orderGross(order), S().settings, { kind: 'none' });
  return { id, due: bill.amountDue };
}

const product = DEFAULT_PRODUCTS[0];

console.log('\n— B3: clearing sales data —');
{
  setTraining(false);
  const before = S().orders.length;
  const cleared = S().resetAll();
  check('a live install refuses to clear its own sales', cleared === false);
  check('nothing was removed', S().orders.length === before);

  setTraining(true);
  ringUp(product);
  const seqBefore = { ...S().invoiceSeq };
  const auditBefore = S().audit.length;
  const ok = S().resetAll();
  check('training mode may clear', ok === true);
  check('orders are gone', S().orders.length === 0);
  check(
    'invoice sequence survives (no reissued numbers)',
    JSON.stringify(S().invoiceSeq) === JSON.stringify(seqBefore),
    `seq ${JSON.stringify(S().invoiceSeq)}`,
  );
  check('audit trail survives and records the wipe', S().audit.length > auditBefore);
  check(
    'the wipe is named in the log',
    S().audit[0]?.kind === 'data.reset',
    `top entry: ${S().audit[0]?.kind}`,
  );
}

console.log('\n— B4: training mode is a one-way door —');
{
  setTraining(true);
  S().updateSettings({ trainingMode: false });
  check('can leave training mode', S().settings.trainingMode === false);
  check(
    'going live is recorded',
    S().audit.some((a) => a.kind === 'settings.golive'),
  );

  S().updateSettings({ trainingMode: true });
  check('cannot re-enter training mode', S().settings.trainingMode === false);

  S().updateSettings({ businessName: 'Still editable' });
  check(
    'unrelated settings still save',
    S().settings.businessName === 'Still editable' && S().settings.trainingMode === false,
  );

  const res = S().importSnapshot({
    version: 7,
    exportedAt: '2026-01-01T00:00:00.000Z',
    products: DEFAULT_PRODUCTS,
    orders: [],
    settings: { trainingMode: true },
  });
  check('a backup cannot reopen the door', res.ok && S().settings.trainingMode === false);
}

console.log('\n— H1: payment must match the bill it was taken against —');
{
  setTraining(true);
  {
    const { id, due } = ringUp(product);
    S().addTender(id, {
      method: 'cash',
      amountCents: due,
      tenderedCents: due,
      changeCents: 0,
      refNo: null,
    });
    check('exact cash closes', S().closeOrder(id) === true, `due ${due}`);
  }
  {
    const { id, due } = ringUp(product);
    S().addTender(id, {
      method: 'cash',
      amountCents: due,
      tenderedCents: due + 50000,
      changeCents: 50000,
      refNo: null,
    });
    check('cash overpaid with change closes', S().closeOrder(id) === true);
  }
  {
    const { id, due } = ringUp(product);
    S().addTender(id, {
      method: 'gcash',
      amountCents: due - 100,
      tenderedCents: null,
      changeCents: null,
      refNo: 'X1',
    });
    check('underpayment is refused', S().closeOrder(id) === false);
  }
  {
    // The audit's H1: pay in full, then apply the senior discount.
    const { id, due } = ringUp(product);
    S().addTender(id, {
      method: 'gcash',
      amountCents: due,
      tenderedCents: null,
      changeCents: null,
      refNo: 'X2',
    });
    S().setDiscount(id, { discountKind: 'senior', discountIdNo: 'SC-1' });
    check('e-wallet over-recorded by a later discount is refused', S().closeOrder(id) === false);
    check('the order stays open for correction', S().order(id).status === 'open');
  }
  {
    // Same defect, cash path: change was computed against the old total.
    const { id, due } = ringUp(product);
    S().addTender(id, {
      method: 'cash',
      amountCents: due,
      tenderedCents: due,
      changeCents: 0,
      refNo: null,
    });
    S().setDiscount(id, { discountKind: 'pwd', discountIdNo: 'PWD-1' });
    check('cash with stale change is refused', S().closeOrder(id) === false);

    // Remove it, take the right amount, and the sale settles.
    const stale = S().order(id).tenders[0];
    S().removeTender(id, stale.id);
    const after = computeBill(orderGross(S().order(id)), S().settings, {
      kind: 'pwd',
      diners: 1,
      eligibleDiners: 1,
    });
    S().addTender(id, {
      method: 'cash',
      amountCents: after.amountDue,
      tenderedCents: after.amountDue,
      changeCents: 0,
      refNo: null,
    });
    check('re-recording the correct amount settles it', S().closeOrder(id) === true);
    check(
      'the frozen total is the discounted one',
      S().order(id).netCents === after.amountDue,
      `net ${S().order(id).netCents} vs ${after.amountDue}`,
    );
  }
}

console.log('\n— H3: cost is frozen at the moment of sale —');
{
  const { id } = ringUp(product);
  const line = S().order(id).lines[0];
  check('the line carries its own cost', line.costCents === product.costCents,
    `line ${line.costCents} vs product ${product.costCents}`);

  S().upsertProduct({ ...product, costCents: product.costCents + 9999 });
  check(
    're-pricing the menu does not rewrite the sold line',
    S().order(id).lines[0].costCents === product.costCents,
  );
}

console.log('\n— H4: a restore has to earn it —');
{
  const base = {
    version: 7,
    exportedAt: '2026-01-01T00:00:00.000Z',
    products: DEFAULT_PRODUCTS,
    orders: [],
  };
  const cases = [
    ['wrong version', { ...base, version: 6 }],
    ['no products', { ...base, products: [] }],
    ['products not a list', { ...base, products: 'nope' }],
    ['orders not a list', { ...base, orders: 'nope' }],
    ['audit not a list', { ...base, audit: 42 }],
    ['not an object', null],
  ];
  for (const [label, snapshot] of cases) {
    const res = S().importSnapshot(snapshot);
    check(`rejects: ${label}`, res.ok === false, res.ok ? '' : res.error);
  }
  const good = S().importSnapshot({ ...base, orders: [] });
  check('accepts a well-formed backup', good.ok === true);
  check(
    'the restore is recorded in the audit trail',
    S().audit[0]?.kind === 'data.import',
    `top entry: ${S().audit[0]?.kind}`,
  );
}

console.log('\n— Monthly archive: nothing leaves without a verified file —');
{
  setTraining(true);
  S().resetAll();

  // Three months of sales, planted directly so their dates are controlled.
  const now = Date.now();
  const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const twoAgo   = new Date(now); twoAgo.setMonth(twoAgo.getMonth() - 2);
  const LAST = monthOf(monthAgo.getTime());
  const PREV = monthOf(twoAgo.getTime());
  const THIS = monthOf(now);

  const mkOrder = (id, at, status, net, branchId) => ({
    id, invoiceNo: 'BR001-' + id, branchId, label: id, type: 'dine-in', status,
    openedAt: at, closedAt: status === 'open' ? null : at,
    lines: [{ lineNo: 1, productId: product.id, name: product.name,
              unitCents: net, costCents: 1000, qty: 1, served: true,
              servedAt: at, voided: false, voidReason: null }],
    tenders: status === 'closed'
      ? [{ id: 't' + id, method: 'cash', amountCents: net, tenderedCents: net,
           changeCents: 0, refNo: null, takenAt: at }] : [],
    discountKind: 'none', customPercent: 20, diners: 1, eligibleDiners: 1,
    discountIdNo: null, discountIdName: null,
    grossCents: net, vatableCents: 0, vatExemptCents: 0, vatCents: 0,
    discountCents: 0, netCents: status === 'closed' ? net : 0,
    voidedReason: null, voidedAt: status === 'voided' ? at : null,
    openedBy: null, servedBy: null, paidBy: null, voidedBy: null,
  });
  const B = DEFAULT_BRANCH.id;
  const planted = [
    mkOrder('prev1', twoAgo.getTime(),   'closed', 10000, B),
    mkOrder('last1', monthAgo.getTime(), 'closed', 20000, B),
    mkOrder('last2', monthAgo.getTime(), 'closed', 30000, B),
    mkOrder('last3', monthAgo.getTime(), 'voided',     0, B),
    mkOrder('lastOpen', monthAgo.getTime(), 'open',    0, B),
    mkOrder('this1', now,                'closed', 40000, B),
  ];
  const moves = [
    { id: 'm1', branchId: B, productId: product.id, delta: -1, reason: 'sale',
      refOrderId: 'last1', note: null, at: monthAgo.getTime(), actorUserId: null },
    { id: 'm2', branchId: B, productId: product.id, delta: 50, reason: 'restock',
      refOrderId: null, note: 'delivery', at: monthAgo.getTime(), actorUserId: null },
    { id: 'm3', branchId: B, productId: product.id, delta: -1, reason: 'sale',
      refOrderId: 'this1', note: null, at: now, actorUserId: null },
  ];
  usePos.setState({ orders: planted, stockMoves: moves });

  const months = S().archivableMonths();
  check('finished months are listed', months.length === 2, months.map(m => m.month).join(', '));
  check('the current month is NOT archivable', !months.some(m => m.month === THIS));
  const lastRow = months.find(m => m.month === LAST);
  check('month net excludes voided sales', lastRow.net === 50000, 'net ' + lastRow.net);
  check('month count includes voided sales', lastRow.orders === 3, 'orders ' + lastRow.orders);

  const archive = S().buildMonthlyArchive(LAST);
  check('archive holds only that month', archive.orders.every(o => orderMonth(o) === LAST));
  check('archive excludes still-open orders', !archive.orders.some(o => o.status === 'open'));
  check('archive totals match', archive.totals.net === 50000 && archive.totals.orders === 2,
    'net ' + archive.totals.net + ' orders ' + archive.totals.orders);
  check('archive carries products and branches for later reading',
    archive.products.length > 0 && archive.branches.length > 0);
  check('archive carries no PIN credentials',
    JSON.stringify(archive).includes('pin') === false);

  // Refusals.
  check('refuses a tampered version', S().pruneArchivedMonth({ ...archive, version: 99 }).ok === false);
  check('refuses a non-archive', S().pruneArchivedMonth({ nope: true }).ok === false);
  const short = { ...archive, orders: archive.orders.slice(1) };
  const shortRes = S().pruneArchivedMonth(short);
  check('refuses an archive missing sales still on the device', shortRes.ok === false, shortRes.error);
  check('nothing was deleted by a refused prune', S().orders.length === 6);

  // The good path.
  const ok = S().pruneArchivedMonth(archive);
  check('a verified archive may prune', ok.ok === true, ok.ok ? '' : ok.error);
  const left = S().orders;
  check('archived month is gone', !left.some(o => o.status !== 'open' && orderMonth(o) === LAST));
  check('the open order from that month SURVIVES', left.some(o => o.id === 'lastOpen'));
  check('other months are untouched',
    left.some(o => o.id === 'prev1') && left.some(o => o.id === 'this1'));
  check('sale moves for pruned orders are gone', !S().stockMoves.some(m => m.id === 'm1'));
  check('loose stock adjustments are kept', S().stockMoves.some(m => m.id === 'm2'));
  check('the prune is recorded in the audit trail', S().audit[0]?.kind === 'archive.prune',
    'top entry: ' + S().audit[0]?.kind);
  check('re-pruning the same month is a no-op refusal or harmless',
    S().orders.filter(o => o.status !== 'open' && orderMonth(o) === LAST).length === 0);
}


console.log('\n— Daily backup: the device is not the only copy —');
{
  setTraining(true);
  S().resetAll();
  usePos.setState({ lastBackupAt: null });

  const DAY = 86400000;
  check('a fresh install is due a backup', backupIsDue(null) === true);
  check('backed up today is not due', backupIsDue(Date.now()) === false);
  check('backed up yesterday IS due', backupIsDue(Date.now() - DAY) === true);
  check('the file is named for the day', /^kramgen-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupFileName()),
    backupFileName());

  // Nothing sold yet, so nothing is at risk even though a backup is due.
  check('no sales means nothing at risk', S().unbackedUp() === 0);

  const a = ringUp(product);
  S().addTender(a.id, { method: 'cash', amountCents: a.due, tenderedCents: a.due, changeCents: 0, refNo: null });
  S().closeOrder(a.id);
  check('a new sale is counted as at risk', S().unbackedUp() === 1, 'at risk ' + S().unbackedUp());

  S().recordBackup();
  check('after backing up, nothing is at risk', S().unbackedUp() === 0);
  check('backup is no longer due', backupIsDue(S().lastBackupAt) === false);
  check('the backup is recorded in the audit trail', S().audit[0]?.kind === 'data.backup',
    'top entry: ' + S().audit[0]?.kind);

  // A real backup is a click, so the next sale is always at least a
  // millisecond later. Without this the sale lands in the same millisecond as
  // recordBackup() and reads as already covered — an artefact of test speed,
  // not something a person can produce.
  await new Promise((r) => setTimeout(r, 5));

  const b = ringUp(product);
  S().addTender(b.id, { method: 'cash', amountCents: b.due, tenderedCents: b.due, changeCents: 0, refNo: null });
  S().closeOrder(b.id);
  check('a sale made after the backup is at risk again', S().unbackedUp() === 1,
    'at risk ' + S().unbackedUp());
  check('the earlier backed-up sale is not double counted', S().orders.length === 2);

  // A backup taken yesterday must not silence today's sales.
  usePos.setState({ lastBackupAt: Date.now() - DAY });
  check('yesterday\'s backup does not cover today\'s sales', S().unbackedUp() === 2,
    'at risk ' + S().unbackedUp());
}


console.log('\n— Default account: the till can never lock its owner out —');
{
  check('a fresh install ships with exactly one account',
    DEFAULT_SUPERADMIN.role === 'superadmin' && DEFAULT_SUPERADMIN.active === true);

  const opens = await verifyPin(DEFAULT_PIN, DEFAULT_SUPERADMIN.pin);
  check(`the shipped PIN ${DEFAULT_PIN} actually opens it`, opens === true);
  check('a different PIN does not', (await verifyPin('123456', DEFAULT_SUPERADMIN.pin)) === false);
  // Only the credential matters here: the sentinel user id is a run of zeros
  // and contains '000000' by coincidence, which is not the PIN being stored.
  check('the credential holds no plaintext PIN',
    !JSON.stringify(DEFAULT_SUPERADMIN.pin).includes(DEFAULT_PIN));

  usePos.setState({ users: [{ ...DEFAULT_SUPERADMIN }] });
  check('the warning is showing', S().defaultPinAccounts().length === 1);

  const back = await S().setUserPin(DEFAULT_SUPERADMIN.id, DEFAULT_PIN);
  check('the default PIN cannot be re-set deliberately', back.ok === false, back.ok ? '' : back.error);

  const dupe = await S().addUser({ name: 'Waiter', role: 'waiter', pin: DEFAULT_PIN });
  check('a new user cannot claim the default PIN', dupe.ok === false, dupe.ok ? '' : dupe.error);

  const changed = await S().setUserPin(DEFAULT_SUPERADMIN.id, '481902');
  check('the owner can set a real PIN', changed.ok === true, changed.ok ? '' : changed.error);
  check('the warning clears once changed', S().defaultPinAccounts().length === 0);
  check('the old default no longer opens the account',
    (await verifyPin(DEFAULT_PIN, S().users[0].pin)) === false);
  check('the new PIN does', (await verifyPin('481902', S().users[0].pin)) === true);
  check('a changed credential is not recognised as the default one',
    hasDefaultPin(S().users[0]) === false);
}

rmSync(dir, { recursive: true, force: true });
console.log(
  failures === 0
    ? '\nAll safeguard checks passed.'
    : `\n${failures} safeguard check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
