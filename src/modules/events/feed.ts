/**
 * Reading the ledger (ADR-0010).
 *
 * `sequence` is commit-ordered (ADR-0008), so `sequence > cursor ORDER BY sequence`
 * is a complete, resumable, replayable read with no visibility caveats. This is the
 * primary integration mechanism for consuming applications and the mechanism by which
 * a read model is rebuilt from event zero.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';

export interface LedgerEvent {
  readonly id: string;
  readonly sequence: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorType: string;
  readonly actorLabel: string;
  readonly actorPrincipalId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly operatingCompany: string | null;
  readonly source: string;
  readonly payload: unknown;
}

export interface ReadOptions {
  /** Exclusive lower bound. Pass '0' to replay from the beginning. */
  readonly after?: string;
  readonly limit?: number;
  /** Glob patterns matched against event_type, e.g. ['fsw.pim.*']. */
  readonly types?: readonly string[];
  readonly aggregate?: { readonly type: string; readonly id: string };
}

const MAX_LIMIT = 1000;

/** Convert an event-type glob into a SQL LIKE pattern. Only `*` is supported. */
export function globToLike(pattern: string): string {
  return pattern.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/\*/g, '%');
}

export function matchesAny(eventType: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const regex = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return regex.test(eventType);
  });
}

export async function readEvents(
  db: Database | DbTransaction,
  options: ReadOptions = {},
): Promise<readonly LedgerEvent[]> {
  const after = options.after ?? '0';
  const limit = Math.min(Math.max(options.limit ?? 100, 1), MAX_LIMIT);
  const likePatterns = (options.types ?? []).map(globToLike);

  // `sequence` is selected unaliased on purpose. Writing `sequence::text AS sequence`
  // makes ORDER BY resolve to the *text* output column rather than the bigint one,
  // which sorts '10' before '9' and lets a tailing cursor move backwards. The bigint
  // is returned as a string by the pg type parser anyway (see platform/db).
  const result = await sql<Record<string, unknown>>`
    SELECT id, sequence, event_type, schema_version,
           aggregate_type, aggregate_id, occurred_at, recorded_at,
           actor_type, actor_label, actor_principal_id,
           correlation_id, causation_id, operating_company, source, payload
      FROM events.domain_event
     WHERE sequence > ${after}::bigint
       AND (${likePatterns.length === 0} OR event_type LIKE ANY (${likePatterns}::text[]))
       AND (${options.aggregate === undefined}
            OR (aggregate_type = ${options.aggregate?.type ?? null}
                AND aggregate_id = ${options.aggregate?.id ?? null}))
     ORDER BY events.domain_event.sequence
     LIMIT ${limit}
  `.execute(db);

  return result.rows.map(toLedgerEvent);
}

export async function latestSequence(db: Database | DbTransaction): Promise<string> {
  const result = await sql<{ max_sequence: string | null }>`
    SELECT max(sequence) AS max_sequence FROM events.domain_event
  `.execute(db);
  return result.rows[0]?.max_sequence ?? '0';
}

function toLedgerEvent(row: Record<string, unknown>): LedgerEvent {
  return {
    id: row['id'] as string,
    sequence: row['sequence'] as string,
    eventType: row['event_type'] as string,
    schemaVersion: row['schema_version'] as number,
    aggregateType: row['aggregate_type'] as string,
    aggregateId: row['aggregate_id'] as string,
    occurredAt: row['occurred_at'] as Date,
    recordedAt: row['recorded_at'] as Date,
    actorType: row['actor_type'] as string,
    actorLabel: row['actor_label'] as string,
    actorPrincipalId: (row['actor_principal_id'] as string | null) ?? null,
    correlationId: row['correlation_id'] as string,
    causationId: (row['causation_id'] as string | null) ?? null,
    operatingCompany: (row['operating_company'] as string | null) ?? null,
    source: row['source'] as string,
    payload: row['payload'],
  };
}
