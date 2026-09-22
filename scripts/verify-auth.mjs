// Standalone verification of the access model and the PIN hashing.
//
// These are the two pieces where a quiet mistake is expensive: a permission
// that silently widens, or a PIN check that says yes when it should say no.
// Both are pure modules with no React and no store, so they can be checked
// directly the way the tax engine is.
// Run: node scripts/verify-auth.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = mkdtempSync(join(tmpdir(), 'auth-'));

function emit(name) {
  const src = readFileSync(`src/lib/${name}.ts`, 'utf8');
  const js = ts
    .transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/from '\.\/([a-z]+)'/g, "from './$1.js'");
  writeFileSync(join(dir, `${name}.js`), js);
}

for (const name of ['crypto', 'permissions']) emit(name);

const load = (name) => import(pathToFileURL(join(dir, `${name}.js`)).href);
const { PIN_LENGTH, hashPin, isValidPin, verifyPin } = await load('crypto');
const {
  ROUTES,
  can,
  canVisit,
  isLastActiveSuperadmin,
  landingFor,
  normalizePath,
  routesFor,
} = await load('permissions');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

const SUPERADMIN = { role: 'superadmin' };
const WAITER = { role: 'waiter' };
const PURCHASER = { role: 'purchaser' };

const ALL_PERMISSIONS = [
  'pos.use',
  'order.open',
  'order.item',
  'order.serve',
  'order.pay',
  'order.void',
  'line.void',
  'orders.view',
  'inventory.view',
  'stock.adjust',
  'product.edit',
  'dashboard.view',
  'settings.manage',
  'users.manage',
];

// ── The matrix ─────────────────────────────────────────────────────────
console.log('\n— permission matrix —');

// Stated plainly so a future edit to the matrix has to disagree with this
// list out loud rather than quietly.
const EXPECTED = {
  waiter: [
    'pos.use',
    'order.open',
    'order.item',
    'order.serve',
    'order.pay',
    // Read-only: checking their own service, not undoing it.
    'orders.view',
  ],
  purchaser: ['inventory.view', 'stock.adjust', 'product.edit'],
  superadmin: ALL_PERMISSIONS,
};

for (const [role, granted] of Object.entries(EXPECTED)) {
  const actor = { role };
  const actualGranted = ALL_PERMISSIONS.filter((p) => can(actor, p));
  const extra = actualGranted.filter((p) => !granted.includes(p));
  const missing = granted.filter((p) => !actualGranted.includes(p));
  check(
    `${role}: exactly ${granted.length} permission(s)`,
    extra.length === 0 && missing.length === 0,
    extra.length || missing.length
      ? `extra: [${extra}]  missing: [${missing}]`
      : actualGranted.join(', '),
  );
}

// The four the owner called out by name.
check('waiter cannot void an order', !can(WAITER, 'order.void'));
check('waiter cannot void a line', !can(WAITER, 'line.void'));
check('waiter cannot edit products', !can(WAITER, 'product.edit'));
check('waiter cannot open settings', !can(WAITER, 'settings.manage'));
check('waiter cannot see dashboard numbers', !can(WAITER, 'dashboard.view'));
// Reading the history must never imply being able to rewrite it.
check(
  'waiter reads order history but cannot void from it',
  can(WAITER, 'orders.view') && !can(WAITER, 'order.void'),
);
check('purchaser cannot use the POS floor', !can(PURCHASER, 'pos.use'));
check('purchaser cannot take payment', !can(PURCHASER, 'order.pay'));
check('only superadmin manages users', can(SUPERADMIN, 'users.manage') && !can(WAITER, 'users.manage') && !can(PURCHASER, 'users.manage'));

check(
  'every permission is held by superadmin',
  ALL_PERMISSIONS.every((p) => can(SUPERADMIN, p)),
  'an unreachable permission is a typo, not a policy',
);

// Nobody signed in is nobody at all.
check(
  'a null actor holds nothing',
  ALL_PERMISSIONS.every((p) => !can(null, p)) && !can(undefined, 'pos.use'),
);

// ── Routes ─────────────────────────────────────────────────────────────
console.log('\n— route guard —');

const VISIBLE = {
  superadmin: ['/', '/orders', '/inventory', '/dashboard', '/settings'],
  waiter: ['/', '/orders'],
  purchaser: ['/inventory'],
};

for (const [role, expected] of Object.entries(VISIBLE)) {
  const actor = { role };
  const actual = routesFor(actor).map((r) => r.href);
  check(
    `${role} nav: ${expected.join(' ')}`,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${actual.join(' ') || '(none)'}`,
  );

  // Every route the role cannot see must also be refused when typed in.
  for (const route of ROUTES) {
    const allowed = expected.includes(route.href);
    check(
      `${role} ${allowed ? 'may' : 'may NOT'} visit ${route.href}`,
      canVisit(actor, route.href) === allowed,
    );
    // trailingSlash: true means the router hands over '/orders/', not '/orders'.
    check(
      `${role} ${route.href} guarded with a trailing slash too`,
      canVisit(actor, `${route.href.replace(/\/$/, '')}/`) === allowed,
    );
  }
}

check('landing: waiter starts on the POS', landingFor(WAITER) === '/', landingFor(WAITER));
check(
  'landing: purchaser starts on Inventory',
  landingFor(PURCHASER) === '/inventory',
  landingFor(PURCHASER),
);
check('landing: superadmin starts on the POS', landingFor(SUPERADMIN) === '/');

check('a signed-out visitor may visit nothing', ROUTES.every((r) => !canVisit(null, r.href)));
check(
  'an unknown path is not a permission question',
  canVisit(WAITER, '/nope') && canVisit(null, '/nope'),
  'let the router 404 it',
);

check(
  'paths normalise',
  normalizePath('/') === '/' &&
    normalizePath('/orders/') === '/orders' &&
    normalizePath('/orders') === '/orders' &&
    normalizePath('//') === '/',
);

// ── The last superadmin ────────────────────────────────────────────────
console.log('\n— last active superadmin —');

const admin = { id: 'a', role: 'superadmin', active: true };
const admin2 = { id: 'b', role: 'superadmin', active: true };
const waiter = { id: 'w', role: 'waiter', active: true };
const retired = { id: 'r', role: 'superadmin', active: false };

check('sole superadmin is protected', isLastActiveSuperadmin([admin, waiter], 'a'));
check('two superadmins, neither is the last', !isLastActiveSuperadmin([admin, admin2], 'a'));
check(
  'a deactivated superadmin does not count as cover',
  isLastActiveSuperadmin([admin, retired, waiter], 'a'),
);
check('a waiter is never the last superadmin', !isLastActiveSuperadmin([admin, waiter], 'w'));
check('an unknown id is not the last superadmin', !isLastActiveSuperadmin([admin], 'zz'));

// ── PIN hashing ────────────────────────────────────────────────────────
console.log('\n— PIN hashing —');

check(`PIN length is ${PIN_LENGTH}`, PIN_LENGTH === 6);
check(
  'format: six digits only',
  isValidPin('000000') &&
    isValidPin('114477') &&
    !isValidPin('11447') &&
    !isValidPin('1144778') &&
    !isValidPin('11447a') &&
    !isValidPin('') &&
    !isValidPin('  1144') &&
    !isValidPin('11.447'),
);

const cred = await hashPin('114477');
check('the right PIN verifies', await verifyPin('114477', cred));
check('a wrong PIN does not', !(await verifyPin('114478', cred)));
check('a short PIN does not', !(await verifyPin('11447', cred)));

check(
  'the credential holds no plaintext',
  !JSON.stringify(cred).includes('114477'),
  JSON.stringify({ ...cred, hash: `${cred.hash.slice(0, 8)}…` }),
);
check(
  'iterations are recorded with the credential',
  Number.isInteger(cred.iterations) && cred.iterations >= 100_000,
  `${cred.iterations} iterations`,
);

// Two people picking the same PIN must not produce the same stored row —
// that is the whole point of a per-user salt.
const same = await hashPin('114477');
check('same PIN, different salt', same.salt !== cred.salt);
check('same PIN, different hash', same.hash !== cred.hash);
check('either salt still verifies its own hash', await verifyPin('114477', same));

// A duplicate PIN is caught by verifying a candidate against every stored
// credential — the check the user manager relies on.
const others = [await hashPin('222222'), await hashPin('333333'), cred];
const collides = [];
for (const c of others) if (await verifyPin('114477', c)) collides.push(c);
check('a duplicate PIN is detectable across stored credentials', collides.length === 1);

// ── Result ─────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} auth check(s) failed.`);
  process.exit(1);
}
console.log('\nAll auth checks passed.');
