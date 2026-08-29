/**
 * Field classification (ADR-0021, spec §62).
 *
 * Audit records before/after values, so a column holding a secret would put that
 * secret in an append-only table. Classification is registry-driven rather than
 * remembered: a new secret column is protected by classifying it, and anything that
 * *looks* like a secret is redacted even if nobody classified it.
 */

export type Classification = 'SECRET' | 'PII' | 'PUBLIC';

export const REDACTED = '[redacted]';
export const ERASED = '[erased]';

/** Explicit classifications, keyed `schema.table.column`. */
const explicit = new Map<string, Classification>();

/**
 * Fallback for anything unclassified. Deliberately aggressive: over-redacting an
 * audit entry is a nuisance, under-redacting one is an incident.
 */
const SECRET_NAME_PATTERN =
  /(secret|password|passwd|token|credential|api_?key|private_?key|signing|salt|pepper|hash)/i;

const PII_NAME_PATTERN =
  /(email|phone|mobile|first_?name|last_?name|full_?name|given_?name|family_?name|address_line|street|dob|date_?of_?birth|ssn|tax_?id|national_?id)/i;

export function classifyField(
  schema: string,
  table: string,
  column: string,
): Classification {
  const declared = explicit.get(`${schema}.${table}.${column}`);
  if (declared !== undefined) return declared;
  if (SECRET_NAME_PATTERN.test(column)) return 'SECRET';
  if (PII_NAME_PATTERN.test(column)) return 'PII';
  return 'PUBLIC';
}

export function classifyFields(
  schema: string,
  table: string,
  columns: Readonly<Record<string, Classification>>,
): void {
  for (const [column, classification] of Object.entries(columns)) {
    explicit.set(`${schema}.${table}.${column}`, classification);
  }
}

/** Every explicitly classified field. Used by the erasure job to know what to scrub. */
export function classifiedFields(): ReadonlyMap<string, Classification> {
  return explicit;
}

export type RowSnapshot = Readonly<Record<string, unknown>>;

/**
 * Replace secret-classified values before they reach the audit table. PII is kept
 * — audit is where "who changed this contact's phone number" is answered — and is
 * scrubbed later by an erasure request (ADR-0027).
 */
export function redactRow(
  schema: string,
  table: string,
  row: RowSnapshot | undefined,
): RowSnapshot | undefined {
  if (row === undefined) return undefined;
  const output: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    output[column] =
      classifyField(schema, table, column) === 'SECRET' && value !== null
        ? REDACTED
        : value;
  }
  return output;
}

/**
 * Columns whose values differ. Compared by JSON representation so Date, Buffer and
 * nested objects behave, at the cost of being order-sensitive for arrays — which is
 * correct here, since column order within a value is meaningful in Postgres arrays.
 */
export function changedFields(
  before: RowSnapshot | undefined,
  after: RowSnapshot | undefined,
): string[] {
  if (before === undefined || after === undefined) {
    return [
      ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
    ].sort();
  }
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const name of names) {
    if (!sameValue(before[name], after[name])) changed.push(name);
  }
  return changed.sort();
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return value;
}
