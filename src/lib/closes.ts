/**
 * Daily close: the end-of-day summary. It gives the owner their day's count,
 * and it is what the technology fee's daily totals are checked against.
 *
 * Not a BIR Z-reading — POS@034 is not a BIR machine. It borrows the useful
 * part: a close is never rewritten, and each one is chained to the previous
 * by hash, so a quietly edited or deleted day shows.
 */

import { businessDate } from './format';
import { cents, type Centavos } from './money';
import { TENDER_METHODS, type DailyClose, type Order, type TenderMethod } from './types';

/** The chain's first link. */
export const GENESIS = 'genesis';

type Unsigned = Omit<DailyClose, 'hash'>;

/**
 * Everything since the previous close. Windows follow the clock, not the
 * calendar: a sale settled after a close falls into the next one, whatever
 * its date.
 *
 * A window is [previous close, now): it includes its start and excludes its
 * end, so every timestamp belongs to exactly one close. With "after the last
 * close" alone, a sale settled in the very millisecond of a close fell
 * between two windows and was never counted.
 */
export function inWindow(ts: number | null, since: number, now: number): boolean {
  return ts !== null && ts >= since && ts < now;
}

export function buildClose(input: {
  id: string;
  orders: Order[];
  previous: DailyClose | null;
  now: number;
  actor: string | null;
}): Unsigned {
  const since = input.previous?.closedAt ?? 0;
  const here = (ts: number | null) => inWindow(ts, since, input.now);

  const settled = input.orders.filter((o) => o.status === 'closed' && here(o.closedAt));
  // A sale counted in an earlier close and voided since: the earlier close
  // stands, and this one carries the correction.
  const voidedEarlier = input.orders.filter(
    (o) => o.status === 'voided' && here(o.voidedAt) && o.closedAt !== null && o.closedAt < since,
  );

  const sum = (rows: Order[], pick: (o: Order) => number) =>
    cents(rows.reduce((total, o) => total + pick(o), 0));

  const tenders = Object.fromEntries(TENDER_METHODS.map((m) => [m, 0])) as Record<TenderMethod, number>;
  for (const order of settled) {
    for (const tender of order.tenders) tenders[tender.method] += tender.amountCents;
  }

  const voidedEarlierCents = sum(voidedEarlier, (o) => o.netCents);
  const netCents = cents(sum(settled, (o) => o.netCents) - voidedEarlierCents);

  return {
    id: input.id,
    no: (input.previous?.no ?? 0) + 1,
    date: businessDate(input.now),
    closedAt: input.now,
    closedBy: input.actor,
    orders: settled.length,
    grossCents: sum(settled, (o) => o.grossCents),
    discountCents: sum(settled, (o) => o.discountCents),
    voidedEarlierCents,
    netCents,
    tenders: tenders as Record<TenderMethod, Centavos>,
    runningNetCents: cents((input.previous?.runningNetCents ?? 0) + netCents),
    prevHash: input.previous?.hash ?? GENESIS,
  };
}

/** The fields a hash covers, in a fixed order, so the same close always hashes the same. */
function canonical(close: Unsigned): string {
  return JSON.stringify([
    close.id,
    close.no,
    close.date,
    close.closedAt,
    close.closedBy,
    close.orders,
    close.grossCents,
    close.discountCents,
    close.voidedEarlierCents,
    close.netCents,
    TENDER_METHODS.map((m) => close.tenders[m]),
    close.runningNetCents,
    close.prevHash,
  ]);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signClose(close: Unsigned): Promise<DailyClose> {
  return { ...close, hash: await sha256(canonical(close)) };
}

/**
 * Null if the chain is intact, else the number of the first close that does
 * not add up — edited, reordered, or with one missing before it.
 */
export async function brokenLink(closes: DailyClose[]): Promise<number | null> {
  let prevHash = GENESIS;
  let running = 0;
  for (const [index, close] of closes.entries()) {
    running += close.netCents;
    const intact =
      close.no === index + 1 &&
      close.prevHash === prevHash &&
      close.runningNetCents === running &&
      close.hash === (await sha256(canonical(close)));
    if (!intact) return close.no;
    prevHash = close.hash;
  }
  return null;
}
