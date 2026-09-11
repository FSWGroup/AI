import { describe, it, expect } from 'vitest';
import { addMonths, rollingTwelveMonthRange, windowExpiryDate, formatDate, parseCellDate, excelSerialToDate, daysBetween } from './dates';
import { parseMoney, formatMoney, formatMoneyCompact } from './money';
import { companyKey, normalizeHeader, normalizeSalesRepName, resolveSalesRep, resolveVendor, resolveVendors, extractIdentifierBase, pickDisplayName } from './normalization';
import { toTsv } from './clipboard';
import { toCsv } from './csv';

describe('dates', () => {
  it('rolling window ends on and includes the as-of date and starts 12 calendar months earlier', () => {
    const r = rollingTwelveMonthRange(new Date(2026, 8, 10));
    expect(formatDate(r.start)).toBe('09/10/2025');
    expect(formatDate(r.end)).toBe('09/10/2026');
  });
  it('handles month-end clamping', () => {
    expect(formatDate(addMonths(new Date(2026, 2, 31), -1))).toBe('02/28/2026');
    expect(formatDate(addMonths(new Date(2024, 1, 29), 12))).toBe('02/28/2025');
  });
  it('window expiry = order date + 12 months + 1 day', () => {
    expect(formatDate(windowExpiryDate(new Date(2025, 8, 20)))).toBe('09/21/2026');
  });
  it('parses Excel serials, strings and Dates', () => {
    expect(formatDate(excelSerialToDate(45658))).toBe('01/01/2025');
    expect(formatDate(parseCellDate('3/26/2025'))).toBe('03/26/2025');
    expect(formatDate(parseCellDate('2025-03-26'))).toBe('03/26/2025');
    expect(parseCellDate('N/A')).toBeNull();
    expect(parseCellDate('—')).toBeNull();
    expect(parseCellDate('')).toBeNull();
    expect(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 31))).toBe(30);
  });
});

describe('money', () => {
  it('parses spreadsheet money formats', () => {
    expect(parseMoney(1234.5)).toBe(1234.5);
    expect(parseMoney('$12,345.67')).toBe(12345.67);
    expect(parseMoney('(1,000.00)')).toBe(-1000);
    expect(parseMoney('-')).toBeNull();
    expect(parseMoney('N/A')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(' $ -   ')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
  it('formats currency', () => {
    expect(formatMoney(12345.678)).toBe('$12,345.68');
    expect(formatMoneyCompact(4600)).toBe('$4,600');
    expect(formatMoneyCompact(4599.5)).toBe('$4,599.50');
  });
});

describe('normalization', () => {
  it('normalizes headers regardless of case, spacing and punctuation', () => {
    expect(normalizeHeader('ORDER DATE')).toBe(normalizeHeader('Order Date'));
    expect(normalizeHeader('  Order\nDate ')).toBe('order date');
    expect(normalizeHeader('QB Sales Receipt # / Sales Order #')).toBe('qb sales receipt sales order');
  });
  it('company keys: trim, collapse, case-insensitive; no fuzzy merging', () => {
    expect(companyKey(' ABC   Manufacturing ')).toBe(companyKey('ABC MANUFACTURING'));
    expect(companyKey('ABC Manufacturing')).not.toBe(companyKey('ABC Manufacturing Services'));
  });
  it('sales rep aliases: "Joe" -> "Joe Mitchell" (case-insensitive)', () => {
    expect(normalizeSalesRepName('Joe')).toBe('Joe Mitchell');
    expect(normalizeSalesRepName('JOE')).toBe('Joe Mitchell');
    expect(normalizeSalesRepName('jason b')).toBe('Jason Bauman');
    expect(normalizeSalesRepName('Online')).toBeNull();
    expect(normalizeSalesRepName('Dylan Lavern')).toBe('Dylan Lavern');
    expect(resolveSalesRep('Online', 'Amr').rep).toBe('Amr Shweiky');
    expect(resolveSalesRep('', '').rep).toBe('Online / Unassigned');
  });
  it('vendor normalization consolidates obvious variants and rejects placeholders', () => {
    expect(resolveVendor('Bonomi')!.key).toBe(resolveVendor('BONOMI NORTH AMERICA, INC.')!.key);
    expect(resolveVendor('STC Valve Company')!.key).toBe(resolveVendor(' stc ')!.key);
    expect(resolveVendor('Richards')!.key).toBe(resolveVendor('RICHARDS  ')!.key);
    expect(resolveVendor('Acme Valves Inc')!.key).toBe(resolveVendor('Acme Valves, Inc.')!.key);
    expect(resolveVendor('CANCELED')).toBeNull();
    expect(resolveVendor('Deleted??')).toBeNull();
    expect(resolveVendor('-')).toBeNull();
    expect(resolveVendor('Credit Memo')).toBeNull();
    expect(resolveVendor('GC Valves > VM')!.display).toBe('GC Valves');
    expect(resolveVendor('F. S. Welsford Company > Watson McDaniel')!.display).toBe('Watson McDaniel');
    expect(resolveVendors('Main Line, Bonomi').map((v) => v.display)).toEqual(['Main Line Supply', 'Bonomi']);
    expect(resolveVendors('Titan Flow Control, Inc').map((v) => v.display)).toEqual(['Titan']);
    expect(resolveVendors('STC\nVM').map((v) => v.display)).toEqual(['STC']);
  });
  it('extracts identifier bases', () => {
    expect(extractIdentifierBase('3996-A')).toBe('3996');
    expect(extractIdentifierBase('4494-B.1')).toBe('4494');
    expect(extractIdentifierBase('5860 REFUND')).toBe('5860');
    expect(extractIdentifierBase('I-8308')).toBe('I-8308');
    expect(extractIdentifierBase(' I-8655 ')).toBe('I-8655');
    expect(extractIdentifierBase('see 4123')).toBe('4123');
    expect(extractIdentifierBase('QN1234')).toBe('QN1234');
    expect(extractIdentifierBase('Negotiate with vendor')).toBeNull();
    expect(extractIdentifierBase('')).toBeNull();
  });
  it('picks the cleanest display name', () => {
    expect(pickDisplayName(new Map([['ACME CO', 5], ['Acme Co', 1]]))).toBe('Acme Co');
  });
});

describe('clipboard / csv formatting', () => {
  it('produces tab-separated text with headers and strips tabs/newlines from cells', () => {
    expect(toTsv(['A', 'B'], [['x\ty', 'line1\nline2'], [1, null]])).toBe('A\tB\r\nx y\tline1 line2\r\n1\t');
  });
  it('quotes CSV cells containing commas or quotes', () => {
    expect(toCsv(['A'], [['Acme, Inc.'], ['He said "hi"']])).toBe('A\r\n"Acme, Inc."\r\n"He said ""hi"""');
  });
});
