// Standalone verification of the tax engine against worked examples from
// RA 9994 / RA 10754 / RR 7-2010. Run: node scripts/verify-tax.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

function load(file) {
  const src = readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return js;
}
const dir = mkdtempSync(join(tmpdir(), 'tax-'));
writeFileSync(join(dir, 'money.js'), load('src/lib/money.ts'));
writeFileSync(join(dir, 'tax.js'), load('src/lib/tax.ts').replace("./money", "./money.js"));
const { computeBill } = await import(pathToFileURL(join(dir, 'tax.js')).href);
const { cents } = await import(pathToFileURL(join(dir, 'money.js')).href);

const VAT = { vatRegistered: true, pricesIncludeVat: true, vatRate: 0.12, vatLabel: 'VAT' };
const NONVAT = { vatRegistered: false, pricesIncludeVat: true, vatRate: 0.12, vatLabel: 'VAT' };
const p = (c) => (c / 100).toFixed(2);

let failures = 0;
function check(name, actual, expected) {
  const ok = Math.abs(actual - expected) <= 1; // 1 centavo rounding tolerance
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      got ${p(actual)}  expected ${p(expected)}`);
}

console.log('\n— Senior/PWD, VAT-registered, VAT-inclusive prices —');
// Taxify worked example: PHP 500 meal -> 446.43 base, 89.29 discount, 357.14 due
let r = computeBill(cents(50000), VAT, { kind: 'senior' });
check('PHP 500 senior: amount due', r.amountDue, 35714);
check('PHP 500 senior: discount',   r.discount,  8929);
check('PHP 500 senior: exempt base', r.vatExemptSale, 44643);
check('PHP 500 senior: VAT collected is zero', r.vat, 0);

// seniordiscount.ph: PHP 800 bill -> 571.43
r = computeBill(cents(80000), VAT, { kind: 'pwd' });
check('PHP 800 PWD: amount due', r.amountDue, 57143);

console.log('\n— The v6 bug, reproduced for contrast —');
const sub = 50000;
const v6disc = Math.round(sub * 0.20);
const v6vat  = Math.round((sub - v6disc) * 0.12);
const v6total = sub - v6disc + v6vat;
console.log(`      v6 build charged ${p(v6total)} vs correct ${p(35714)}  -> overcharge ${p(v6total - 35714)}`);

console.log('\n— Non-VAT business (percentage tax filer) —');
// Whole selling price is the exempt base; straight 20% off.
r = computeBill(cents(50000), NONVAT, { kind: 'senior' });
check('PHP 500 senior, non-VAT: amount due', r.amountDue, 40000);
r = computeBill(cents(50000), NONVAT, { kind: 'none' });
check('PHP 500 regular, non-VAT: no VAT added', r.amountDue, 50000);
check('PHP 500 regular, non-VAT: VAT is zero', r.vat, 0);

console.log('\n— Regular customer, VAT-registered, inclusive prices —');
r = computeBill(cents(50000), VAT, { kind: 'none' });
check('PHP 500 regular: amount due unchanged', r.amountDue, 50000);
check('PHP 500 regular: VAT component', r.vat, 5357);
check('PHP 500 regular: VATable sale', r.vatableSale, 44643);

console.log('\n— Shared bill (RR 7-2010): 1 of 4 diners eligible —');
// PHP 2000 total, one senior. Their share 500 -> 357.14. Others pay 1500.
r = computeBill(cents(200000), VAT, { kind: 'senior', diners: 4, eligibleDiners: 1 });
check('PHP 2000, 1 of 4 senior: amount due', r.amountDue, 185714);
check('PHP 2000, 1 of 4 senior: discount', r.discount, 8929);

console.log('\n— Custom discount stays VATable —');
r = computeBill(cents(50000), VAT, { kind: 'custom', customPercent: 10 });
check('PHP 500 less 10%: amount due', r.amountDue, 45000);
check('PHP 500 less 10%: VAT still collected', r.vat, 4821);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
