/**
 * The connector contract (ADR-0022, spec §77).
 *
 * A connector knows how to find and read its source. It does NOT know about canonical
 * tables: it produces source records, and a separate mapping stage proposes canonical
 * facts from them. That separation is the anti-corruption boundary, and acceptance
 * criterion 26 tests that canonical services depend on this contract rather than on
 * anything Prophet 21 or Pipedrive specific.
 *
 * It is also what makes the Prophet 21 adapter replaceable. When API access appears,
 * `discover` and `read` change and nothing downstream moves.
 */

export type ConnectorKind = 'FILE' | 'API' | 'WEBHOOK' | 'MANUAL';
export type RunMode = 'FULL' | 'INCREMENTAL' | 'RECONCILE' | 'REPLAY';

/**
 * Something the connector found that may contain records: a file, an API page, a
 * webhook delivery. Named neutrally because the pipeline treats them identically.
 */
export interface SourceUnit {
  /** Stable within a run. For a file, its name; for a page, its cursor. */
  readonly id: string;
  readonly objectType: string;
  /** Human-readable, for logs and run reports. */
  readonly label: string;
  /** Opaque connector state, passed back to `read`. */
  readonly handle: unknown;
}

/** Raw bytes plus what is known about how to interpret them. */
export interface SourcePayload {
  readonly bytes: Buffer;
  readonly encoding: string;
  readonly sourceTimezone: string;
  readonly contentType: string;
  readonly filename: string;
}

/** One record as the source presents it, before any canonical interpretation. */
export interface ParsedRecord {
  /** The source's own identifier. Never becomes a canonical key (ADR-0004). */
  readonly sourceId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** When the source says it last changed, where the source tells us. */
  readonly sourceUpdatedAt?: Date | undefined;
  /** Where in the file it came from, for quarantine messages. */
  readonly rowNumber?: number | undefined;
  /** True when the source says this record was deleted. */
  readonly deletedInSource?: boolean | undefined;
}

export type FailureCategory =
  | 'PARSE_ERROR'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_VALUE'
  | 'UNKNOWN_ENUM'
  | 'DUPLICATE_KEY'
  | 'MAPPING_ERROR'
  | 'REFERENTIAL_ERROR'
  | 'ENCODING_ERROR'
  | 'AMBIGUOUS_MATCH';

/** A record that could not be processed. Never discarded; always explained. */
export interface RejectedRecord {
  readonly sourceId: string | undefined;
  readonly category: FailureCategory;
  readonly messages: readonly string[];
  readonly raw: unknown;
  readonly rowNumber?: number | undefined;
  readonly attemptedMapping?: unknown;
}

export interface ParseOutcome {
  readonly objectType: string;
  /** The structure observed, checked against approved fingerprints before any write. */
  readonly columns: readonly string[];
  readonly fingerprint: string;
  readonly records: readonly ParsedRecord[];
  readonly rejects: readonly RejectedRecord[];
  /** Rows seen, including rejected ones. */
  readonly rowCount: number;
}

export interface DiscoverOptions {
  readonly mode: RunMode;
  /** Where the last successful run reached. Undefined on a first or full run. */
  readonly watermark: string | undefined;
}

export interface Connector {
  readonly key: string;
  readonly name: string;
  readonly sourceSystemCode: string;
  readonly kind: ConnectorKind;
  readonly objectTypes: readonly string[];
  readonly mappingVersion: number;
  readonly parserVersion: number;

  /** What is available to process. Ordered; the pipeline processes in order. */
  discover(options: DiscoverOptions): Promise<readonly SourceUnit[]>;

  /** Fetch the bytes for a unit. Separated from parsing so the original is preserved first. */
  read(unit: SourceUnit): Promise<SourcePayload>;

  /** Interpret bytes into records. Pure: no database, no side effects. */
  parse(unit: SourceUnit, payload: SourcePayload): Promise<ParseOutcome>;

  /**
   * The watermark to record after a successful run. For a file connector this is
   * typically the newest file's timestamp; for an API, the last cursor.
   */
  watermarkAfter(
    units: readonly SourceUnit[],
    previous: string | undefined,
  ): string | undefined;
}

export interface RunCounters {
  discovered: number;
  downloaded: number;
  added: number;
  changed: number;
  unchanged: number;
  rejected: number;
  matched: number;
  needsReview: number;
  errorCount: number;
}

export interface RunResult {
  readonly runId: string;
  readonly status: 'SUCCEEDED' | 'FAILED' | 'HALTED';
  readonly counters: RunCounters;
  readonly haltReason: string | undefined;
  readonly filesSkipped: number;
}

/** Raised when a source's structure does not match an approved one. Halts the run. */
export class SchemaDriftError extends Error {
  readonly connectorKey: string;
  readonly objectType: string;
  readonly fingerprint: string;
  readonly columns: readonly string[];
  readonly changeSummary: string;

  constructor(input: {
    connectorKey: string;
    objectType: string;
    fingerprint: string;
    columns: readonly string[];
    changeSummary: string;
  }) {
    super(
      `Structure of '${input.objectType}' from connector '${input.connectorKey}' does ` +
        `not match an approved one. ${input.changeSummary} The run is halted before ` +
        `any canonical write: a changed export is a change someone must look at, not ` +
        `something to absorb silently.`,
    );
    this.name = 'SchemaDriftError';
    this.connectorKey = input.connectorKey;
    this.objectType = input.objectType;
    this.fingerprint = input.fingerprint;
    this.columns = input.columns;
    this.changeSummary = input.changeSummary;
  }
}
