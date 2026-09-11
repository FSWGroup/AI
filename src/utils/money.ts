/** Money helpers. Full numeric precision is retained internally; formatting happens at display time. */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return usd.format(round2(value));
}

/** Compact currency for sentences: "$4,600" or "$4,599.50". */
export function formatMoneyCompact(value: number): string {
  const v = round2(value);
  if (Math.abs(v - Math.round(v)) < 0.005) {
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  return usd.format(v);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Parses spreadsheet money cells: numbers, "$12,345.67", "(1,000.00)", "-", "N/A", "", "1.2e3".
 * Returns null when the cell is blank or not numeric.
 */
export function parseMoney(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return null;
  if (value instanceof Date) return null;
  let s = String(value).trim();
  if (!s || s === '-' || s === '—' || /^n\/?a$/i.test(s) || s === '$' || s === '$ -' || s === '$-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '').replace(/^USD/i, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function sum(values: number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}
