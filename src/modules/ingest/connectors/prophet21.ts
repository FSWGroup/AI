/**
 * The Prophet 21 connector (ADR-0023).
 *
 * FSW runs current cloud-hosted Epicor Prophet 21 and **has no API access available to
 * this project**. Nothing here assumes one exists. This is an adapter around whatever
 * supported export mechanism is approved during discovery: scheduled report delivery,
 * a secure file transfer, or a named person exporting on a schedule. The pipeline does
 * not care which, and neither does the canonical model.
 *
 * When API access does appear, `discover`, `read` and `parse` are replaced and nothing
 * downstream moves. That is the point of the contract, and acceptance criterion 26
 * tests it.
 *
 * What this connector does NOT do, deliberately:
 *
 *   * write anything back to Prophet 21 (ADR-0033)
 *   * assume a P21 customer is an FSW organization, or a P21 ship-to a plant. It
 *     produces source records; the mapping stage proposes canonical facts from them
 *     (spec §77)
 *   * parse by column position. Ever.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseDelimited,
  structuralFingerprint,
  DelimitedParseError,
} from '../delimited.js';
import type {
  Connector,
  DiscoverOptions,
  ParseOutcome,
  ParsedRecord,
  RejectedRecord,
  SourcePayload,
  SourceUnit,
} from '../types.js';

/**
 * How a P21 export file is interpreted.
 *
 * Every one of these is a decision that must be explicit rather than guessed, because
 * getting any of them wrong is silent: the import succeeds and the data is subtly
 * wrong.
 */
export interface P21ObjectMapping {
  readonly objectType: string;
  /** Filenames beginning with this are this object type. */
  readonly filePrefix: string;
  /** The column carrying the source's own identifier. */
  readonly keyColumn: string;
  /** Columns that must be present and non-empty, or the row is quarantined. */
  readonly requiredColumns: readonly string[];
  /** The column carrying the source's last-modified timestamp, where one exists. */
  readonly updatedAtColumn?: string;
  /**
   * Strings this export uses to mean "absent", per object type.
   *
   * P21 exports conflate empty string, 'N/A' and sometimes '0'. Which of those means
   * "no value" and which means "the value is zero" differs by column and matters: a
   * credit limit of 0 is not the same as an unknown credit limit.
   */
  readonly nullTokens?: readonly string[];
  /** A column whose truthiness marks the record inactive or deleted in P21. */
  readonly deletedFlagColumn?: string;
  readonly deletedFlagValues?: readonly string[];
}

export interface P21ConnectorOptions {
  readonly key?: string;
  /** Where approved export files land. A directory, an SFTP mount, a synced bucket. */
  readonly landingPath: string;
  /**
   * Encoding of the export files. Epicor exports are commonly windows-1252; declaring
   * it wrong turns a degree symbol into a replacement character, which looks like it
   * worked (ADR-0023).
   */
  readonly encoding?: string;
  /**
   * The time zone naive timestamps in the export are expressed in. P21 exports
   * routinely omit an offset, and interpreting them as UTC shifts every date.
   */
  readonly sourceTimezone?: string;
  readonly delimiter?: string;
  readonly mappings: readonly P21ObjectMapping[];
  readonly mappingVersion?: number;
  readonly parserVersion?: number;
  /** Injected for tests; defaults to the real filesystem. */
  readonly fileSystem?: P21FileSystem;
}

/** The filesystem operations this connector needs, so tests need no real files. */
export interface P21FileSystem {
  list(path: string): Promise<readonly string[]>;
  read(path: string): Promise<Buffer>;
  modifiedAt(path: string): Promise<Date>;
}

const realFileSystem: P21FileSystem = {
  async list(path) {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  },
  read: (path) => readFile(path),
  async modifiedAt(path) {
    return (await stat(path)).mtime;
  },
};

/**
 * The default object mappings.
 *
 * PROVISIONAL. These name the P21 entities assumption A-011 expects and the columns a
 * standard export is likely to carry, but the real column names come from real files
 * and discovery question C1. The mapping is data, not code: correcting it is an edit
 * here plus a mapping-version bump, and every source record records the version it was
 * interpreted under.
 */
export const DEFAULT_P21_MAPPINGS: readonly P21ObjectMapping[] = [
  {
    objectType: 'customer',
    filePrefix: 'customer',
    keyColumn: 'customer_id',
    requiredColumns: ['customer_id', 'customer_name'],
    updatedAtColumn: 'date_last_modified',
    nullTokens: ['', 'N/A', 'NULL'],
    deletedFlagColumn: 'delete_flag',
    deletedFlagValues: ['Y', 'y', '1', 'true'],
  },
  {
    objectType: 'ship_to',
    filePrefix: 'ship_to',
    // A ship-to is identified by the pair, because ship-to numbers repeat across
    // customers. Composite keys are joined with a separator that cannot appear in
    // either part.
    keyColumn: 'customer_id|ship_to_id',
    requiredColumns: ['customer_id', 'ship_to_id'],
    updatedAtColumn: 'date_last_modified',
    nullTokens: ['', 'N/A', 'NULL'],
    deletedFlagColumn: 'delete_flag',
    deletedFlagValues: ['Y', 'y', '1', 'true'],
  },
  {
    objectType: 'contact',
    filePrefix: 'contact',
    keyColumn: 'contact_id',
    requiredColumns: ['contact_id'],
    updatedAtColumn: 'date_last_modified',
    nullTokens: ['', 'N/A', 'NULL'],
  },
  {
    objectType: 'item',
    filePrefix: 'item',
    keyColumn: 'item_id',
    requiredColumns: ['item_id', 'item_desc'],
    updatedAtColumn: 'date_last_modified',
    nullTokens: ['', 'N/A', 'NULL'],
    deletedFlagColumn: 'delete_flag',
    deletedFlagValues: ['Y', 'y', '1', 'true'],
  },
  {
    objectType: 'supplier',
    filePrefix: 'supplier',
    keyColumn: 'supplier_id',
    requiredColumns: ['supplier_id', 'supplier_name'],
    updatedAtColumn: 'date_last_modified',
    nullTokens: ['', 'N/A', 'NULL'],
  },
];

interface FileHandle {
  readonly path: string;
  readonly filename: string;
  readonly mapping: P21ObjectMapping;
  readonly modifiedAt: Date;
}

export class Prophet21Connector implements Connector {
  readonly key: string;
  readonly name = 'Epicor Prophet 21 (file export)';
  readonly sourceSystemCode = 'P21';
  readonly kind = 'FILE' as const;
  readonly objectTypes: readonly string[];
  readonly mappingVersion: number;
  readonly parserVersion: number;

  readonly #options: P21ConnectorOptions;
  readonly #fs: P21FileSystem;

  constructor(options: P21ConnectorOptions) {
    this.#options = options;
    this.#fs = options.fileSystem ?? realFileSystem;
    this.key = options.key ?? 'prophet21_files';
    this.objectTypes = options.mappings.map((m) => m.objectType);
    this.mappingVersion = options.mappingVersion ?? 1;
    this.parserVersion = options.parserVersion ?? 1;
  }

  async discover(options: DiscoverOptions): Promise<readonly SourceUnit[]> {
    const filenames = await this.#fs.list(this.#options.landingPath);
    const units: SourceUnit[] = [];

    for (const filename of [...filenames].sort()) {
      const mapping = this.#options.mappings.find((m) =>
        filename.toLowerCase().startsWith(m.filePrefix.toLowerCase()),
      );
      if (mapping === undefined) continue;

      const path = join(this.#options.landingPath, filename);
      const modifiedAt = await this.#fs.modifiedAt(path);

      // An incremental run only looks at files newer than the watermark. A file that
      // arrives late with an older timestamp would be skipped, which is why the
      // reconciliation pass exists and why FULL mode ignores the watermark.
      if (
        options.mode === 'INCREMENTAL' &&
        options.watermark !== undefined &&
        modifiedAt.toISOString() <= options.watermark
      ) {
        continue;
      }

      const handle: FileHandle = { path, filename, mapping, modifiedAt };
      units.push({
        id: filename,
        objectType: mapping.objectType,
        label: `${mapping.objectType} from ${filename}`,
        handle,
      });
    }

    // Oldest first, so a later file's version of a record wins.
    return units.sort((a, b) => {
      const left = (a.handle as FileHandle).modifiedAt.getTime();
      const right = (b.handle as FileHandle).modifiedAt.getTime();
      return left - right;
    });
  }

  async read(unit: SourceUnit): Promise<SourcePayload> {
    const handle = unit.handle as FileHandle;
    return {
      bytes: await this.#fs.read(handle.path),
      encoding: this.#options.encoding ?? 'windows-1252',
      sourceTimezone: this.#options.sourceTimezone ?? 'America/New_York',
      contentType: 'text/csv',
      filename: handle.filename,
    };
  }

  async parse(unit: SourceUnit, payload: SourcePayload): Promise<ParseOutcome> {
    const handle = unit.handle as FileHandle;
    const mapping = handle.mapping;

    let parsed;
    try {
      parsed = parseDelimited(payload.bytes, {
        delimiter: this.#options.delimiter ?? ',',
        encoding: payload.encoding,
        nullTokens: mapping.nullTokens ?? [''],
      });
    } catch (error) {
      if (error instanceof DelimitedParseError) {
        // A file-level failure. Nothing from it is trusted: a truncated or
        // wrongly-encoded file is not partially imported.
        throw error;
      }
      throw error;
    }

    const fingerprint = structuralFingerprint(parsed.columns);
    const records: ParsedRecord[] = [];
    const rejects: RejectedRecord[] = parsed.problems.map((problem) => ({
      sourceId: undefined,
      category: 'PARSE_ERROR' as const,
      messages: [problem.message],
      raw: { row: problem.raw },
      rowNumber: problem.rowNumber,
    }));

    const keyColumns = mapping.keyColumn.split('|');
    const missingKeyColumns = keyColumns.filter((c) => !parsed.columns.includes(c));
    const missingRequired = mapping.requiredColumns.filter(
      (c) => !parsed.columns.includes(c),
    );

    if (missingKeyColumns.length > 0 || missingRequired.length > 0) {
      // A structural problem, not a row problem, so it is reported as structure and no
      // rows are interpreted. The fingerprint check halts the run before any write --
      // a column set missing the identifier cannot match an approved fingerprint --
      // and the reject below makes the reason specific rather than leaving a reviewer
      // to diff two hashes.
      return {
        objectType: mapping.objectType,
        columns: parsed.columns,
        fingerprint,
        records: [],
        rejects: [
          ...rejects,
          {
            sourceId: undefined,
            category: 'MAPPING_ERROR' as const,
            messages: [
              `The ${mapping.objectType} export is missing required columns: ` +
                `${[...new Set([...missingKeyColumns, ...missingRequired])].join(', ')}. ` +
                `No rows were interpreted: without the identifier column, matching a ` +
                `row to anything is guesswork.`,
            ],
            raw: { columns: parsed.columns },
          },
        ],
        rowCount: parsed.rows.length + parsed.problems.length,
      };
    }

    for (const row of parsed.rows) {
      const keyParts = keyColumns.map((column) => row.values[column]);
      if (keyParts.some((part) => part === null || part === undefined || part === '')) {
        rejects.push({
          sourceId: undefined,
          category: 'MISSING_REQUIRED_FIELD',
          messages: [
            `The identifier column${keyColumns.length > 1 ? 's' : ''} ` +
              `'${mapping.keyColumn}' ${keyColumns.length > 1 ? 'are' : 'is'} empty. ` +
              `Without an identifier the record cannot be matched to anything, now or later.`,
          ],
          raw: row.values,
          rowNumber: row.rowNumber,
        });
        continue;
      }
      const sourceId = keyParts.join('|');

      const emptyRequired = mapping.requiredColumns.filter(
        (column) => row.values[column] === null || row.values[column] === undefined,
      );
      if (emptyRequired.length > 0) {
        rejects.push({
          sourceId,
          category: 'MISSING_REQUIRED_FIELD',
          messages: emptyRequired.map(
            (column) =>
              `'${column}' is required for a ${mapping.objectType} record and is empty.`,
          ),
          raw: row.values,
          rowNumber: row.rowNumber,
        });
        continue;
      }

      const updatedRaw =
        mapping.updatedAtColumn === undefined
          ? undefined
          : row.values[mapping.updatedAtColumn];
      const sourceUpdatedAt = parseSourceTimestamp(
        updatedRaw ?? undefined,
        payload.sourceTimezone,
      );
      if (
        updatedRaw !== null &&
        updatedRaw !== undefined &&
        sourceUpdatedAt === undefined
      ) {
        rejects.push({
          sourceId,
          category: 'INVALID_VALUE',
          messages: [
            `'${mapping.updatedAtColumn}' is '${updatedRaw}', which is not a timestamp ` +
              `this parser recognises. Incremental synchronisation depends on it, so ` +
              `the row is quarantined rather than imported with an unknown age.`,
          ],
          raw: row.values,
          rowNumber: row.rowNumber,
        });
        continue;
      }

      const deletedInSource =
        mapping.deletedFlagColumn !== undefined &&
        (mapping.deletedFlagValues ?? ['Y']).includes(
          String(row.values[mapping.deletedFlagColumn] ?? ''),
        );

      records.push({
        sourceId,
        payload: row.values,
        sourceUpdatedAt,
        rowNumber: row.rowNumber,
        deletedInSource,
      });
    }

    return {
      objectType: mapping.objectType,
      columns: parsed.columns,
      fingerprint,
      records,
      rejects,
      rowCount: parsed.rows.length + parsed.problems.length,
    };
  }

  watermarkAfter(
    units: readonly SourceUnit[],
    previous: string | undefined,
  ): string | undefined {
    const newest = units
      .map((unit) => (unit.handle as FileHandle).modifiedAt.toISOString())
      .sort()
      .pop();
    if (newest === undefined) return previous;
    return previous !== undefined && previous > newest ? previous : newest;
  }
}

/**
 * Interpret a timestamp from an export.
 *
 * P21 exports commonly carry naive local timestamps. Interpreting one as UTC shifts
 * every date by the offset, which is invisible until someone asks why a record was
 * modified before it was created. An unparseable value returns undefined and the row is
 * quarantined; it is never silently treated as "now".
 */
export function parseSourceTimestamp(
  raw: string | undefined,
  timeZone: string,
): Date | undefined {
  if (raw === undefined || raw === null || raw.trim() === '') return undefined;
  const text = raw.trim();

  // Already carries an offset or a Z: trust it.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text) ??
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (match === null) return undefined;

  let year: number;
  let month: number;
  let day: number;
  if (text.includes('/')) {
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  } else {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return undefined;
  }

  // Resolve the declared zone's offset for this instant, then correct for it. Uses the
  // platform time zone database rather than a hard-coded offset, so daylight saving is
  // handled and the connector's declared zone is honoured.
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  // Date.UTC rolls over: 2026-02-30 becomes 2 March. A date the source states and the
  // calendar does not have is a value to quarantine, not to quietly correct.
  const rolled = new Date(naiveUtc);
  if (
    rolled.getUTCFullYear() !== year ||
    rolled.getUTCMonth() !== month - 1 ||
    rolled.getUTCDate() !== day
  ) {
    return undefined;
  }

  const offsetMinutes = zoneOffsetMinutes(new Date(naiveUtc), timeZone);
  const resolved = new Date(naiveUtc - offsetMinutes * 60_000);
  return Number.isNaN(resolved.getTime()) ? undefined : resolved;
}

/**
 * The declared zone's offset at a given instant, from the platform time zone database.
 *
 * An unrecognised zone throws rather than defaulting to UTC. Defaulting would shift
 * every timestamp in the import by the real offset and produce no error anywhere,
 * which is the class of failure this whole function exists to prevent. It is also a
 * configuration mistake rather than a data one, so failing the run is the right blast
 * radius: quarantining every row would point the reader at the data instead.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const asUtc = Date.UTC(
      Number(parts['year']),
      Number(parts['month']) - 1,
      Number(parts['day']),
      Number(parts['hour']) === 24 ? 0 : Number(parts['hour']),
      Number(parts['minute']),
      Number(parts['second']),
    );
    return (asUtc - instant.getTime()) / 60_000;
  } catch (error) {
    throw new Error(
      `The connector declares source time zone '${timeZone}', which this runtime does ` +
        `not recognise. Naive export timestamps cannot be interpreted without it, and ` +
        `assuming UTC would shift every one of them silently. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
