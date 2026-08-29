/** Audit module public surface (ADR-0003). */
export {
  classifyField,
  classifyFields,
  classifiedFields,
  redactRow,
  changedFields,
  REDACTED,
  ERASED,
} from './classification.js';
export type { Classification, RowSnapshot } from './classification.js';
