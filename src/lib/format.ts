/** Shared formatting helpers (safe for client + server). */

export function fullName(w: { preferredName?: string | null; legalFirstName: string; lastName: string }) {
  return `${w.preferredName || w.legalFirstName} ${w.lastName}`;
}

export function initials(w: { preferredName?: string | null; legalFirstName: string; lastName: string }) {
  return `${(w.preferredName || w.legalFirstName)[0] ?? ''}${w.lastName[0] ?? ''}`.toUpperCase();
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtMoney(amount: number | string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
}

export function fmtHours(h: number | string | null | undefined): string {
  const n = typeof h === 'string' ? Number(h) : h;
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${Number(n.toFixed(2))} h`;
}

/** Humanize an ENUM_VALUE → "Enum value" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? singular + 's')}`;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function startOfUTCDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** ISO date (yyyy-mm-dd) for date inputs. */
export function isoDate(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

export function tenureLabel(hireDate: Date | null | undefined): string {
  if (!hireDate) return '—';
  const days = daysBetween(new Date(hireDate), new Date());
  if (days < 0) return 'Starts soon';
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days % 365.25) / 30.44);
  if (years === 0 && months === 0) return `${days} days`;
  if (years === 0) return `${months} mo`;
  return `${years} yr ${months} mo`;
}

/** CSV encoding with formula-injection protection for spreadsheet apps. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined): string => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\r\n');
}
