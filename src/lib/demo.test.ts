import { beforeEach, describe, expect, it } from 'vitest';

import { brokenLink } from '@/lib/closes';
import { buildDemoData, closeDemoDays, DEMO_BUSINESSES, DEMO_PROMO_CODE, type DemoDataset } from '@/lib/demo';
import { businessDate } from '@/lib/format';
import { discountRequest } from '@/lib/migrate';
import { applyPreset, type ShopType } from '@/lib/presets';
import { lineTotal } from '@/lib/qty';
import { DEFAULT_BRANCH, DEFAULT_SETTINGS } from '@/lib/seed';
import { computeBill } from '@/lib/tax';
import type { Order } from '@/lib/types';
import { usePos } from '@/store/usePos';
import { ownerShop, resetStore, signInAs } from '@/test/store';

/** Today at noon: the generator's "today" depends on the hour, so it is pinned. */
const NOON = new Date().setHours(12, 0, 0, 0);

function build(shopType: ShopType, now = NOON, vatRegistered = false, lowStockAt = DEFAULT_SETTINGS.lowStockAt): DemoDataset {
  return buildDemoData({
    shopType,
    settings: { ...DEFAULT_SETTINGS, vatRegistered, lowStockAt },
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

  it('ships a verified summary for every past day, and leaves today open', async () => {
    const closes = await closeDemoDays(data.orders, NOON);
    const pastDays = new Set(settled(data).map((o) => businessDate(o.closedAt!)));
    pastDays.delete(businessDate(NOON));
    expect(closes.map((c) => businessDate(c.closedAt))).toEqual([...pastDays].sort());
    expect(await brokenLink(closes)).toBeNull();
    // Every sale paid before today is inside a summary.
    const summed = closes.reduce((n, c) => n + c.orders, 0);
    const before = settled(data).filter(
      (o) => o.status === 'closed' && businessDate(o.closedAt!) !== businessDate(NOON),
    ).length;
    expect(summed).toBe(before);
  });

  it('uses DEMO10 on some sales, and records when it was first used', () => {
    const used = settled(data).filter((o) => o.discount.kind === 'promo');
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((o) => o.discount.kind === 'promo' && o.discount.code === DEMO_PROMO_CODE)).toBe(true);
    const [promo] = data.promos;
    expect(promo?.code).toBe(DEMO_PROMO_CODE);
    expect(promo?.firstUsedAt).toBe(Math.min(...used.map((o) => o.closedAt!)));
  });

  it('has three open quotes where the shop makes quotes, open tickets where it keeps them, and two items running low', () => {
    expect(data.quotes.filter((q) => q.status === 'open')).toHaveLength(features.quotes ? 3 : 0);
    expect(data.quoteSeq).toBe(features.quotes ? 4 : 1);
    // Numbered in the order they were made, each valid from its own date.
    expect([...data.quotes].sort((a, b) => a.createdAt - b.createdAt).map((q) => q.quoteNo)).toEqual(
      data.quotes.map((q) => q.quoteNo),
    );
    for (const q of data.quotes) expect(q.validUntil > businessDate(q.createdAt)).toBe(true);
    const open = data.orders.filter((o) => o.status === 'open').length;
    if (features.openOrders) {
      expect(open).toBeGreaterThanOrEqual(2);
      expect(open).toBeLessThanOrEqual(3);
    } else {
      expect(open).toBe(0);
    }
    // Low the way the app's Running low list judges it: available after holds.
    const lowIn = (d: DemoDataset, level: number) =>
      d.products.filter((p) => {
        if (p.kind !== 'stock') return false;
        const held = d.orders
          .filter((o) => o.status === 'open')
          .flatMap((o) => o.lines)
          .filter((l) => l.productId === p.id && !l.served)
          .reduce((n, l) => n + l.qty, 0);
        return (d.stock[bid]?.[p.id] ?? 0) - held <= level;
      }).length;
    expect(lowIn(data, DEFAULT_SETTINGS.lowStockAt)).toBeGreaterThanOrEqual(2);
    // A reorder level in part-units still gets its two low items.
    expect(lowIn(build(shopType, NOON, false, 2500 as never), 2500)).toBeGreaterThanOrEqual(2);
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

  it('replaces the shop with the demo business and its switches', async () => {
    const written = await S().loadDemoBusiness('auto', { days: 3, salesPerDay: 5 });
    expect(written).toBeGreaterThan(0);
    expect(S().settings.shopType).toBe('auto');
    expect(S().settings.features).toEqual(applyPreset('auto'));
    expect(S().products.some((p) => p.name === 'Wheel Alignment')).toBe(true);
    expect(S().promos.map((p) => p.code)).toEqual([DEMO_PROMO_CODE]);
    expect(S().quotes).toHaveLength(3);
    // The past days are already summarised; only today is waiting.
    expect(S().closes.length).toBeGreaterThan(0);
    expect(businessDate(S().oldestUnclosed()!)).toBe(businessDate(Date.now()));
  });

  it('carries sale and quote numbers on from what was already issued', async () => {
    const bid = S().activeBranchId;
    usePos.setState((s) => ({ invoiceSeq: { ...s.invoiceSeq, [bid]: 41 }, quoteSeq: 7 }));
    await S().loadDemoBusiness('retail', { days: 2, salesPerDay: 3 });
    const first = S()
      .orders.filter((o) => o.invoiceNo !== null)
      .sort((a, b) => a.closedAt! - b.closedAt!)[0]!;
    expect(first.invoiceNo!.endsWith('0000042')).toBe(true);
    expect(S().quotes.map((q) => q.quoteNo)).toEqual(['Q-0007', 'Q-0008', 'Q-0009']);
  });

  it("takes DEMO10 away when the shop goes live, and keeps the owner's own codes", async () => {
    await S().loadDemoBusiness('retail', { days: 2, salesPerDay: 3 });
    expect(S().createPromo({ code: 'GRAND10', percent: 10 }).ok).toBe(true);
    usePos.setState({ licensed: { licenseId: 'LIC-TEST' } as never });
    S().updateSettings({ trainingMode: false });
    expect(S().promos.map((p) => p.code)).toEqual(['GRAND10']);
  });

  it('refuses a live install, and staff', async () => {
    signInAs('staff');
    expect(await S().loadDemoBusiness('retail')).toBe(0);
    usePos.setState((s) => ({ settings: { ...s.settings, trainingMode: false } }));
    signInAs('superadmin');
    expect(await S().loadDemoBusiness('retail')).toBe(0);
    expect(S().settings.shopType).toBe('restaurant');
  });
});
