/** Ingestion module public surface (ADR-0003). */
export { runIngestion } from './pipeline.js';
export type { PipelineDeps, RunOptions } from './pipeline.js';
export { SchemaDriftError } from './types.js';
export type {
  Connector,
  ConnectorKind,
  RunMode,
  RunResult,
  RunCounters,
  SourceUnit,
  SourcePayload,
  ParsedRecord,
  ParseOutcome,
  RejectedRecord,
  FailureCategory,
  DiscoverOptions,
} from './types.js';
export {
  parseDelimited,
  decode,
  structuralFingerprint,
  DelimitedParseError,
} from './delimited.js';
export type {
  DelimitedOptions,
  DelimitedResult,
  DelimitedRow,
  DelimitedProblem,
} from './delimited.js';
export {
  RunStarted,
  RunCompleted,
  RunHalted,
  SchemaDriftDetected,
  RecordQuarantined,
  SourceRecordChanged,
  ingestEvents,
} from './events.js';
