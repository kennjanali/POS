import type { Centavos } from './money';

/** Render centavos as pesos. The ONLY place centavos become a decimal. */
export function peso(value: Centavos | number, currency = '\u20b1'): string {
  const pesos = value / 100;
  return (
    currency +
    pesos.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Same, without the currency symbol — for table columns that carry a header. */
export function amount(value: Centavos | number): string {
  return (value / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function elapsed(ts: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

/** Local YYYY-MM-DD. Business date, not UTC — a 11pm sale belongs to today. */
export function businessDate(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
