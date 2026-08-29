import { describe, it, expect } from 'vitest';
import {
  parseDelimited,
  decode,
  structuralFingerprint,
  DelimitedParseError,
} from '../../src/modules/ingest/index.js';
import { parseSourceTimestamp } from '../../src/modules/ingest/connectors/prophet21.js';

/**
 * The delimited parser is hand-written (ADR-0023), so it carries the burden of proof a
 * mature library would otherwise carry. These are the cases real exports contain.
 */

const cp1252 = (text: string): Buffer => Buffer.from(text, 'latin1');

describe('delimited parsing', () => {
  it('reads quoted fields containing the delimiter, newlines and doubled quotes', () => {
    const result = parseDelimited(
      cp1252(
        'id,name,note\r\n' +
          '1,"Welsford, F.S. & Co.","He said ""no"" twice"\r\n' +
          '2,"Line one\nLine two",plain\r\n',
      ),
    );
    expect(result.problems).toEqual([]);
    expect(result.rows[0]!.values).toEqual({
      id: '1',
      name: 'Welsford, F.S. & Co.',
      note: 'He said "no" twice',
    });
    expect(result.rows[1]!.values['name']).toBe('Line one\nLine two');
  });

  it('accepts CRLF, LF and lone CR line endings', () => {
    for (const ending of ['\r\n', '\n', '\r']) {
      const result = parseDelimited(cp1252(`a,b${ending}1,2${ending}3,4${ending}`));
      expect(result.rows.map((r) => r.values['a'])).toEqual(['1', '3']);
    }
  });

  it('strips a UTF-8 byte order mark from the first column name', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('id,name\n1,x\n'),
    ]);
    const result = parseDelimited(bytes, { encoding: 'utf-8' });
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows[0]!.values['id']).toBe('1');
  });

  it('numbers rows the way a spreadsheet does, counting the header as row 1', () => {
    const result = parseDelimited(cp1252('a\n1\n2\n3\n'));
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
  });

  it('reports a ragged row and keeps processing the rest of the file', () => {
    const result = parseDelimited(cp1252('a,b,c\n1,2,3\n4,5\n6,7,8\n'));
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.rowNumber).toBe(3);
    expect(result.problems[0]!.category).toBe('RAGGED_ROW');
    // The row is preserved exactly, so a reviewer can see what arrived.
    expect(result.problems[0]!.raw).toEqual(['4', '5']);
  });

  it('distinguishes an empty field from a declared null token from a zero', () => {
    const result = parseDelimited(cp1252('a,b,c\n,N/A,0\n'), { nullTokens: ['', 'N/A'] });
    expect(result.rows[0]!.values).toEqual({ a: null, b: null, c: '0' });
  });

  it('keeps a token as text when it is not declared null', () => {
    // A credit limit of 0 is not an unknown credit limit, and 'N/A' is only absence
    // where the export says it is.
    const result = parseDelimited(cp1252('a,b\nN/A,0\n'));
    expect(result.rows[0]!.values).toEqual({ a: 'N/A', b: '0' });
  });

  it('refuses a header with duplicate or empty column names', () => {
    expect(() => parseDelimited(cp1252('a,b,a\n1,2,3\n'))).toThrow(
      /duplicate column names: a/,
    );
    expect(() => parseDelimited(cp1252('a,,c\n1,2,3\n'))).toThrow(/empty column name/);
  });

  it('refuses a file that ends inside a quoted field rather than importing part of it', () => {
    expect(() => parseDelimited(cp1252('a,b\n1,"unterminated\n'))).toThrow(
      /ends inside a quoted field/,
    );
  });

  it('refuses an empty file and a multi-character delimiter', () => {
    expect(() => parseDelimited(Buffer.alloc(0))).toThrow(DelimitedParseError);
    expect(() => parseDelimited(cp1252('a\n1\n'), { delimiter: '||' })).toThrow(
      /single character/,
    );
  });

  it('ignores a blank trailing line but keeps a genuinely empty single-column row', () => {
    expect(parseDelimited(cp1252('a,b\n1,2\n\n')).rows).toHaveLength(1);
    expect(parseDelimited(cp1252('a\n1\n\n')).rows.map((r) => r.values['a'])).toEqual([
      '1',
    ]);
  });

  it('supports a tab-delimited export', () => {
    const result = parseDelimited(cp1252('a\tb\n1\t2\n'), { delimiter: '\t' });
    expect(result.rows[0]!.values).toEqual({ a: '1', b: '2' });
  });

  it('fails loudly on a byte sequence invalid in the declared encoding', () => {
    // 0xB0 alone is a degree sign in windows-1252 and invalid UTF-8.
    const bytes = Buffer.concat([
      Buffer.from('a\n'),
      Buffer.from([0xb0]),
      Buffer.from('\n'),
    ]);
    expect(() => decode(bytes, 'utf-8')).toThrow(/Could not decode the file as 'utf-8'/);
    // The same bytes read correctly under the encoding they are actually in.
    expect(decode(bytes, 'windows-1252')).toBe('a\n°\n');
  });
});

describe('structural fingerprint', () => {
  it('is stable across column reordering, case and surrounding whitespace', () => {
    const base = structuralFingerprint(['customer_id', 'customer_name', 'credit_limit']);
    expect(
      structuralFingerprint(['credit_limit', 'CUSTOMER_ID', ' customer_name ']),
    ).toBe(base);
  });

  it('changes when a column is added or removed', () => {
    const base = structuralFingerprint(['a', 'b']);
    expect(structuralFingerprint(['a', 'b', 'c'])).not.toBe(base);
    expect(structuralFingerprint(['a'])).not.toBe(base);
  });
});

describe('source timestamps', () => {
  const NY = 'America/New_York';

  it('interprets a naive timestamp in the declared zone, not UTC', () => {
    // Eastern Standard Time: UTC-5.
    expect(parseSourceTimestamp('2026-01-02 10:00:00', NY)!.toISOString()).toBe(
      '2026-01-02T15:00:00.000Z',
    );
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // Eastern Daylight Time: UTC-4. A fixed offset would put this an hour out.
    expect(parseSourceTimestamp('2026-07-02 10:00:00', NY)!.toISOString()).toBe(
      '2026-07-02T14:00:00.000Z',
    );
  });

  it('accepts the US date format P21 exports often use', () => {
    expect(parseSourceTimestamp('1/2/2026 9:15', NY)!.toISOString()).toBe(
      '2026-01-02T14:15:00.000Z',
    );
  });

  it('trusts a value that carries its own offset', () => {
    expect(parseSourceTimestamp('2026-01-02T10:00:00Z', NY)!.toISOString()).toBe(
      '2026-01-02T10:00:00.000Z',
    );
    expect(parseSourceTimestamp('2026-01-02T10:00:00-08:00', NY)!.toISOString()).toBe(
      '2026-01-02T18:00:00.000Z',
    );
  });

  it('handles a date with no time as midnight in the declared zone', () => {
    expect(parseSourceTimestamp('2026-01-02', NY)!.toISOString()).toBe(
      '2026-01-02T05:00:00.000Z',
    );
  });

  it('returns undefined for anything it does not recognise, never a guess', () => {
    for (const value of ['not-a-date', '02-JAN-26', '20260102', '', '   ']) {
      expect(parseSourceTimestamp(value, NY)).toBeUndefined();
    }
  });

  it('rejects a date the calendar does not have instead of rolling it over', () => {
    expect(parseSourceTimestamp('2026-02-30', NY)).toBeUndefined();
    expect(parseSourceTimestamp('2026-13-01', NY)).toBeUndefined();
    expect(parseSourceTimestamp('2026-01-02 25:00:00', NY)).toBeUndefined();
  });

  it('refuses to fall back to UTC when the declared zone is unknown', () => {
    expect(() => parseSourceTimestamp('2026-01-02 10:00:00', 'Mars/Olympus')).toThrow(
      /does not recognise/,
    );
  });
});
