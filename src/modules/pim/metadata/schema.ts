/**
 * Shapes of the files in config/metadata (ADR-0017).
 *
 * TypeBox rather than hand-written validation, so the schema that documents the file
 * format is the schema that validates it. `additionalProperties: false` everywhere: a
 * typo in a key must be an error, not a silently ignored setting.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

const MachineKey = Type.String({ pattern: '^[a-z][a-z0-9_]{0,62}$' });
const CodeKey = Type.String({ pattern: '^[A-Z][A-Z0-9_]{0,62}$' });
/** Decimals travel as strings so no value passes through a JavaScript float. */
const DecimalString = Type.String({ pattern: '^-?\\d+(\\.\\d+)?$' });

export const DimensionSchema = Type.Object(
  {
    code: CodeKey,
    name: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const UnitSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 64 }),
    dimension: CodeKey,
    name: Type.String({ minLength: 1 }),
    symbol: Type.String(),
    factorToBase: DecimalString,
    offsetToBase: Type.Optional(DecimalString),
    isBase: Type.Optional(Type.Boolean()),
    sortOrder: Type.Optional(Type.Integer()),
    aliases: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

export const UnitsFileSchema = Type.Object(
  {
    dimensions: Type.Array(DimensionSchema, { minItems: 1 }),
    units: Type.Array(UnitSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const TermAliasSchema = Type.Object(
  {
    alias: Type.String({ minLength: 1 }),
    /**
     * False when the alias normalizes a source spelling without claiming the two are
     * the same engineering thing — CF8M for 316, say. Requires a note explaining why.
     */
    assertsEquivalence: Type.Optional(Type.Boolean()),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    note: Type.Optional(Type.String({ minLength: 1 })),
    sourceSystem: Type.Optional(CodeKey),
  },
  { additionalProperties: false },
);

export const TermSchema = Type.Object(
  {
    code: CodeKey,
    label: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    parent: Type.Optional(CodeKey),
    sortOrdinal: Type.Optional(Type.Number()),
    // Designation metadata; permitted only in a designation vocabulary.
    sizeSystem: Type.Optional(
      Type.Union([
        Type.Literal('NPS'),
        Type.Literal('DN'),
        Type.Literal('OD_TUBE'),
        Type.Literal('JIS'),
        Type.Literal('ISO'),
        Type.Literal('BSP'),
        Type.Literal('NONE'),
      ]),
    ),
    designation: Type.Optional(Type.String({ minLength: 1 })),
    referenceStandard: Type.Optional(Type.String({ minLength: 1 })),
    deprecated: Type.Optional(Type.Boolean()),
    aliases: Type.Optional(Type.Array(TermAliasSchema)),
  },
  { additionalProperties: false },
);

export const VocabularyFileSchema = Type.Object(
  {
    key: MachineKey,
    name: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    isDesignation: Type.Optional(Type.Boolean()),
    designationKind: Type.Optional(
      Type.Union([Type.Literal('NOMINAL_SIZE'), Type.Literal('PRESSURE_CLASS')]),
    ),
    terms: Type.Array(TermSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const VALUE_TYPES = [
  'TEXT',
  'BOOLEAN',
  'INTEGER',
  'DECIMAL',
  'DATE',
  'QUANTITY',
  'QUANTITY_RANGE',
  'ENUM',
  'NOMINAL_SIZE',
  'PRESSURE_CLASS',
  'ENTITY_REF',
] as const;

export const AttributeSchema = Type.Object(
  {
    key: MachineKey,
    name: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    valueType: Type.Union(VALUE_TYPES.map((v) => Type.Literal(v))),
    dimension: Type.Optional(CodeKey),
    defaultUnit: Type.Optional(Type.String({ minLength: 1 })),
    vocabulary: Type.Optional(MachineKey),
    entityType: Type.Optional(Type.String({ minLength: 1 })),
    cardinality: Type.Optional(
      Type.Union([Type.Literal('SINGLE'), Type.Literal('MULTI')]),
    ),
    numericScale: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
    minNumeric: Type.Optional(DecimalString),
    maxNumeric: Type.Optional(DecimalString),
    minLength: Type.Optional(Type.Integer({ minimum: 0 })),
    maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
    isFilterable: Type.Optional(Type.Boolean()),
    isComparable: Type.Optional(Type.Boolean()),
    channels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    deprecated: Type.Optional(Type.Boolean()),
    supersededBy: Type.Optional(MachineKey),
  },
  { additionalProperties: false },
);

export const AttributesFileSchema = Type.Object(
  { attributes: Type.Array(AttributeSchema, { minItems: 1 }) },
  { additionalProperties: false },
);

export const ProductTypeAttributeSchema = Type.Object(
  {
    attribute: MachineKey,
    requirement: Type.Optional(
      Type.Union([
        Type.Literal('REQUIRED'),
        Type.Literal('RECOMMENDED'),
        Type.Literal('OPTIONAL'),
      ]),
    ),
    level: Type.Optional(
      Type.Union([
        Type.Literal('LINE'),
        Type.Literal('FAMILY'),
        Type.Literal('PRODUCT'),
        Type.Literal('VARIANT'),
        Type.Literal('ANY'),
      ]),
    ),
    sortOrder: Type.Optional(Type.Integer()),
    /** FSW condition DSL. Validated by parseCondition, not by this schema. */
    condition: Type.Optional(Type.Unknown()),
    conditionNote: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const ProductTypeSchema = Type.Object(
  {
    key: MachineKey,
    name: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    parent: Type.Optional(MachineKey),
    etimClass: Type.Optional(Type.String({ minLength: 1 })),
    etimRelease: Type.Optional(Type.String({ minLength: 1 })),
    deprecated: Type.Optional(Type.Boolean()),
    attributes: Type.Optional(Type.Array(ProductTypeAttributeSchema)),
  },
  { additionalProperties: false },
);

export const ProductTypesFileSchema = Type.Object(
  { productTypes: Type.Array(ProductTypeSchema, { minItems: 1 }) },
  { additionalProperties: false },
);

/**
 * Quality rules (spec §44). `ruleKind` is restricted to the kinds the evaluator
 * actually implements: storing a kind nothing evaluates would mean a rule that
 * silently passes, which is worse than no rule.
 */
export const IMPLEMENTED_RULE_KINDS = [
  'REQUIRED_ATTRIBUTES',
  'MISSING_IDENTIFIER',
  'NUMERIC_RANGE',
  'INVALID_COMBINATION',
] as const;

export const QualityRuleSchema = Type.Object(
  {
    key: MachineKey,
    name: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    /** Omit to apply to every channel. */
    channel: Type.Optional(CodeKey),
    /** Omit to apply to every product type. */
    productType: Type.Optional(MachineKey),
    severity: Type.Union([Type.Literal('BLOCKING'), Type.Literal('WARNING')]),
    ruleKind: Type.Union(IMPLEMENTED_RULE_KINDS.map((k) => Type.Literal(k))),
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    /** FSW condition DSL: when this rule applies at all. */
    appliesWhen: Type.Optional(Type.Unknown()),
    active: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const QualityRulesFileSchema = Type.Object(
  { qualityRules: Type.Array(QualityRuleSchema, { minItems: 1 }) },
  { additionalProperties: false },
);

export type QualityRuleConfig = Static<typeof QualityRuleSchema>;
export type DimensionConfig = Static<typeof DimensionSchema>;
export type UnitConfig = Static<typeof UnitSchema>;
export type TermAliasConfig = Static<typeof TermAliasSchema>;
export type TermConfig = Static<typeof TermSchema>;
export type VocabularyConfig = Static<typeof VocabularyFileSchema>;
export type AttributeConfig = Static<typeof AttributeSchema>;
export type ProductTypeAttributeConfig = Static<typeof ProductTypeAttributeSchema>;
export type ProductTypeConfig = Static<typeof ProductTypeSchema>;
