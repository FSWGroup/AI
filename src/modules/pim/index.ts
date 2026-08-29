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

// --- products (Phase 4) ------------------------------------------------------
export {
  AttributeRegistry,
  loadAttributeRegistry,
  UnknownAttributeError,
  UnknownTermError,
} from './products/attribute-registry.js';
export type {
  AttributeDefinition,
  TermReference,
  ValueType,
} from './products/attribute-registry.js';

export {
  prepareValue,
  insertAttributeValue,
  recomputeSelection,
  AttributeValueError,
} from './products/attribute-values.js';
export type {
  AttributeValueInput,
  PreparedValue,
  ValueOwner,
  OwnerLevel,
} from './products/attribute-values.js';

export {
  refreshVariantFacets,
  affectedVariantIds,
  rebuildAllFacets,
  detectFacetDrift,
} from './products/facets.js';
export type { FacetDrift } from './products/facets.js';

export {
  searchVariants,
  facetCounts,
  explainSearch,
  SearchCriterionError,
} from './products/search.js';
export type {
  FilterCriterion,
  SearchOptions,
  SearchResult,
  SearchHit,
  FacetCount,
  PlanShape,
} from './products/search.js';

export { evaluateVariantQuality } from './products/quality.js';
export type { VariantQuality, QualityFinding } from './products/quality.js';

export {
  loadCatalogDeps,
  createBrand,
  createProduct,
  createVariant,
  setAttributeValues,
  setVariantLifecycle,
  resolvedAttributes,
  candidateValues,
} from './products/catalog.js';
export type {
  CatalogDeps,
  CreateProductInput,
  CreateVariantInput,
  AttributeAssignment,
  ResolvedAttribute,
  CandidateValue,
} from './products/catalog.js';

export {
  ProductCreated,
  VariantCreated,
  ProductAttributeValueChanged,
  VariantLifecycleChanged,
  VariantQualityEvaluated,
  pimEvents,
} from './events.js';
