/** The technology fee, as both your dashboard and the customer's account page show it. */

/** Must match TECH_FEE_RATE in the app's Dashboard (src/app/dashboard/page.tsx). */
export const FEE_RATE = 0.02;

/** `YYYY-MM` in Asia/Manila. */
export const manilaMonth = (ts = Date.now()) => new Date(ts + 8 * 3600_000).toISOString().slice(0, 7);

/**
 * `months`: reported net sales per month; `paid`: all payments recorded.
 * This month's fee is still running; past months are billed.
 */
export function feeSummary(months: { month: string; net: number }[], paid: number, current = manilaMonth()) {
  const feeOf = (m: { net: number }) => Math.round(m.net * FEE_RATE);
  const thisMonth = months.filter((m) => m.month === current).reduce((s, m) => s + feeOf(m), 0);
  const billed = months.filter((m) => m.month < current).reduce((s, m) => s + feeOf(m), 0);
  return { thisMonth, due: Math.max(0, billed - paid) };
}

export const peso = (c: number) =>
  `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
