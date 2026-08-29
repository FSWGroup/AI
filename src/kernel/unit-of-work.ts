/**
 * The UnitOfWork (ADR-0008, ADR-0021).
 *
 * Every canonical mutation happens inside one. It owns the transaction and it owns
 * the two things that must accompany a change and must not be forgotten:
 *
 *   - an audit entry: who changed what, through which interface, and why
 *   - domain events: what the business asserted
 *
 * Events are buffered rather than written as they are emitted, and flushed as the
 * last statement before COMMIT while holding the advisory sequence lock. That is
 * what makes the ledger's sequence order equal to commit order, and therefore what
 * makes the event feed safe to tail. See ADR-0008.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../platform/db/index.js';
import type { EventDefinition } from '../modules/events/index.js';
import { changedFields, redactRow, type RowSnapshot } from '../modules/audit/index.js';
import type { Clock } from './clock.js';
import type { IdGenerator, Uuid } from './id.js';
import type { RequestContext } from './context.js';

export type AuditOperation =
  'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'UNMERGE' | 'ERASE' | 'DENY';

export interface AuditRecord {
  readonly schema: string;
  readonly table: string;
  readonly entityId: string;
  readonly operation: AuditOperation;
  readonly before?: RowSnapshot | undefined;
  readonly after?: RowSnapshot | undefined;
  /** Overrides the context's reason for this specific record. */
  readonly reason?: string | undefined;
}

export interface EmitOptions {
  readonly aggregateId: string;
  readonly occurredAt?: Date;
  readonly operatingCompany?: string;
}

export interface UnitOfWork {
  readonly tx: DbTransaction;
  readonly context: RequestContext;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Record a change in the audit log. Called by repositories, never by handlers. */
  audit(record: AuditRecord): void;
  /** Buffer a domain event. Written at flush time, in emission order. */
  emit<P>(definition: EventDefinition<P>, payload: P, options: EmitOptions): Uuid;
  /** Event IDs emitted so far, in order. Lets a caller reference what it produced. */
  emittedEventIds(): readonly Uuid[];
}

export interface UnitOfWorkDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

interface BufferedEvent {
  readonly id: Uuid;
  readonly definition: EventDefinition;
  readonly payload: unknown;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly operatingCompany: string | undefined;
}

class UnitOfWorkImpl implements UnitOfWork {
  readonly tx: DbTransaction;
  readonly context: RequestContext;
  readonly clock: Clock;
  readonly ids: IdGenerator;

  readonly #auditRecords: AuditRecord[] = [];
  readonly #events: BufferedEvent[] = [];

  constructor(tx: DbTransaction, context: RequestContext, deps: UnitOfWorkDeps) {
    this.tx = tx;
    this.context = context;
    this.clock = deps.clock;
    this.ids = deps.ids;
  }

  audit(record: AuditRecord): void {
    this.#auditRecords.push(record);
  }

  emit<P>(definition: EventDefinition<P>, payload: P, options: EmitOptions): Uuid {
    // Validate at emission time, not at flush time, so the stack trace points at the
    // code that produced the bad payload.
    definition.validate(payload);
    const id = this.ids.next();
    this.#events.push({
      id,
      definition: definition as EventDefinition,
      payload,
      aggregateId: options.aggregateId,
      occurredAt: options.occurredAt ?? this.clock.now(),
      operatingCompany: options.operatingCompany ?? this.context.operatingCompany,
    });
    return id;
  }

  emittedEventIds(): readonly Uuid[] {
    return this.#events.map((e) => e.id);
  }

  async flush(): Promise<void> {
    await this.#flushAudit();
    await this.#flushEvents();
  }

  async #flushAudit(): Promise<void> {
    if (this.#auditRecords.length === 0) return;
    const ctx = this.context;
    const now = this.clock.now();

    const rows = this.#auditRecords.map((record) => {
      const before = redactRow(record.schema, record.table, record.before);
      const after = redactRow(record.schema, record.table, record.after);
      return {
        id: this.ids.next(),
        occurred_at: now,
        actor_principal_id: ctx.actor.principalId ?? null,
        actor_type: ctx.actor.type,
        actor_label: ctx.actor.label,
        interface: ctx.interface,
        client_ip: ctx.clientIp ?? null,
        user_agent: ctx.userAgent ?? null,
        correlation_id: ctx.correlationId,
        causation_id: ctx.causationId ?? null,
        operating_company: ctx.operatingCompany ?? null,
        entity_schema: record.schema,
        entity_table: record.table,
        entity_id: record.entityId,
        operation: record.operation,
        // Passed as objects, not strings: the flush embeds this array as jsonb, so
        // stringifying here would store a JSON *string* rather than a JSON object.
        before: before ?? null,
        after: after ?? null,
        changed_fields:
          record.operation === 'UPDATE'
            ? changedFields(record.before, record.after)
            : null,
        reason: record.reason ?? ctx.reason ?? null,
        source_record_id: ctx.sourceRecordId ?? null,
      };
    });

    await sql`
      INSERT INTO audit.change_log (
        id, occurred_at, actor_principal_id, actor_type, actor_label, interface,
        client_ip, user_agent, correlation_id, causation_id, operating_company,
        entity_schema, entity_table, entity_id, operation,
        before, after, changed_fields, reason, source_record_id
      )
      SELECT
        (r->>'id')::uuid, (r->>'occurred_at')::timestamptz,
        (r->>'actor_principal_id')::uuid, r->>'actor_type', r->>'actor_label',
        r->>'interface', (r->>'client_ip')::inet, r->>'user_agent',
        (r->>'correlation_id')::uuid, (r->>'causation_id')::uuid,
        r->>'operating_company',
        r->>'entity_schema', r->>'entity_table', r->>'entity_id', r->>'operation',
        CASE WHEN r->'before' = 'null'::jsonb THEN NULL ELSE r->'before' END,
        CASE WHEN r->'after'  = 'null'::jsonb THEN NULL ELSE r->'after'  END,
        CASE WHEN r->'changed_fields' = 'null'::jsonb THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(r->'changed_fields')) END,
        r->>'reason', (r->>'source_record_id')::uuid
      FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS r
    `.execute(this.tx);

    this.#auditRecords.length = 0;
  }

  async #flushEvents(): Promise<void> {
    if (this.#events.length === 0) return;

    // Serialise sequence assignment with commit order. The lock is taken here, as
    // late as possible, and is released only when the transaction ends, so no later
    // transaction can take a sequence number before this one has committed.
    await sql`SELECT pg_advisory_xact_lock(events.sequence_lock_key())`.execute(this.tx);

    const ctx = this.context;
    const recordedAt = this.clock.now();

    const rows = this.#events.map((event) => ({
      id: event.id,
      event_type: event.definition.type,
      schema_version: event.definition.version,
      aggregate_type: event.definition.aggregateType,
      aggregate_id: event.aggregateId,
      occurred_at: event.occurredAt.toISOString(),
      recorded_at: recordedAt.toISOString(),
      actor_principal_id: ctx.actor.principalId ?? null,
      actor_type: ctx.actor.type,
      actor_label: ctx.actor.label,
      correlation_id: ctx.correlationId,
      causation_id: ctx.causationId ?? null,
      operating_company: event.operatingCompany ?? null,
      source: ctx.source,
      payload: event.payload,
    }));

    // `ordinality` preserves emission order, so sequence numbers within one
    // transaction follow the order the domain produced them.
    await sql`
      INSERT INTO events.domain_event (
        id, sequence, event_type, schema_version, aggregate_type, aggregate_id,
        occurred_at, recorded_at, actor_principal_id, actor_type, actor_label,
        correlation_id, causation_id, operating_company, source, payload
      )
      SELECT
        (r->>'id')::uuid,
        nextval('events.domain_event_sequence'),
        r->>'event_type', (r->>'schema_version')::integer,
        r->>'aggregate_type', r->>'aggregate_id',
        (r->>'occurred_at')::timestamptz, (r->>'recorded_at')::timestamptz,
        (r->>'actor_principal_id')::uuid, r->>'actor_type', r->>'actor_label',
        (r->>'correlation_id')::uuid, (r->>'causation_id')::uuid,
        r->>'operating_company', r->>'source', r->'payload'
      FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb)
        WITH ORDINALITY AS t(r, ord)
      ORDER BY t.ord
    `.execute(this.tx);

    this.#events.length = 0;
  }
}

export interface OpenUnitOfWork {
  readonly uow: UnitOfWork;
  /**
   * Write buffered audit entries and events. Must be the last statement before
   * COMMIT: it takes the advisory sequence lock, which is held until the transaction
   * ends (ADR-0008).
   */
  flush(): Promise<void>;
}

/**
 * Build a UnitOfWork over a transaction the caller controls. Used for composing
 * domain services inside one transaction, by the ingestion pipeline, and by tests
 * that need to observe flush ordering directly.
 */
export function createUnitOfWork(
  tx: DbTransaction,
  context: RequestContext,
  deps: UnitOfWorkDeps,
): OpenUnitOfWork {
  const uow = new UnitOfWorkImpl(tx, context, deps);
  return { uow, flush: () => uow.flush() };
}

/**
 * Run `work` inside a transaction with a UnitOfWork. Audit entries and events are
 * flushed before commit; if `work` throws, nothing is written, including the audit
 * entry — which is correct, because nothing changed.
 */
export async function withUnitOfWork<T>(
  db: Database,
  context: RequestContext,
  deps: UnitOfWorkDeps,
  work: (uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    const uow = new UnitOfWorkImpl(tx, context, deps);
    const result = await work(uow);
    await uow.flush();
    return result;
  });
}

/** Nested work reusing an existing UnitOfWork, for composing domain services. */
export type WithUnitOfWork = typeof withUnitOfWork;
