/**
 * Date helpers. All business dates are treated as calendar dates in local time
 * (Excel dates carry no timezone). Time-of-day is stripped everywhere.
 */

const MS_PER_DAY = 86400000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const target = new Date(y, m, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
}

export function addDays(d: Date, days: number): Date {
  const r = startOfDay(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

export interface DateRange {
  /** Inclusive start. */
  start: Date;
  /** Inclusive end. */
  end: Date;
}

/**
 * THE centralized rolling 12-month window.
 * A rolling 12-calendar-month period ending on and including the analysis date.
 * Example: as of 09/10/2026 the window is 09/10/2025 through 09/10/2026.
 */
export function rollingTwelveMonthRange(asOf: Date): DateRange {
  const end = startOfDay(asOf);
  return { start: addMonths(end, -12), end };
}

export function isWithinRange(d: Date, range: DateRange): boolean {
  const t = startOfDay(d).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** The first day on which an order dated `orderDate` no longer falls inside the rolling window. */
export function windowExpiryDate(orderDate: Date): Date {
  return addDays(addMonths(startOfDay(orderDate), 12), 1);
}

export function formatDate(d: Date | null | undefined): string {
  if (!isValidDate(d)) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function formatLongDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** yyyy-mm-dd for <input type="date"> */
export function toInputDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function fromInputDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isValidDate(d) ? d : null;
}

/** Excel serial date (1900 system) to local Date. */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  // 25569 = days between 1899-12-30 and 1970-01-01
  const utcDays = Math.floor(serial) - 25569;
  const utc = new Date(utcDays * MS_PER_DAY);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/**
 * Parses a spreadsheet cell into a Date. Accepts Date objects, Excel serials,
 * and common string formats (M/D/YYYY, YYYY-MM-DD, "Jan 5, 2026").
 */
export function parseCellDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isValidDate(value) ? startOfDay(value) : null;
  if (typeof value === 'number') return excelSerialToDate(value);
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s || s === '-' || s === '—' || /^n\/?a$/i.test(s)) return null;
    const mdy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(s);
    if (mdy) {
      let y = Number(mdy[3]);
      if (y < 100) y += 2000;
      const d = new Date(y, Number(mdy[1]) - 1, Number(mdy[2]));
      return isValidDate(d) && d.getMonth() === Number(mdy[1]) - 1 ? d : null;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) {
      const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return isValidDate(d) ? d : null;
    }
    if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));
    const parsed = new Date(s);
    return isValidDate(parsed) ? startOfDay(parsed) : null;
  }
  return null;
}

export function maxDate(dates: Array<Date | null>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (isValidDate(d) && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

export function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
