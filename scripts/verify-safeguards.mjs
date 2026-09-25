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

for (const n of ['brand', 'money', 'tax', 'format', 'id', 'seed', 'demo', 'crypto', 'idb', 'storage', 'printer', 'receipt', 'permissions', 'types', 'archive', 'files', 'backup', 'closes'])
  emit(n, `src/lib/${n}.ts`);
for (const n of ['useAuth', 'usePos']) emit(n, `src/store/${n}.ts`);

const load = (n) => import(pathToFileURL(join(process.cwd(), dir, `${n}.js`)).href);
const { usePos, orderGross } = await load('usePos');
const { computeBill } = await load('tax');
const { SAMPLE_MENU, DEFAULT_BRANCH } = await load('seed');
const { monthOf, orderMonth } = await load('archive');
const { backupIsDue, backupFileName, endOfDayDue, CUTOFF_MINUTES } = await load('backup');
const { verifyPin, generateRecoveryCode } = await load('crypto');

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

const product = SAMPLE_MENU[0];

const OWNER_PIN = '481902';
const RECOVERY = generateRecoveryCode();
const setupInput = {
  business: {
    businessName: 'Test Carinderia',
    address: 'Somewhere',
    vatRegistered: false,
    pricesIncludeVat: true,
  },
  sampleMenu: true,
  ownerName: 'Owner',
  pin: OWNER_PIN,
  recoveryCode: RECOVERY,
};

console.log('\n— First run: no shipped account, the wizard sets the install up —');
{
  check('a fresh install has nobody on it', S().users.length === 0);
  check('and no menu of its own', S().products.length === 0);
  check('and no business name', S().settings.businessName === '');

  const nameless = await S().setupInstall({
    ...setupInput,
    business: { ...setupInput.business, businessName: '  ' },
  });
  check('setup refuses a business with no name', nameless.ok === false);
  check('and writes nothing', S().users.length === 0);

  const done = await S().setupInstall(setupInput);
  check('setup succeeds', done.ok === true, done.ok ? '' : done.error);
  const [owner] = S().users;
  check('exactly one account, a superadmin', S().users.length === 1 && owner.role === 'superadmin');
  check('the chosen PIN opens it', (await verifyPin(OWNER_PIN, owner.pin)) === true);
  check('the credential holds no plaintext PIN', !JSON.stringify(owner.pin).includes(OWNER_PIN));
  check('the recovery code is stored only as a hash',
    S().recovery !== null && !JSON.stringify(S().recovery).includes(RECOVERY.replace(/-/g, '')));
  check('the business is named', S().settings.businessName === 'Test Carinderia');
  check('the sample menu was loaded', S().products.length === SAMPLE_MENU.length);

  const again = await S().setupInstall(setupInput);
  check('setup cannot run twice', again.ok === false && S().users.length === 1);

  const installId = S().installId;
  check('setup gives the install an identity', typeof installId === 'string' && installId.length > 0);
  const snapshot = S().exportSnapshot();
  check('a backup names the install and the build',
    snapshot.installId === installId && typeof snapshot.appVersion === 'string');
  S().importSnapshot({ ...snapshot, installId: 'someone-elses-device' });
  check('a restore keeps this device\'s identity', S().installId === installId);
}

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
    products: SAMPLE_MENU,
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
    products: SAMPLE_MENU,
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

console.log('\n— Migration: a backup from the KRAMGEN v7 build still restores —');
{
  setTraining(true);
  const { id, due } = ringUp(product, 2);
  S().addTender(id, { method: 'cash', amountCents: due, tenderedCents: due, changeCents: 0, refNo: null });
  S().closeOrder(id);

  // What the v7 build wrote: the same shape, minus everything added since.
  const v7 = S().exportSnapshot();
  delete v7.installId;
  delete v7.appVersion;
  delete v7.recovery;
  const before = { orders: v7.orders.length, seq: JSON.stringify(v7.invoiceSeq), users: v7.users.length };
  const keptRecovery = S().recovery;
  const keptInstall = S().installId;

  const res = S().importSnapshot(JSON.parse(JSON.stringify(v7)));
  check('a v7 backup is accepted', res.ok === true, res.ok ? '' : res.error);
  check('every sale comes back', S().orders.length === before.orders, `orders ${S().orders.length}`);
  check('the invoice sequence comes back', JSON.stringify(S().invoiceSeq) === before.seq);
  check('the staff come back', S().users.length === before.users);
  check('the closed sale keeps its frozen total', S().order(id)?.netCents === due);
  check('the install keeps its recovery code', S().recovery === keptRecovery);
  check('and its identity', S().installId === keptInstall);
}

console.log('\n— Daily close: every sale counted once, the chain shows tampering —');
{
  const { brokenLink } = await load('closes');
  setTraining(true);
  const pay = (id, due) => {
    S().addTender(id, { method: 'cash', amountCents: due, tenderedCents: due, changeCents: 0, refNo: null });
    S().closeOrder(id);
  };

  // Whatever earlier sections left unclosed goes into a first close.
  await S().closeDay();
  check('nothing new means no close', (await S().closeDay()) === null);

  const a = ringUp(product, 1);
  pay(a.id, a.due);
  const b = ringUp(product, 2);
  pay(b.id, b.due);
  const first = await S().closeDay();
  check('a close covers the sales since the last one', first.orders === 2, `orders ${first.orders}`);
  check('its net is those sales', first.netCents === a.due + b.due, `net ${first.netCents}`);
  check('tenders add up to the net', first.tenders.cash === first.netCents);

  // Next window: one new sale, and one sale from the closed window voided.
  const c = ringUp(product, 3);
  pay(c.id, c.due);
  S().voidOrder(a.id, 'customer complaint');
  const second = await S().closeDay();
  check('an earlier sale voided later is deducted here', second.voidedEarlierCents === a.due);
  check('net is new sales less that void', second.netCents === c.due - a.due, `net ${second.netCents}`);
  check('the running total carries across closes',
    second.runningNetCents === first.runningNetCents + second.netCents);
  check('the earlier close was not rewritten', S().closes.find((x) => x.id === first.id) === first);

  const chain = S().closes;
  check('the chain is intact', (await brokenLink(chain)) === null);
  const edited = chain.map((x) => (x.id === first.id ? { ...x, netCents: x.netCents - 100 } : x));
  check('editing an old close breaks the chain', (await brokenLink(edited)) === first.no);
  const dropped = chain.filter((x) => x.id !== first.id);
  check('dropping a close breaks the chain', (await brokenLink(dropped)) !== null);
  check('closes travel in backups', S().exportSnapshot().closes.length === chain.length);

  const { renderClose } = await load('receipt');
  const slip = renderClose(second, S().settings, 32).split('\n');
  check('the close slip fits 58 mm paper', Math.max(...slip.map((l) => l.length)) <= 32);
}

console.log('\n— Thermal receipt: never wider than the paper —');
{
  const { renderReceipt } = await load('receipt');
  const { escpos, toPrintable, COLUMNS } = await load('printer');

  setTraining(true);
  const long = { ...product, id: 'long-name', name: 'Extra Special Chicken Inasal Family Platter with Java Rice' };
  S().upsertProduct(long);
  S().adjustStock(long.id, 5, 'restock');
  const { id, due } = ringUp(long, 3);
  S().addTender(id, { method: 'gcash', amountCents: due, tenderedCents: null, changeCents: null, refNo: '1234567890123' });
  S().closeOrder(id);
  const order = S().order(id);

  for (const width of [COLUMNS[58], COLUMNS[80]]) {
    const lines = renderReceipt(order, S().settings, width).split('\n');
    const widest = Math.max(...lines.map((l) => l.length));
    check(`no line runs past ${width} columns`, widest <= width, `widest ${widest}`);
  }
  const slip = renderReceipt(order, S().settings, 32);
  check('the total is on the slip', slip.includes((due / 100).toFixed(2)));
  check('the slip says it is not an official receipt', slip.includes('NOT AN OFFICIAL'));

  check('accents and the peso sign fold to plain ASCII', toPrintable('Niño ₱5 — ok') === 'Nino P5 ? ok',
    JSON.stringify(toPrintable('Niño ₱5 — ok')));
  const bytes = escpos('Hi');
  check('bytes start with a printer reset', bytes[0] === 0x1b && bytes[1] === 0x40);
  check('and end with a cut', bytes.at(-3) === 0x1d && bytes.at(-2) === 0x56);
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
  check('the file is named for the day', /^pos034-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupFileName()),
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


console.log('\n— Recovery code: the way back in without a shipped PIN —');
{
  const owner = S().users.find((u) => u.role === 'superadmin');
  check('a wrong code does not match', (await S().recoveryCodeMatches('AAAA-AAAA-AAAA')) === false);
  check('the right code matches, ignoring case and dashes',
    (await S().recoveryCodeMatches(RECOVERY.toLowerCase().replace(/-/g, ''))) === true);

  const refused = await S().resetPinWithRecoveryCode('AAAA-AAAA-AAAA', owner.id, '739104');
  check('a wrong code cannot reset a PIN', refused.ok === false);
  check('the PIN is unchanged', (await verifyPin(OWNER_PIN, S().user(owner.id).pin)) === true);

  const reset = await S().resetPinWithRecoveryCode(RECOVERY, owner.id, '739104');
  check('the right code resets the PIN', reset.ok === true, reset.ok ? '' : reset.error);
  check('the new PIN opens the account', (await verifyPin('739104', S().user(owner.id).pin)) === true);
  check('the old PIN no longer does', (await verifyPin(OWNER_PIN, S().user(owner.id).pin)) === false);
  check('the reset is named in the log', S().audit[0]?.kind === 'user.recover');

  const replacement = generateRecoveryCode();
  await S().replaceRecoveryCode(replacement);
  check('a replaced code stops working', (await S().recoveryCodeMatches(RECOVERY)) === false);
  check('the new one works', (await S().recoveryCodeMatches(replacement)) === true);
  check('a backup carries the recovery hash', S().exportSnapshot().recovery === S().recovery);
}


console.log('\n— Automatic backup: fires by itself, never twice —');
{
  const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  const NOON     = at(2026, 9, 23, 12, 0);
  const CLOSING  = at(2026, 9, 23, 23, 59);
  const LATE     = at(2026, 9, 23, 23, 30);
  const NEXT_AM  = at(2026, 9, 24, 8, 30);
  const YESTERDAY= at(2026, 9, 22, 23, 59);

  check('cutoff is 23:59', CUTOFF_MINUTES === 23 * 60 + 59, String(CUTOFF_MINUTES));

  check('mid-day with today already saved: no',
    endOfDayDue(NOON - 3600000, 5, NOON) === false);
  check('mid-day, never saved, sales waiting: YES (catch-up)',
    endOfDayDue(null, 5, NOON) === true);
  check('mid-day, last saved yesterday, sales waiting: YES (catch-up)',
    endOfDayDue(YESTERDAY, 5, NOON) === true);

  check('23:30 with today already saved: no',
    endOfDayDue(at(2026, 9, 23, 9, 0), 5, LATE) === false);
  check('23:59 with today not saved: YES (closing)',
    endOfDayDue(YESTERDAY, 5, CLOSING) === true);
  check('23:59 but today already saved: no',
    endOfDayDue(at(2026, 9, 23, 9, 0), 5, CLOSING) === false);

  check('no unsaved sales: never fires, even at 23:59',
    endOfDayDue(YESTERDAY, 0, CLOSING) === false);
  check('no unsaved sales and never backed up: still no',
    endOfDayDue(null, 0, NOON) === false);

  check('next morning after an unsaved night: YES',
    endOfDayDue(YESTERDAY, 3, NEXT_AM) === true);

  // The loop the interval would run: once it saves, it must go quiet.
  let last = YESTERDAY;
  let saves = 0;
  for (let m = 0; m < 24 * 60; m += 1) {
    const now = at(2026, 9, 23, 0, 0) + m * 60000;
    if (endOfDayDue(last, 4, now)) { saves += 1; last = now; }
  }
  check('over a whole day of minute ticks it saves exactly once', saves === 1,
    'saves: ' + saves);

  // Two quiet days then a sale: one file, not a backlog of them.
  last = at(2026, 9, 20, 23, 59);
  saves = 0;
  for (let m = 0; m < 3 * 24 * 60; m += 1) {
    const now = at(2026, 9, 21, 0, 0) + m * 60000;
    if (endOfDayDue(last, 4, now)) { saves += 1; last = now; }
  }
  check('three days running produces three files, one per day', saves === 3,
    'saves: ' + saves);
}

console.log('');
console.log('— Demo data: never two branches on one BIR code —');
{
  setTraining(true);
  // The owner adds a branch first. The demo set ships BR002/00001 and
  // BR003/00002, so this one collides on id with the first and on branch code
  // with the second — the two ways a demo load used to corrupt the numbering.
  usePos.setState((s) => ({
    branches: [
      s.branches[0],
      {
        id: 'BR002',
        name: 'Mall Branch',
        address: '',
        branchCode: '00002',
        color: '#2563eb',
        active: true,
      },
    ],
  }));

  const written = S().loadDemoData({ days: 2, ordersPerDay: 3 });
  const branches = S().branches;
  const codes = branches.map((b) => b.branchCode);

  check(
    'branch codes stay unique after a demo load',
    new Set(codes).size === codes.length,
    `codes: ${codes.join(', ')}`,
  );
  check(
    "the owner's own branch is untouched",
    branches.find((b) => b.id === 'BR002')?.name === 'Mall Branch',
  );

  const known = new Set(branches.map((b) => b.id));
  check(
    'every demo order belongs to a branch that exists',
    S().orders.every((o) => known.has(o.branchId)),
  );

  // The real failure: two sales, two branches, one invoice number.
  const seen = new Map();
  let clashes = 0;
  for (const o of S().orders) {
    if (seen.has(o.invoiceNo) && seen.get(o.invoiceNo) !== o.branchId) clashes += 1;
    seen.set(o.invoiceNo, o.branchId);
  }
  check('no invoice number is issued twice', clashes === 0, `clashes: ${clashes}`);

  // And the next number the till hands out must not land inside a range
  // another branch already used.
  const before = new Set(S().orders.map((o) => o.invoiceNo));
  S().setActiveBranch('BR002');
  const id = S().openOrder('Collision probe', 'dine-in');
  const fresh = S().order(id).invoiceNo;
  check(
    'the next invoice number is one nobody has used',
    !before.has(fresh),
    `issued ${fresh}`,
  );
  check('the demo load reported what it actually wrote', written === S().orders.length - 1,
    `reported ${written}`);
}

rmSync(dir, { recursive: true, force: true });
console.log(
  failures === 0
    ? '\nAll safeguard checks passed.'
    : `\n${failures} safeguard check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
