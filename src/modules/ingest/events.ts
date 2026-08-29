/**
 * Ingestion domain events (ADR-0009).
 *
 * These are operational facts a consumer genuinely acts on: a run finished, a source
 * record changed, a structure drifted, a record was quarantined. Payloads carry
 * identifiers and counts — never the source payload itself, which routinely contains
 * personal data (ADR-0027).
 */
import { Type } from '@sinclair/typebox';
import { defineEvent } from '../events/index.js';

export const RunStarted = defineEvent({
  type: 'fsw.ingest.RunStarted',
  version: 1,
  module: 'ingest',
  aggregateType: 'IngestionRun',
  description:
    'An ingestion run began. Useful for tracking freshness and for alerting on runs that never finish.',
  payload: Type.Object(
    {
      runId: Type.String({ format: 'uuid' }),
      connectorKey: Type.String(),
      mode: Type.String(),
      watermarkBefore: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
});

export const RunCompleted = defineEvent({
  type: 'fsw.ingest.RunCompleted',
  version: 1,
  module: 'ingest',
  aggregateType: 'IngestionRun',
  description:
    'An ingestion run finished. The counts are the operational signal: a run that ' +
    'succeeds while rejecting most of its records is not a success anyone should ignore.',
  payload: Type.Object(
    {
      runId: Type.String({ format: 'uuid' }),
      status: Type.String(),
      added: Type.Integer({ minimum: 0 }),
      changed: Type.Integer({ minimum: 0 }),
      unchanged: Type.Integer({ minimum: 0 }),
      rejected: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
});

export const RunHalted = defineEvent({
  type: 'fsw.ingest.RunHalted',
  version: 1,
  module: 'ingest',
  aggregateType: 'IngestionRun',
  description:
    'A run stopped before writing, because continuing would have risked putting data ' +
    'in the wrong place. Requires a human decision, so it is a distinct event from a failure.',
  payload: Type.Object(
    { runId: Type.String({ format: 'uuid' }), reason: Type.String() },
    { additionalProperties: false },
  ),
});

export const SchemaDriftDetected = defineEvent({
  type: 'fsw.ingest.SchemaDriftDetected',
  version: 1,
  module: 'ingest',
  aggregateType: 'Connector',
  description:
    'A source presented a structure nobody has approved. The columns are named so a ' +
    'reviewer can see what changed without opening the file.',
  payload: Type.Object(
    {
      connectorKey: Type.String(),
      objectType: Type.String(),
      fingerprint: Type.String(),
      changeSummary: Type.String(),
      columnCount: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
});

export const RecordQuarantined = defineEvent({
  type: 'fsw.ingest.RecordQuarantined',
  version: 1,
  module: 'ingest',
  aggregateType: 'Quarantine',
  description:
    'A record could not be processed and is waiting for someone to look at it. The ' +
    'payload deliberately carries the category and identifier only: the quarantined ' +
    'record itself often contains personal data (ADR-0027).',
  payload: Type.Object(
    {
      quarantineId: Type.String({ format: 'uuid' }),
      runId: Type.String({ format: 'uuid' }),
      connectorKey: Type.String(),
      objectType: Type.String(),
      sourceId: Type.Union([Type.String(), Type.Null()]),
      failureCategory: Type.String(),
    },
    { additionalProperties: false },
  ),
});

export const SourceRecordChanged = defineEvent({
  type: 'fsw.ingest.SourceRecordChanged',
  version: 1,
  module: 'ingest',
  aggregateType: 'SourceRecord',
  description:
    'A source system changed what it says about a record. Carries identifiers only; a ' +
    'consumer that needs the content reads it through the API.',
  payload: Type.Object(
    {
      sourceRecordId: Type.String({ format: 'uuid' }),
      sourceSystemCode: Type.String(),
      objectType: Type.String(),
      sourceId: Type.String(),
      change: Type.Union([
        Type.Literal('ADDED'),
        Type.Literal('CHANGED'),
        Type.Literal('DELETED_IN_SOURCE'),
      ]),
    },
    { additionalProperties: false },
  ),
});

export const ingestEvents = [
  RunStarted,
  RunCompleted,
  RunHalted,
  SchemaDriftDetected,
  RecordQuarantined,
  SourceRecordChanged,
] as const;
