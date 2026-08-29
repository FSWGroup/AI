/** PIM module public surface (ADR-0003). */
export {
  UnitRegistry,
  UnknownUnitError,
  DimensionMismatchError,
  NotAQuantityError,
  roundToScale,
  Decimal,
} from './units/conversion.js';
export type { UnitDefinition, Quantity, DecimalLike } from './units/conversion.js';

export {
  parseCondition,
  evaluateCondition,
  conditionAttributeKeys,
  describeCondition,
  ConditionSyntaxError,
  CONDITION_DSL_VERSION,
} from './rules/condition.js';
export type { Condition, AttributeResolver, ConditionScalar } from './rules/condition.js';

export { readMetadata, MetadataValidationError } from './metadata/reader.js';
export type { ParsedMetadata } from './metadata/reader.js';
export {
  applyMetadata,
  planMetadata,
  BreakingMetadataChangeError,
  DryRunComplete,
} from './metadata/apply.js';
export type {
  MetadataApplyReport,
  MetadataApplyOptions,
  MetadataChange,
} from './metadata/apply.js';
export { loadUnitRegistry } from './units/registry-loader.js';
export { VALUE_TYPES } from './metadata/schema.js';
