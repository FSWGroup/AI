/**
 * The shared ingestion pipeline (ADR-0022, spec §8).
 *
 * SOURCE → LAND → PARSE → VALIDATE → STAGE, run identically for every connector. The
 * later stages — NORMALIZE, MATCH, SURVIVE, CANONICALIZE — operate on the staged
 * source records and belong to the domain modules, because deciding that a P21
 * customer is the same plant as a Pipedrive organization is not a parsing concern.
 *
 * The guarantees this file is responsible for:
 *
 *   * the original bytes are preserved before anything is interpreted
 *   * re-presenting the same file is a no-op, not a duplicate import
 *   * an unapproved structure halts the run before any write
 *   * a bad record is quarantined with a reason and the import continues
 *   * an interrupted run resumes from its watermark
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';
import type { ObjectStore } from '../../platform/object-store.js';
import { contentKey, sha256Of } from '../../platform/object-store.js';
import type { Clock } from '../../kernel/clock.js';
import type { IdGenerator } from '../../kernel/id.js';
import type { RequestContext } from '../../kernel/context.js';
import { withUnitOfWork } from '../../kernel/unit-of-work.js';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import {
  RunCompleted,
  RunHalted,
  RunStarted,
  RecordQuarantined,
  SchemaDriftDetected,
  SourceRecordChanged,
} from './events.js';
import {
  SchemaDriftError,
  type Connector,
  type ParseOutcome,
  type ParsedRecord,
  type RejectedRecord,
  type RunCounters,
  type RunMode,
  type RunResult,
} from './types.js';

export interface PipelineDeps {
  readonly db: Database;
  readonly objectStore: ObjectStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface RunOptions {
  readonly mode?: RunMode;
  /** Process a structure that has not been approved. Requires a deliberate decision. */
  readonly approveNewStructures?: boolean;
  /** Cap on units processed, for a controlled first run against a new source. */
  readonly maxUnits?: number;
}

function emptyCounters(): RunCounters {
  return {
    discovered: 0,
    downloaded: 0,
    added: 0,
    changed: 0,
    unchanged: 0,
    rejected: 0,
    matched: 0,
    needsReview: 0,
    errorCount: 0,
  };
}

function hashPayload(payload: Readonly<Record<string, unknown>>): string {
  // Canonical key ordering, so the same content hashes the same however it was built.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      );
    }
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
}

/**
 * Run one ingestion pass.
 *
 * Each unit is processed in its own transaction. A failure part-way through leaves the
 * units already staged staged, the run marked FAILED, and the watermark un-advanced —
 * so a restart re-processes from the last good point and the content hashes make the
 * repeat harmless.
 */
export async function runIngestion(
  connector: Connector,
  deps: PipelineDeps,
  context: RequestContext,
  options: RunOptions = {},
): Promise<RunResult> {
  const mode = options.mode ?? 'INCREMENTAL';
  const counters = emptyCounters();
  let filesSkipped = 0;
  // Object types this run actually saw a file for. Absence is only meaningful for
  // these: a full extract that did not arrive says nothing about what still exists.
  const presentedObjectTypes = new Set<string>();

  await registerConnector(deps, context, connector);

  const watermarkBefore = await currentWatermark(deps.db, connector.key);
  const runId = deps.ids.next();

  await withUnitOfWork(deps.db, context, deps, async (uow) => {
    await sql`
      INSERT INTO ingest.run
        (id, connector_key, mode, status, watermark_before, correlation_id,
         actor_principal_id, mapping_version, parser_version)
      VALUES (${runId}, ${connector.key}, ${mode}, 'RUNNING', ${watermarkBefore ?? null},
              ${context.correlationId}, ${context.actor.principalId ?? null}::uuid,
              ${connector.mappingVersion}, ${connector.parserVersion})
    `.execute(uow.tx);
    uow.emit(
      RunStarted,
      {
        runId,
        connectorKey: connector.key,
        mode,
        watermarkBefore: watermarkBefore ?? null,
      },
      { aggregateId: runId },
    );
  });

  try {
    const discovered = await connector.discover({ mode, watermark: watermarkBefore });
    const units =
      options.maxUnits === undefined ? discovered : discovered.slice(0, options.maxUnits);
    counters.discovered = units.length;

    for (const unit of units) {
      const payload = await connector.read(unit);
      const sha256 = sha256Of(payload.bytes);

      // Preserve the original BEFORE interpreting it. If parsing fails, we still have
      // exactly what arrived, which is what makes a failed import diagnosable.
      const objectRef = contentKey(
        `ingest/${connector.key}`,
        sha256,
        extensionOf(payload.filename),
      );
      await deps.objectStore.put(objectRef, payload.bytes, {
        contentType: payload.contentType,
        ifAbsent: true,
      });

      presentedObjectTypes.add(unit.objectType);

      const alreadySeen = await seenBefore(
        deps.db,
        connector.key,
        unit.objectType,
        sha256,
      );
      if (alreadySeen !== undefined && mode !== 'REPLAY') {
        // Identical content, already processed. This is acceptance criterion 14: the
        // same export presented twice creates no duplicate business facts.
        //
        // The records are still touched, because the source HAS just re-asserted that
        // they exist. Skipping that would make a re-presented full extract look like a
        // mass deletion, which is the opposite of what it is.
        await withUnitOfWork(deps.db, context, deps, async (uow) => {
          await touchRecordsFrom(uow, connector, runId, alreadySeen);
        });
        filesSkipped += 1;
        continue;
      }
      counters.downloaded += 1;

      const outcome = await connector.parse(unit, payload);

      // Deliberately BEFORE the write transaction, in one of its own. Recording that
      // an unapproved structure was seen is the point of the check; if it shared the
      // transaction with the write that then rolls back, a reviewer would have nothing
      // to approve and the next run would rediscover the same drift from scratch.
      await ensureStructureApproved(
        deps,
        context,
        connector,
        runId,
        outcome,
        options.approveNewStructures ?? false,
      );

      await withUnitOfWork(deps.db, context, deps, async (uow) => {
        const landedFileId = deps.ids.next();
        await sql`
          INSERT INTO ingest.landed_file
            (id, run_id, connector_key, filename, byte_size, sha256, object_ref,
             encoding, source_timezone, object_type, schema_fingerprint, row_count,
             parser_version)
          VALUES (${landedFileId}, ${runId}, ${connector.key}, ${payload.filename},
                  ${payload.bytes.byteLength}, ${sha256}, ${objectRef}, ${payload.encoding},
                  ${payload.sourceTimezone}, ${outcome.objectType}, ${outcome.fingerprint},
                  ${outcome.rowCount}, ${connector.parserVersion})
          ON CONFLICT (connector_key, object_type, sha256) DO NOTHING
        `.execute(uow.tx);

        await stageRecords(uow, connector, runId, landedFileId, outcome, counters);
        await quarantineAll(uow, connector, runId, landedFileId, outcome, counters);
      });
    }

    // A full extract is a statement about what exists. Anything previously seen and
    // now absent is marked deleted in source — never hard-deleted, because it was real
    // and other records reference it.
    if (mode === 'FULL' && presentedObjectTypes.size > 0) {
      await withUnitOfWork(deps.db, context, deps, async (uow) => {
        await markAbsentAsDeleted(
          uow,
          connector,
          runId,
          [...presentedObjectTypes],
          counters,
        );
      });
    }

    const watermarkAfter = connector.watermarkAfter(units, watermarkBefore);
    await finishRun(
      deps,
      context,
      runId,
      'SUCCEEDED',
      counters,
      watermarkAfter,
      undefined,
    );
    return { runId, status: 'SUCCEEDED', counters, haltReason: undefined, filesSkipped };
  } catch (error) {
    const halted = error instanceof SchemaDriftError;
    const reason = error instanceof Error ? error.message : String(error);
    counters.errorCount += 1;
    await finishRun(
      deps,
      context,
      runId,
      halted ? 'HALTED' : 'FAILED',
      counters,
      // The watermark is NOT advanced on failure, so a restart re-processes from the
      // last good point.
      undefined,
      reason,
    );
    if (!halted) throw error;
    return { runId, status: 'HALTED', counters, haltReason: reason, filesSkipped };
  }
}

/**
 * Reconcile the connector row with what the connector code declares.
 *
 * The connector object is the source of truth for its own identity and versions, so
 * there is no second place for them to be written down and drift from. Operational
 * settings a person owns -- whether it is enabled, how stale its data may get -- are
 * deliberately not touched here.
 *
 * A disabled connector refuses to run. Disabling one is how an operator stops a source
 * that is producing bad data, and a scheduler that ran it anyway would make that
 * control decorative.
 */
async function registerConnector(
  deps: PipelineDeps,
  context: RequestContext,
  connector: Connector,
): Promise<void> {
  const result = await withUnitOfWork(deps.db, context, deps, async (uow) => {
    const rows = await sql<{ is_enabled: boolean }>`
      INSERT INTO ingest.connector
        (key, name, description, source_system_code, kind, mapping_version, parser_version)
      VALUES (${connector.key}, ${connector.name},
              ${`Registered from connector code. Object types: ${connector.objectTypes.join(', ')}.`},
              ${connector.sourceSystemCode}, ${connector.kind},
              ${connector.mappingVersion}, ${connector.parserVersion})
      ON CONFLICT (key) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            source_system_code = EXCLUDED.source_system_code,
            kind = EXCLUDED.kind,
            mapping_version = EXCLUDED.mapping_version,
            parser_version = EXCLUDED.parser_version,
            updated_at = now()
      RETURNING is_enabled
    `.execute(uow.tx);
    return rows.rows[0]?.is_enabled ?? true;
  });

  if (!result) {
    throw new Error(
      `Connector '${connector.key}' is disabled. Enable it in ingest.connector to run ` +
        `it; it was not run silently.`,
    );
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot);
}

async function currentWatermark(
  db: Database,
  connectorKey: string,
): Promise<string | undefined> {
  const result = await sql<{ watermark_after: string | null }>`
    SELECT watermark_after FROM ingest.run
     WHERE connector_key = ${connectorKey} AND status = 'SUCCEEDED'
     ORDER BY started_at DESC LIMIT 1
  `.execute(db);
  return result.rows[0]?.watermark_after ?? undefined;
}

/** The identifier of the earlier landing of this exact content, if there is one. */
async function seenBefore(
  db: Database,
  connectorKey: string,
  objectType: string,
  sha256: string,
): Promise<string | undefined> {
  const result = await sql<{ id: string }>`
    SELECT id FROM ingest.landed_file
     WHERE connector_key = ${connectorKey} AND object_type = ${objectType}
       AND sha256 = ${sha256}
     ORDER BY received_at
     LIMIT 1
  `.execute(db);
  return result.rows[0]?.id;
}

/**
 * Mark the records a previously-landed file asserted as seen again.
 *
 * Membership is decided from version history rather than from the source record's
 * current `landed_file_id`, which moves on every change: a record first landed by this
 * file and later updated by another is still a record this file asserts exists.
 */
async function touchRecordsFrom(
  uow: UnitOfWork,
  connector: Connector,
  runId: string,
  landedFileId: string,
): Promise<void> {
  await sql`
    UPDATE ingest.source_record r
       SET last_seen_at = now(), last_seen_run = ${runId}::uuid
     WHERE r.source_system_code = ${connector.sourceSystemCode}
       AND EXISTS (
         SELECT 1 FROM ingest.source_record_version v
          WHERE v.source_record_id = r.id AND v.landed_file_id = ${landedFileId}::uuid
       )
  `.execute(uow.tx);
}

/**
 * Compare the observed structure against approved ones (acceptance criterion 15).
 *
 * An unrecognised structure halts the run. Approving one is a deliberate act with an
 * actor attached, because "the export gained a column" is exactly the moment to check
 * whether the column means what its name suggests.
 */
async function ensureStructureApproved(
  deps: PipelineDeps,
  context: RequestContext,
  connector: Connector,
  runId: string,
  outcome: ParseOutcome,
  approveNew: boolean,
): Promise<void> {
  let drift: SchemaDriftError | undefined;

  await withUnitOfWork(deps.db, context, deps, async (uow) => {
    const tx = uow.tx;

    const known = await sql<{
      fingerprint: string;
      columns: string[];
      approved_at: Date | null;
    }>`
    SELECT fingerprint, columns, approved_at FROM ingest.schema_fingerprint
     WHERE connector_key = ${connector.key} AND object_type = ${outcome.objectType}
  `.execute(tx);

    const match = known.rows.find((row) => row.fingerprint === outcome.fingerprint);
    if (match !== undefined && match.approved_at !== null) return;

    const approved = known.rows.filter((row) => row.approved_at !== null);
    const changeSummary = summariseStructureChange(
      approved.flatMap((row) => row.columns),
      outcome.columns,
      approved.length === 0,
    );

    if (match === undefined) {
      await sql`
      INSERT INTO ingest.schema_fingerprint
        (connector_key, object_type, fingerprint, columns, first_seen_run,
         change_summary, approved_at, approved_by)
      VALUES (${connector.key}, ${outcome.objectType}, ${outcome.fingerprint},
              ${[...outcome.columns]}::text[], ${runId}, ${changeSummary},
              ${approveNew ? sql`now()` : null},
              ${approveNew ? (context.actor.principalId ?? null) : null}::uuid)
      ON CONFLICT (connector_key, object_type, fingerprint) DO NOTHING
    `.execute(tx);
    } else if (approveNew) {
      await sql`
      UPDATE ingest.schema_fingerprint
         SET approved_at = now(), approved_by = ${context.actor.principalId ?? null}::uuid
       WHERE connector_key = ${connector.key} AND object_type = ${outcome.objectType}
         AND fingerprint = ${outcome.fingerprint}
    `.execute(tx);
    }

    if (approveNew) return;

    uow.emit(
      SchemaDriftDetected,
      {
        connectorKey: connector.key,
        objectType: outcome.objectType,
        fingerprint: outcome.fingerprint,
        changeSummary,
        columnCount: outcome.columns.length,
      },
      { aggregateId: runId },
    );

    drift = new SchemaDriftError({
      connectorKey: connector.key,
      objectType: outcome.objectType,
      fingerprint: outcome.fingerprint,
      columns: outcome.columns,
      changeSummary,
    });
  });

  // Thrown after the recording transaction has committed, so the observed structure
  // and the drift event both survive the halt.
  if (drift !== undefined) throw drift;
}

function summariseStructureChange(
  approvedColumns: readonly string[],
  observed: readonly string[],
  firstEver: boolean,
): string {
  if (firstEver) {
    return `No structure has been approved for this object type yet (${observed.length} columns observed).`;
  }
  const approvedSet = new Set(approvedColumns.map((c) => c.toLowerCase()));
  const observedSet = new Set(observed.map((c) => c.toLowerCase()));
  const added = observed.filter((c) => !approvedSet.has(c.toLowerCase()));
  const removed = [...approvedSet].filter((c) => !observedSet.has(c));
  const parts: string[] = [];
  if (added.length > 0) parts.push(`Added: ${added.join(', ')}.`);
  if (removed.length > 0) parts.push(`Removed: ${removed.join(', ')}.`);
  if (parts.length === 0)
    parts.push('The column set matches but the structure hash does not.');
  return parts.join(' ');
}

/**
 * Stage records: upsert the source record, append a version when the payload changed,
 * and count what happened. Nothing canonical is written here.
 */
async function stageRecords(
  uow: UnitOfWork,
  connector: Connector,
  runId: string,
  landedFileId: string,
  outcome: ParseOutcome,
  counters: RunCounters,
): Promise<void> {
  const tx = uow.tx;

  // Duplicated identifiers are found before anything is staged, so that EVERY row
  // sharing one is quarantined. Processing in order and rejecting only the later
  // arrivals would still pick a winner -- the first one -- and would do it silently.
  const occurrences = new Map<string, number>();
  for (const record of outcome.records) {
    occurrences.set(record.sourceId, (occurrences.get(record.sourceId) ?? 0) + 1);
  }
  const duplicated = new Set(
    [...occurrences].filter(([, count]) => count > 1).map(([sourceId]) => sourceId),
  );

  for (const record of outcome.records) {
    if (duplicated.has(record.sourceId)) {
      // Ambiguous. Any existing record keeps the value it already had: an export that
      // says two different things about one identifier is not evidence for either.
      counters.rejected += 1;
      await insertQuarantine(uow, {
        runId,
        connectorKey: connector.key,
        sourceSystemCode: connector.sourceSystemCode,
        objectType: outcome.objectType,
        sourceId: record.sourceId,
        category: 'DUPLICATE_KEY',
        messages: [
          `Identifier '${record.sourceId}' appears ` +
            `${occurrences.get(record.sourceId) ?? 2} times in this file with ` +
            `differing content. Every one of them is quarantined rather than one ` +
            `silently winning; resolve which is correct at the source.`,
        ],
        raw: record.payload,
        rowNumber: record.rowNumber,
        landedFileId,
      });
      continue;
    }

    const payloadHash = hashPayload(record.payload);

    const existing = await sql<{ id: string; payload_hash: string }>`
      SELECT id, payload_hash FROM ingest.source_record
       WHERE source_system_code = ${connector.sourceSystemCode}
         AND object_type = ${outcome.objectType}
         AND source_id = ${record.sourceId}
    `.execute(tx);

    const previous = existing.rows[0];

    if (previous === undefined) {
      const sourceRecordId = uow.ids.next();
      await sql`
        INSERT INTO ingest.source_record
          (id, source_system_code, object_type, source_id, first_seen_run, last_seen_run,
           source_updated_at, payload, payload_hash, mapping_version, parser_version,
           landed_file_id, deleted_in_source_at)
        VALUES (${sourceRecordId}, ${connector.sourceSystemCode}, ${outcome.objectType},
                ${record.sourceId}, ${runId}, ${runId},
                ${record.sourceUpdatedAt ?? null}::timestamptz,
                ${JSON.stringify(record.payload)}::jsonb, ${payloadHash},
                ${connector.mappingVersion}, ${connector.parserVersion}, ${landedFileId},
                ${record.deletedInSource === true ? sql`now()` : null})
      `.execute(tx);
      await appendVersion(tx, sourceRecordId, runId, record, payloadHash, landedFileId);
      emitSourceRecordChanged(uow, connector, outcome, sourceRecordId, record, 'ADDED');
      counters.added += 1;
      continue;
    }

    if (previous.payload_hash === payloadHash && record.deletedInSource !== true) {
      // Seen before, unchanged. Touch last_seen so absence detection and staleness
      // metrics stay honest, but write no version.
      await sql`
        UPDATE ingest.source_record
           SET last_seen_at = now(), last_seen_run = ${runId}, deleted_in_source_at = NULL
         WHERE id = ${previous.id}::uuid
      `.execute(tx);
      counters.unchanged += 1;
      continue;
    }

    await sql`
      UPDATE ingest.source_record
         SET payload = ${JSON.stringify(record.payload)}::jsonb,
             payload_hash = ${payloadHash},
             source_updated_at = ${record.sourceUpdatedAt ?? null}::timestamptz,
             last_seen_at = now(),
             last_seen_run = ${runId},
             landed_file_id = ${landedFileId}::uuid,
             mapping_version = ${connector.mappingVersion},
             parser_version = ${connector.parserVersion},
             mapping_status = CASE WHEN mapping_status = 'MAPPED' THEN 'UNMAPPED'
                                   ELSE mapping_status END,
             deleted_in_source_at = ${record.deletedInSource === true ? sql`now()` : null}
       WHERE id = ${previous.id}::uuid
    `.execute(tx);
    await appendVersion(tx, previous.id, runId, record, payloadHash, landedFileId);
    emitSourceRecordChanged(
      uow,
      connector,
      outcome,
      previous.id,
      record,
      record.deletedInSource === true ? 'DELETED_IN_SOURCE' : 'CHANGED',
    );
    counters.changed += 1;
  }
}

function emitSourceRecordChanged(
  uow: UnitOfWork,
  connector: Connector,
  outcome: ParseOutcome,
  sourceRecordId: string,
  record: ParsedRecord,
  change: 'ADDED' | 'CHANGED' | 'DELETED_IN_SOURCE',
): void {
  uow.emit(
    SourceRecordChanged,
    {
      sourceRecordId,
      sourceSystemCode: connector.sourceSystemCode,
      objectType: outcome.objectType,
      sourceId: record.sourceId,
      change,
    },
    { aggregateId: sourceRecordId },
  );
}

async function appendVersion(
  tx: DbTransaction,
  sourceRecordId: string,
  runId: string,
  record: ParsedRecord,
  payloadHash: string,
  landedFileId: string,
): Promise<void> {
  await sql`
    INSERT INTO ingest.source_record_version
      (source_record_id, run_id, payload, payload_hash, source_updated_at, landed_file_id)
    VALUES (${sourceRecordId}::uuid, ${runId}::uuid,
            ${JSON.stringify(record.payload)}::jsonb, ${payloadHash},
            ${record.sourceUpdatedAt ?? null}::timestamptz, ${landedFileId}::uuid)
    ON CONFLICT DO NOTHING
  `.execute(tx);
}

async function quarantineAll(
  uow: UnitOfWork,
  connector: Connector,
  runId: string,
  landedFileId: string,
  outcome: ParseOutcome,
  counters: RunCounters,
): Promise<void> {
  for (const reject of outcome.rejects) {
    counters.rejected += 1;
    await insertQuarantine(uow, {
      runId,
      connectorKey: connector.key,
      sourceSystemCode: connector.sourceSystemCode,
      objectType: outcome.objectType,
      sourceId: reject.sourceId,
      category: reject.category,
      messages: reject.messages,
      raw: reject.raw,
      rowNumber: reject.rowNumber,
      attemptedMapping: reject.attemptedMapping,
      landedFileId,
    });
  }
}

interface QuarantineInput {
  runId: string;
  connectorKey: string;
  sourceSystemCode: string;
  objectType: string;
  sourceId: string | undefined;
  category: RejectedRecord['category'];
  messages: readonly string[];
  raw: unknown;
  rowNumber?: number | undefined;
  attemptedMapping?: unknown;
  landedFileId: string;
}

async function insertQuarantine(uow: UnitOfWork, input: QuarantineInput): Promise<void> {
  const quarantineId = uow.ids.next();
  await sql`
    INSERT INTO ingest.quarantine
      (id, run_id, connector_key, source_system_code, object_type, source_id,
       failure_category, messages, raw, attempted_mapping, row_number, landed_file_id)
    VALUES (${quarantineId}::uuid, ${input.runId}::uuid, ${input.connectorKey},
            ${input.sourceSystemCode},
            ${input.objectType}, ${input.sourceId ?? null}, ${input.category},
            ${JSON.stringify(input.messages)}::jsonb,
            ${JSON.stringify(input.raw ?? null)}::jsonb,
            ${input.attemptedMapping === undefined ? null : JSON.stringify(input.attemptedMapping)}::jsonb,
            ${input.rowNumber ?? null}, ${input.landedFileId}::uuid)
  `.execute(uow.tx);

  // Identifiers and a category only. The quarantined record itself routinely contains
  // personal data, and this payload is written to an immutable ledger (ADR-0027).
  uow.emit(
    RecordQuarantined,
    {
      quarantineId,
      runId: input.runId,
      connectorKey: input.connectorKey,
      objectType: input.objectType,
      sourceId: input.sourceId ?? null,
      failureCategory: input.category,
    },
    { aggregateId: quarantineId },
  );
}

/**
 * After a full extract, anything previously seen and now absent is marked deleted in
 * source. Never a hard delete: the record existed, and canonical entities point at it.
 */
async function markAbsentAsDeleted(
  uow: UnitOfWork,
  connector: Connector,
  runId: string,
  objectTypes: readonly string[],
  counters: RunCounters,
): Promise<void> {
  if (objectTypes.length === 0) return;

  const result = await sql<{ id: string; object_type: string; source_id: string }>`
    UPDATE ingest.source_record
       SET deleted_in_source_at = now()
     WHERE source_system_code = ${connector.sourceSystemCode}
       AND object_type = ANY(${[...objectTypes]}::text[])
       AND deleted_in_source_at IS NULL
       AND (last_seen_run IS DISTINCT FROM ${runId}::uuid)
    RETURNING id, object_type, source_id
  `.execute(uow.tx);

  for (const row of result.rows) {
    uow.emit(
      SourceRecordChanged,
      {
        sourceRecordId: row.id,
        sourceSystemCode: connector.sourceSystemCode,
        objectType: row.object_type,
        sourceId: row.source_id,
        change: 'DELETED_IN_SOURCE',
      },
      { aggregateId: row.id },
    );
  }

  counters.changed += result.rows.length;
}

async function finishRun(
  deps: PipelineDeps,
  context: RequestContext,
  runId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'HALTED',
  counters: RunCounters,
  watermarkAfter: string | undefined,
  reason: string | undefined,
): Promise<void> {
  await withUnitOfWork(deps.db, context, deps, async (uow) => {
    await sql`
      UPDATE ingest.run
         SET status = ${status}, ended_at = now(), watermark_after = ${watermarkAfter ?? null},
             discovered = ${counters.discovered}, downloaded = ${counters.downloaded},
             added = ${counters.added}, changed = ${counters.changed},
             unchanged = ${counters.unchanged}, rejected = ${counters.rejected},
             matched = ${counters.matched}, needs_review = ${counters.needsReview},
             error_count = ${counters.errorCount}, halt_reason = ${reason ?? null}
       WHERE id = ${runId}::uuid
    `.execute(uow.tx);

    if (status === 'HALTED') {
      uow.emit(RunHalted, { runId, reason: reason ?? 'halted' }, { aggregateId: runId });
    } else {
      uow.emit(
        RunCompleted,
        {
          runId,
          status,
          added: counters.added,
          changed: counters.changed,
          unchanged: counters.unchanged,
          rejected: counters.rejected,
        },
        { aggregateId: runId },
      );
    }
  });
}

// Re-exported so callers do not import event definitions from a deeper path.
export {
  RunStarted,
  RunCompleted,
  RunHalted,
  RecordQuarantined,
  SchemaDriftDetected,
  SourceRecordChanged,
};
