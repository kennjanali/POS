#!/usr/bin/env node
/**
 * Convert a v6 export (Settings -> Export Database in the old HTML build)
 * into a v7 snapshot that Settings -> Restore will accept.
 *
 *   node scripts/migrate-v6.mjs kramgen-db-2026-08-24.json > v7-snapshot.json
 *
 * What this does NOT do: recompute historical senior/PWD totals. Those
 * receipts were issued at the wrong amount and the record should show what
 * was actually charged. The script reports how many are affected and what
 * the aggregate overcharge was, so you can decide how to handle it.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/migrate-v6.mjs <v6-export.json>');
  process.exit(1);
}

const v6 = JSON.parse(readFileSync(path, 'utf8'));
const toCents = (pesos) => Math.round(Number(pesos ?? 0) * 100);

const METHOD = {
  Cash: 'cash',
  GCash: 'gcash',
  Maya: 'maya',
  Card: 'card',
  Bank: 'bank',
  Other: 'other',
};

const TYPE = {
  'dine-in': 'dine-in',
  takeout: 'takeout',
  grab: 'grab',
  panda: 'panda',
};

const branches = (v6.branches ?? []).map((b) => ({
  id: b.id,
  name: b.name ?? 'Main Branch',
  address: b.address ?? '',
  branchCode: b.id,
  color: b.color ?? '#ff5c1a',
  active: true,
}));

const products = (v6.products ?? []).map((p) => ({
  id: p.id,
  name: p.name,
  unit: p.unit ?? 'pc',
  priceCents: toCents(p.price),
  costCents: toCents(p.cost),
  vatExempt: false,
  active: p.on !== false,
}));

const seqByBranch = {};
let affected = 0;
let overcharge = 0;

const orders = (v6.orders ?? []).map((o) => {
  const branchId = o.branchId ?? branches[0]?.id ?? 'BR001';
  seqByBranch[branchId] = (seqByBranch[branchId] ?? 0) + 1;

  const source = [
    ...(Array.isArray(o.served) ? o.served : []).map((i) => ({ ...i, served: true })),
    ...(Array.isArray(o.pending) ? o.pending : []).map((i) => ({ ...i, served: false })),
  ];

  const lines = source.map((item, index) => ({
    lineNo: index + 1,
    productId: item.prodId ?? item.id ?? `unknown-${index}`,
    name: item.name ?? 'Unknown item',
    unitCents: toCents(item.price),
    qty: Number(item.qty) || 1,
    served: Boolean(item.served),
    servedAt: item.served ? (o.paidAt ?? o.createdAt ?? null) : null,
    voided: false,
    voidReason: null,
  }));

  const closed = o.status === 'Completed';
  const grossCents = lines
    .filter((l) => l.served)
    .reduce((sum, l) => sum + l.unitCents * l.qty, 0);

  const discountKind =
    o.discType === 'senior' ? 'senior' : o.discType === 'pwd' ? 'pwd' :
    o.discType === 'custom' ? 'custom' : 'none';

  // Flag the statutory sales the old build mis-billed.
  if (closed && (discountKind === 'senior' || discountKind === 'pwd')) {
    affected += 1;
    const correct = Math.round((grossCents / 1.12) * 0.8);
    overcharge += toCents(o.total) - correct;
  }

  const tenders = closed && o.payMethod
    ? [{
        id: randomUUID(),
        method: METHOD[o.payMethod] ?? 'other',
        amountCents: toCents(o.total),
        tenderedCents: null,
        changeCents: null,
        refNo: null,
        takenAt: o.paidAt ?? o.createdAt ?? Date.now(),
      }]
    : [];

  return {
    id: randomUUID(),
    invoiceNo: `${branchId}-${String(seqByBranch[branchId]).padStart(7, '0')}`,
    branchId,
    label: o.name ?? 'Unknown',
    type: TYPE[o.type] ?? 'dine-in',
    // Open orders from a v6 export are stale by definition — close them out
    // rather than resurrecting tables that were cleared days ago.
    status: closed ? 'closed' : 'voided',
    openedAt: o.createdAt ?? Date.now(),
    closedAt: closed ? (o.paidAt ?? o.createdAt ?? null) : null,
    lines,
    tenders,
    discountKind,
    customPercent: 20,
    diners: 1,
    eligibleDiners: 1,
    discountIdNo: null,
    discountIdName: null,
    grossCents,
    vatableCents: 0,
    vatExemptCents: 0,
    vatCents: toCents(o.taxAmt),
    discountCents: toCents(o.discAmt),
    netCents: toCents(o.total),
    voidedReason: closed ? null : 'Open order at v6 migration',
    voidedAt: closed ? null : Date.now(),
    // v6 had no accounts, so nothing in this history has an actor.
    openedBy: null,
    servedBy: null,
    paidBy: null,
    voidedBy: null,
  };
});

const snapshot = {
  version: 7,
  exportedAt: new Date().toISOString(),
  branches: branches.length ? branches : undefined,
  // No users to carry over. Restoring this leaves the device's own accounts
  // alone; a fresh device prompts for a first superadmin.
  users: [],
  products,
  orders,
  stock: v6.stock ?? {},
  stockMoves: [],
  audit: [],
  settings: {
    businessName: v6.settings?.name ?? 'KRAMGEN',
    address: v6.settings?.address ?? '',
    currency: v6.settings?.currency ?? '\u20b1',
    receiptFooter: v6.settings?.footer ?? '',
    // Deliberately conservative: v6 forced VAT on for everyone. Confirm the
    // business is actually VAT-registered before switching this back on.
    vatRegistered: false,
    pricesIncludeVat: true,
    vatRate: (Number(v6.settings?.taxRate) || 12) / 100,
    vatLabel: v6.settings?.taxLabel ?? 'VAT',
  },
  invoiceSeq: seqByBranch,
};

process.stdout.write(JSON.stringify(snapshot, null, 2));

console.error(`\nConverted ${orders.length} orders, ${products.length} products.`);
if (affected > 0) {
  console.error(
    `\n${affected} senior/PWD sale(s) were billed with the v6 formula.\n` +
      `Aggregate overcharge: PHP ${(overcharge / 100).toFixed(2)}.\n` +
      `Historical totals are left as charged — correcting a receipt after the\n` +
      `fact is an accounting decision, not a migration one.\n`,
  );
}
