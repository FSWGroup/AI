import { describe, it, expect } from 'vitest';
import { toCsv, fmtMoney, tenureLabel, daysBetween, addDays, isoDate, fullName, humanize } from '@/lib/format';

describe('CSV encoding', () => {
  it('quotes fields containing commas, quotes and newlines', () => {
    const csv = toCsv(['a', 'b'], [['plain', 'has,comma'], ['has"quote', 'has\nnewline']]);
    expect(csv).toContain('"has,comma"');
    expect(csv).toContain('"has""quote"');
    expect(csv).toContain('"has\nnewline"');
  });

  it('neutralizes formula injection', () => {
    const csv = toCsv(['x'], [['=1+1'], ['+cmd'], ['-2'], ['@SUM(A1)']]);
    // Every dangerous leading character is prefixed with an apostrophe.
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).not.toMatch(/(^|\r\n)=1\+1/);
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv(['a'], [[null], [undefined]])).toBe('a\r\n\r\n');
  });
});

describe('formatting helpers', () => {
  it('formats money by currency', () => {
    expect(fmtMoney(70000)).toBe('$70,000');
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
    expect(fmtMoney(null)).toBe('—');
  });

  it('describes tenure', () => {
    const twoYearsAgo = addDays(new Date(), -800);
    expect(tenureLabel(twoYearsAgo)).toMatch(/^2 yr/);
    expect(tenureLabel(null)).toBe('—');
    expect(tenureLabel(addDays(new Date(), 30))).toBe('Starts soon');
  });

  it('computes day differences and ISO dates in UTC', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    const b = new Date('2026-01-31T00:00:00Z');
    expect(daysBetween(a, b)).toBe(30);
    expect(isoDate(addDays(a, 5))).toBe('2026-01-06');
  });

  it('prefers a preferred name', () => {
    expect(fullName({ legalFirstName: 'Wesley', preferredName: 'Wes', lastName: 'Kim' })).toBe('Wes Kim');
    expect(fullName({ legalFirstName: 'Dana', preferredName: null, lastName: 'Reyes' })).toBe('Dana Reyes');
  });

  it('humanizes enum values', () => {
    expect(humanize('WRITTEN_WARNING')).toBe('Written warning');
    expect(humanize(null)).toBe('—');
  });
});
