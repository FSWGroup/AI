/**
 * Delimited file parsing for file-based connectors (ADR-0023).
 *
 * Written rather than adopted, deliberately and against the usual instinct
 * (ADR-0034 prefers mature libraries). The reason is quarantine: every rejected row
 * must carry its row number, the raw text, and a message that says what to do about
 * it, and a streaming parser's error interface makes that awkward. The scope here is
 * bounded — RFC 4180 with a configurable delimiter — and it is heavily tested.
 *
 * If real Prophet 21 exports prove this inadequate, replacing it with `csv-parse`
 * behind the same interface is a contained change.
 *
 * What it handles, because real exports contain all of it:
 *
 *   * quoted fields containing the delimiter, newlines, and doubled quotes
 *   * CRLF, LF and lone CR line endings
 *   * a UTF-8 byte order mark
 *   * declared encodings other than UTF-8 (Epicor exports are commonly windows-1252)
 *   * ragged rows, reported per row rather than aborting the file
 *   * header matching by NAME, never by position
 */

import { createHash } from 'node:crypto';

export interface DelimitedOptions {
  readonly delimiter?: string;
  /** Declared encoding. Never guessed: a wrong guess corrupts degree symbols silently. */
  readonly encoding?: string;
  /** Treat these exact strings as absent. Distinguishing '' from 'N/A' from '0' matters. */
  readonly nullTokens?: readonly string[];
  /** Trim surrounding whitespace from unquoted fields. */
  readonly trim?: boolean;
}

export interface DelimitedRow {
  /** 1-based, counting the header as row 1, so it matches what a spreadsheet shows. */
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string | null>>;
  /** The row exactly as it appeared, for quarantine. */
  readonly raw: readonly string[];
}

export interface DelimitedProblem {
  readonly rowNumber: number;
  readonly category: 'PARSE_ERROR' | 'RAGGED_ROW' | 'ENCODING_ERROR';
  readonly message: string;
  readonly raw: readonly string[];
}

export interface DelimitedResult {
  readonly columns: readonly string[];
  readonly rows: readonly DelimitedRow[];
  readonly problems: readonly DelimitedProblem[];
}

export class DelimitedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DelimitedParseError';
  }
}

const DEFAULT_NULL_TOKENS = [''] as const;

/**
 * Decode bytes using a declared encoding.
 *
 * `fatal: true` on purpose: a byte sequence that is not valid in the declared encoding
 * is an error worth seeing, not something to paper over with replacement characters.
 * A file that decodes to "SS 316 Ø25" as "SS 316 ï¿½25" is worse than a failed import,
 * because it looks like it worked.
 *
 * What this does NOT catch, and it is worth being clear about: the single-byte code
 * pages are total. Every byte is a valid windows-1252 character, so declaring
 * windows-1252 for a file that is really UTF-8 produces mojibake silently and no
 * decoder can tell. The protection runs one way only — a wrong UTF-8 declaration is
 * caught, a wrong code-page declaration is not — so the declared encoding is a
 * connector configuration decision that a person has to get right, and the encoding
 * actually used is recorded on every landed file so a later correction is possible.
 */
export function decode(bytes: Buffer, encoding = 'utf-8'): string {
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    throw new DelimitedParseError(
      `Could not decode the file as '${encoding}': ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Check the connector's declared encoding rather than changing it to one that ` +
        `merely does not fail.`,
    );
  }
  // Strip a byte order mark if present.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Split into fields, honouring RFC 4180 quoting. */
function splitRecords(
  text: string,
  delimiter: string,
): { fields: string[][]; unterminated: boolean } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let sawAnything = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      sawAnything = true;
      continue;
    }
    if (char === delimiter) {
      record.push(field);
      field = '';
      sawAnything = true;
      continue;
    }
    if (char === '\r' || char === '\n') {
      // Consume CRLF as one terminator.
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      sawAnything = false;
      continue;
    }
    field += char;
    sawAnything = true;
  }

  if (sawAnything || field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return { fields: records, unterminated: inQuotes };
}

function normalizeHeader(name: string): string {
  return name.trim();
}

export function parseDelimited(
  bytes: Buffer,
  options: DelimitedOptions = {},
): DelimitedResult {
  const delimiter = options.delimiter ?? ',';
  if (delimiter.length !== 1) {
    throw new DelimitedParseError('The delimiter must be a single character');
  }
  const nullTokens = new Set(options.nullTokens ?? DEFAULT_NULL_TOKENS);
  const trim = options.trim ?? true;

  const text = decode(bytes, options.encoding ?? 'utf-8');
  const { fields: records, unterminated } = splitRecords(text, delimiter);

  if (unterminated) {
    throw new DelimitedParseError(
      'The file ends inside a quoted field. It is probably truncated; a partial ' +
        'import is not attempted.',
    );
  }
  if (records.length === 0) {
    throw new DelimitedParseError('The file is empty');
  }

  const columns = records[0]!.map(normalizeHeader);
  const duplicates = columns.filter((name, i) => columns.indexOf(name) !== i);
  if (duplicates.length > 0) {
    throw new DelimitedParseError(
      `The header has duplicate column names: ${[...new Set(duplicates)].join(', ')}. ` +
        `Columns are matched by name, so duplicates are ambiguous.`,
    );
  }
  if (columns.some((name) => name === '')) {
    throw new DelimitedParseError(
      'The header has an empty column name. Columns are matched by name, never by ' +
        'position, so an unnamed column cannot be interpreted.',
    );
  }

  const rows: DelimitedRow[] = [];
  const problems: DelimitedProblem[] = [];

  for (let index = 1; index < records.length; index += 1) {
    const raw = records[index]!;
    const rowNumber = index + 1;

    // A wholly empty trailing line is not a record.
    if (raw.length === 1 && raw[0] === '') continue;

    if (raw.length !== columns.length) {
      problems.push({
        rowNumber,
        category: 'RAGGED_ROW',
        message:
          `Expected ${columns.length} fields but found ${raw.length}. The row is ` +
          `quarantined; the rest of the file is still processed.`,
        raw,
      });
      continue;
    }

    const values: Record<string, string | null> = {};
    for (let column = 0; column < columns.length; column += 1) {
      const value = trim ? raw[column]!.trim() : raw[column]!;
      values[columns[column]!] = nullTokens.has(value) ? null : value;
    }
    rows.push({ rowNumber, values, raw });
  }

  return { columns, rows, problems };
}

/**
 * A stable fingerprint of a file's structure.
 *
 * Over the SORTED column names, so reordering columns is not treated as a structural
 * change — reordering is harmless when parsing is by name, and treating it as drift
 * would train people to approve changes without reading them.
 */
export function structuralFingerprint(columns: readonly string[]): string {
  return createHash('sha256')
    .update(
      [...columns]
        .map((c) => c.trim().toLowerCase())
        .sort()
        .join(' '),
    )
    .digest('hex');
}
