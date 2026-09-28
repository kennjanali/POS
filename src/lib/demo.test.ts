import { beforeEach, describe, expect, it } from 'vitest';

import { brokenLink, buildClose, signClose } from '@/lib/closes';
import { buildDemoData, DEMO_BUSINESSES, DEMO_PROMO_CODE, type DemoDataset } from '@/lib/demo';
import { businessDate } from '@/lib/format';
import { discountRequest } from '@/lib/migrate';
import { applyPreset, type ShopType } from '@/lib/presets';
import { lineTotal } from '@/lib/qty';
import { DEFAULT_BRANCH, DEFAULT_SETTINGS } from '@/lib/seed';
import { computeBill } from '@/lib/tax';
import type { DailyClose, Order } from '@/lib/types';
import { usePos } from '@/store/usePos';
import { ownerShop, resetStore, signInAs } from '@/test/store';

/** Today at noon: the generator's "today" depends on the hour, so it is pinned. */
const NOON = new Date().setHours(12, 0, 0, 0);

function build(shopType: ShopType, now = NOON, vatRegistered = false): DemoDataset {
  return buildDemoData({
    shopType,
    settings: { ...DEFAULT_SETTINGS, vatRegistered },
    branch: DEFAULT_BRANCH,
    now,
  });
}

const settled = (d: DemoDataset) => d.orders.filter((o) => o.status !== 'open');

describe.each(DEMO_BUSINESSES)('the $label demo', ({ shopType }) => {
  const data = build(shopType);
  const features = applyPreset(shopType);
  const bid = DEFAULT_BRANCH.id;

  it('never takes a product below zero, replaying the moves in time order', () => {
    const balance = new Map<string, number>();
    // Additions before deductions at the same instant, as a shelf would see them.
    const byTime = [...data.stockMoves].sort((a, b) => a.at - b.at || b.delta - a.delta);
    for (const m of byTime) {
      const next = (balance.get(m.productId) ?? 0) + m.delta;
      expect(next, `${m.productId} at ${m.at}`).toBeGreaterThanOrEqual(0);
      balance.set(m.productId, next);
    }
  });

  it('adds its stock moves up to the stock map', () => {
    const sums: Record<string, number> = {};
    for (const m of data.stockMoves) sums[m.productId] = (sums[m.productId] ?? 0) + m.delta;
    for (const p of data.products.filter((x) => x.kind === 'stock')) {
      expect(data.stock[bid]?.[p.id] ?? 0, p.name).toBe(sums[p.id] ?? 0);
    }
    // A service is never on a shelf.
    for (const p of data.products.filter((x) => x.kind === 'service')) {
      expect(data.stockMoves.some((m) => m.productId === p.id), p.name).toBe(false);
    }
  });

  it('holds no more on open tickets than is on the shelf', () => {
    const held = new Map<string, number>();
    for (const o of data.orders.filter((x) => x.status === 'open')) {
      for (const l of o.lines) {
        if (l.kind === 'stock' && !l.served) held.set(l.productId, (held.get(l.productId) ?? 0) + l.qty);
      }
    }
    for (const [id, q] of held) expect(data.stock[bid]?.[id] ?? 0).toBeGreaterThanOrEqual(q);
  });

  it('pays every closed sale in full, at totals the tax engine agrees with', () => {
    for (const o of settled(data)) {
      const paid = o.tenders.reduce((s, t) => s + t.amountCents, 0);
      expect(paid, o.id).toBe(o.netCents);
      const gross = o.lines.reduce((s, l) => s + lineTotal(l.unitCents, l.qty), 0);
      const bill = computeBill(gross as never, DEFAULT_SETTINGS, discountRequest(o.discount));
      expect([o.grossCents, o.discountCents, o.netCents, o.vatCents]).toEqual([
        bill.gross,
        bill.discount,
        bill.amountDue,
        bill.vat,
      ]);
    }
  });

  it('numbers its sales gaplessly in the order they were paid; open tickets have no number', () => {
    const numbered = settled(data).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    expect(numbered.map((o) => Number(o.invoiceNo!.split('-')[1]))).toEqual(
      numbered.map((_, i) => i + 1),
    );
    expect(data.invoiceSeq[bid]).toBe(numbered.length);
    expect(data.orders.filter((o) => o.status === 'open').every((o) => o.invoiceNo === null)).toBe(true);
  });

  it('closes into a chain that verifies', async () => {
    const closes: DailyClose[] = [];
    const days = [...new Set(settled(data).map((o) => businessDate(o.closedAt!)))].sort();
    for (const day of days.slice(0, -1)) {
      const end = new Date(`${day}T23:59:00`).getTime();
      const previous = closes.at(-1) ?? null;
      closes.push(await signClose(buildClose({ id: day, orders: data.orders, previous, now: end, actor: null })));
    }
    expect(closes.length).toBeGreaterThan(5);
    expect(await brokenLink(closes)).toBeNull();
  });

  it('uses DEMO10 on some sales, and records when it was first used', () => {
    const used = settled(data).filter((o) => o.discount.kind === 'promo');
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((o) => o.discount.kind === 'promo' && o.discount.code === DEMO_PROMO_CODE)).toBe(true);
    const [promo] = data.promos;
    expect(promo?.code).toBe(DEMO_PROMO_CODE);
    expect(promo?.firstUsedAt).toBe(Math.min(...used.map((o) => o.closedAt!)));
  });

  it('has three open quotes, open tickets only where the shop keeps tickets, and two items running low', () => {
    expect(data.quotes.filter((q) => q.status === 'open')).toHaveLength(3);
    expect(data.quoteSeq).toBe(4);
    const open = data.orders.filter((o) => o.status === 'open').length;
    if (features.openOrders) {
      expect(open).toBeGreaterThanOrEqual(2);
      expect(open).toBeLessThanOrEqual(3);
    } else {
      expect(open).toBe(0);
    }
    const low = data.products.filter(
      (p) => p.kind === 'stock' && (data.stock[bid]?.[p.id] ?? 0) <= DEFAULT_SETTINGS.lowStockAt,
    );
    expect(low.length).toBeGreaterThanOrEqual(2);
  });

  it('sells on today, and dates nothing after now at any hour', () => {
    for (const [h, m] of [[0, 5], [8, 10], [12, 0], [23, 55]] as const) {
      const now = new Date().setHours(h, m, 0, 0);
      const d = build(shopType, now);
      const stamps = (o: Order) => [o.openedAt, o.closedAt, o.voidedAt, ...o.lines.map((l) => l.servedAt), ...o.tenders.map((t) => t.takenAt)];
      const all = [
        ...d.orders.flatMap(stamps),
        ...d.stockMoves.map((x) => x.at),
        ...d.quotes.map((q) => q.createdAt),
      ].filter((t): t is number => t !== null);
      expect(Math.max(...all), `${h}:${m}`).toBeLessThanOrEqual(now);
      // Five minutes after midnight nothing has happened yet; any later, today has sales.
      if (h === 0) continue;
      const today = businessDate(now);
      expect(settled(d).some((o) => businessDate(o.closedAt!) === today), `${h}:${m}`).toBe(true);
    }
  });

  it('gives the same money every time it is built', () => {
    const again = build(shopType);
    const net = (d: DemoDataset) => settled(d).map((o) => o.netCents);
    expect(net(again)).toEqual(net(data));
  });

  it('works out VAT on a VAT-registered shop', () => {
    const vat = build(shopType, NOON, true);
    expect(settled(vat).some((o) => o.vatCents > 0)).toBe(true);
  });
});

describe('loadDemoBusiness', () => {
  beforeEach(async () => {
    resetStore();
    await ownerShop();
  });

  const S = () => usePos.getState();

  it('replaces the shop with the demo business and its switches', () => {
    const written = S().loadDemoBusiness('auto', { days: 3, salesPerDay: 5 });
    expect(written).toBeGreaterThan(0);
    expect(S().settings.shopType).toBe('auto');
    expect(S().settings.features).toEqual(applyPreset('auto'));
    expect(S().products.some((p) => p.name === 'Wheel Alignment')).toBe(true);
    expect(S().promos.map((p) => p.code)).toEqual([DEMO_PROMO_CODE]);
    expect(S().quotes).toHaveLength(3);
    expect(S().branches).toHaveLength(1);
    expect(S().closes).toEqual([]);
  });

  it('refuses a live install, and staff', () => {
    signInAs('staff');
    expect(S().loadDemoBusiness('retail')).toBe(0);
    usePos.setState((s) => ({ settings: { ...s.settings, trainingMode: false } }));
    signInAs('superadmin');
    expect(S().loadDemoBusiness('retail')).toBe(0);
    expect(S().settings.shopType).toBe('restaurant');
  });
});
