/**
 * Read and validate config/metadata (ADR-0017).
 *
 * Validation happens entirely before the database is touched. A metadata change is a
 * change to the meaning of every value already recorded against it, so "half applied"
 * is not an acceptable state and neither is "applied, then discovered to be wrong".
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { Ajv } from 'ajv';
import type { TSchema } from '@sinclair/typebox';
import {
  AttributesFileSchema,
  ProductTypesFileSchema,
  UnitsFileSchema,
  VocabularyFileSchema,
  type AttributeConfig,
  type DimensionConfig,
  type ProductTypeConfig,
  type UnitConfig,
  type VocabularyConfig,
} from './schema.js';
import {
  parseCondition,
  conditionAttributeKeys,
  type Condition,
} from '../rules/condition.js';
import { normalizeAlias } from '../units/conversion.js';

const ajv = new Ajv({ strict: false, allErrors: true });

export interface ParsedMetadata {
  readonly dimensions: readonly DimensionConfig[];
  readonly units: readonly UnitConfig[];
  readonly vocabularies: readonly VocabularyConfig[];
  readonly attributes: readonly AttributeConfig[];
  readonly productTypes: readonly ProductTypeConfig[];
  /** Parsed conditions, keyed `productTypeKey:attributeKey`. */
  readonly conditions: ReadonlyMap<string, Condition>;
  readonly contentHash: string;
  readonly fileCount: number;
  readonly files: readonly string[];
}

export class MetadataValidationError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      `Metadata configuration is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'MetadataValidationError';
    this.problems = problems;
  }
}

async function yamlFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))
        found.push(full);
    }
  };
  await walk(dir);
  return found.sort();
}

function validateAgainst(
  schema: TSchema,
  value: unknown,
  file: string,
  index: number,
  problems: string[],
): boolean {
  const validate = ajv.compile(schema);
  if (validate(value)) return true;
  for (const error of validate.errors ?? []) {
    problems.push(
      `${file} (document ${index + 1}): ${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
    );
  }
  return false;
}

/**
 * Read every YAML document under `dir`. The document's shape decides what it is --
 * `units`, `terms`, `attributes` or `productTypes` -- so files can be reorganised
 * without a path convention to keep in step.
 */
export async function readMetadata(dir: string): Promise<ParsedMetadata> {
  const files = await yamlFiles(dir);
  const problems: string[] = [];

  const dimensions: DimensionConfig[] = [];
  const units: UnitConfig[] = [];
  const vocabularies: VocabularyConfig[] = [];
  const attributes: AttributeConfig[] = [];
  const productTypes: ProductTypeConfig[] = [];

  const hash = createHash('sha256');

  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    hash.update(`${relative(dir, file)} ${contents} `);

    const documents = parseAllDocuments(contents);
    documents.forEach((document, index) => {
      if (document.errors.length > 0) {
        for (const error of document.errors) {
          problems.push(`${file} (document ${index + 1}): ${error.message}`);
        }
        return;
      }
      const value = document.toJS() as Record<string, unknown> | null;
      if (value === null) return;

      if ('units' in value || 'dimensions' in value) {
        if (validateAgainst(UnitsFileSchema, value, file, index, problems)) {
          const parsed = value as unknown as {
            dimensions: DimensionConfig[];
            units: UnitConfig[];
          };
          dimensions.push(...parsed.dimensions);
          units.push(...parsed.units);
        }
      } else if ('terms' in value) {
        if (validateAgainst(VocabularyFileSchema, value, file, index, problems)) {
          vocabularies.push(value as unknown as VocabularyConfig);
        }
      } else if ('attributes' in value) {
        if (validateAgainst(AttributesFileSchema, value, file, index, problems)) {
          attributes.push(
            ...(value as unknown as { attributes: AttributeConfig[] }).attributes,
          );
        }
      } else if ('productTypes' in value) {
        if (validateAgainst(ProductTypesFileSchema, value, file, index, problems)) {
          productTypes.push(
            ...(value as unknown as { productTypes: ProductTypeConfig[] }).productTypes,
          );
        }
      } else {
        problems.push(
          `${file} (document ${index + 1}): unrecognised metadata document. Expected one ` +
            `of: dimensions/units, terms, attributes, productTypes.`,
        );
      }
    });
  }

  const conditions = new Map<string, Condition>();
  if (problems.length === 0) {
    crossValidate(
      { dimensions, units, vocabularies, attributes, productTypes },
      conditions,
      problems,
    );
  }

  if (problems.length > 0) throw new MetadataValidationError(problems);

  return {
    dimensions,
    units,
    vocabularies,
    attributes,
    productTypes,
    conditions,
    contentHash: hash.digest('hex'),
    fileCount: files.length,
    files: files.map((f) => relative(dir, f)),
  };
}

interface Collections {
  dimensions: DimensionConfig[];
  units: UnitConfig[];
  vocabularies: VocabularyConfig[];
  attributes: AttributeConfig[];
  productTypes: ProductTypeConfig[];
}

function assertUnique(
  values: readonly string[],
  label: string,
  problems: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) problems.push(`duplicate ${label} '${value}'`);
    seen.add(value);
  }
}

/**
 * Everything schema validation cannot express: references resolve, there is exactly
 * one base unit per dimension, designation vocabularies are used only where they
 * belong, conditions parse and refer to attributes the product type actually has.
 */
function crossValidate(
  collections: Collections,
  conditions: Map<string, Condition>,
  problems: string[],
): void {
  const { dimensions, units, vocabularies, attributes, productTypes } = collections;

  const dimensionCodes = new Set(dimensions.map((d) => d.code));
  assertUnique(
    dimensions.map((d) => d.code),
    'dimension',
    problems,
  );
  assertUnique(
    units.map((u) => u.code),
    'unit',
    problems,
  );
  assertUnique(
    vocabularies.map((v) => v.key),
    'vocabulary',
    problems,
  );
  assertUnique(
    attributes.map((a) => a.key),
    'attribute',
    problems,
  );
  assertUnique(
    productTypes.map((p) => p.key),
    'product type',
    problems,
  );

  // --- units -----------------------------------------------------------------
  const baseByDimension = new Map<string, string>();
  const aliasOwner = new Map<string, string>();
  for (const unit of units) {
    if (!dimensionCodes.has(unit.dimension)) {
      problems.push(
        `unit '${unit.code}' references unknown dimension '${unit.dimension}'`,
      );
    }
    if (unit.isBase === true) {
      const existing = baseByDimension.get(unit.dimension);
      if (existing !== undefined) {
        problems.push(
          `dimension '${unit.dimension}' has two base units: '${existing}' and '${unit.code}'`,
        );
      }
      baseByDimension.set(unit.dimension, unit.code);
      if (unit.factorToBase !== '1' || (unit.offsetToBase ?? '0') !== '0') {
        problems.push(
          `base unit '${unit.code}' must have factorToBase 1 and offsetToBase 0`,
        );
      }
    }
    // Codes are matched exactly, so only explicit aliases can be ambiguous.
    for (const alias of unit.aliases ?? []) {
      const normalized = normalizeAlias(alias);
      if (normalized === '') continue;
      const owner = aliasOwner.get(normalized);
      if (owner !== undefined && owner !== unit.code) {
        problems.push(
          `unit alias '${alias}' is ambiguous between '${owner}' and '${unit.code}'`,
        );
      }
      aliasOwner.set(normalized, unit.code);
    }
    for (const alias of unit.aliases ?? []) {
      const clash = units.find((u) => u.code === alias && u.code !== unit.code);
      if (clash !== undefined) {
        problems.push(
          `unit '${unit.code}' declares alias '${alias}', which is the exact code of ` +
            `another unit`,
        );
      }
    }
  }
  for (const dimension of dimensionCodes) {
    if (units.some((u) => u.dimension === dimension) && !baseByDimension.has(dimension)) {
      problems.push(`dimension '${dimension}' has units but no base unit`);
    }
  }

  // --- vocabularies ----------------------------------------------------------
  const vocabularyByKey = new Map(vocabularies.map((v) => [v.key, v]));
  for (const vocabulary of vocabularies) {
    const isDesignation = vocabulary.isDesignation === true;
    if (isDesignation !== (vocabulary.designationKind !== undefined)) {
      problems.push(
        `vocabulary '${vocabulary.key}': isDesignation and designationKind must agree`,
      );
    }
    const codes = new Set<string>();
    for (const term of vocabulary.terms) {
      if (codes.has(term.code)) {
        problems.push(`vocabulary '${vocabulary.key}' has duplicate term '${term.code}'`);
      }
      codes.add(term.code);
      if (
        !isDesignation &&
        (term.sizeSystem !== undefined || term.designation !== undefined)
      ) {
        problems.push(
          `vocabulary '${vocabulary.key}' is not a designation vocabulary, so term ` +
            `'${term.code}' must not carry sizeSystem or designation`,
        );
      }
      for (const alias of term.aliases ?? []) {
        if (alias.assertsEquivalence === false && alias.note === undefined) {
          problems.push(
            `vocabulary '${vocabulary.key}' term '${term.code}': alias '${alias.alias}' does ` +
              `not assert equivalence, so it must carry a note explaining what it does mean`,
          );
        }
      }
    }
    for (const term of vocabulary.terms) {
      if (term.parent !== undefined && !codes.has(term.parent)) {
        problems.push(
          `vocabulary '${vocabulary.key}' term '${term.code}' has unknown parent '${term.parent}'`,
        );
      }
    }
    // A spelling may definitively resolve to at most one term in a vocabulary.
    const definitive = new Map<string, string>();
    for (const term of vocabulary.terms) {
      for (const alias of term.aliases ?? []) {
        if (alias.assertsEquivalence === false) continue;
        const normalized = normalizeAlias(alias.alias);
        const owner = definitive.get(normalized);
        if (owner !== undefined && owner !== term.code) {
          problems.push(
            `vocabulary '${vocabulary.key}': alias '${alias.alias}' definitively maps to both ` +
              `'${owner}' and '${term.code}'. Mark one assertsEquivalence: false with a note.`,
          );
        }
        definitive.set(normalized, term.code);
      }
    }
  }

  // --- attributes ------------------------------------------------------------
  const attributeByKey = new Map(attributes.map((a) => [a.key, a]));
  const unitByCode = new Map(units.map((u) => [u.code, u]));
  for (const attribute of attributes) {
    const isQuantity =
      attribute.valueType === 'QUANTITY' || attribute.valueType === 'QUANTITY_RANGE';
    const isEnumerated =
      attribute.valueType === 'ENUM' ||
      attribute.valueType === 'NOMINAL_SIZE' ||
      attribute.valueType === 'PRESSURE_CLASS';

    if (isQuantity !== (attribute.dimension !== undefined)) {
      problems.push(
        `attribute '${attribute.key}': ${attribute.valueType} ` +
          `${isQuantity ? 'requires' : 'must not declare'} a dimension`,
      );
    }
    if (isEnumerated !== (attribute.vocabulary !== undefined)) {
      problems.push(
        `attribute '${attribute.key}': ${attribute.valueType} ` +
          `${isEnumerated ? 'requires' : 'must not declare'} a vocabulary`,
      );
    }
    if ((attribute.valueType === 'ENTITY_REF') !== (attribute.entityType !== undefined)) {
      problems.push(`attribute '${attribute.key}': ENTITY_REF requires entityType`);
    }
    if (attribute.dimension !== undefined && !dimensionCodes.has(attribute.dimension)) {
      problems.push(
        `attribute '${attribute.key}' references unknown dimension '${attribute.dimension}'`,
      );
    }
    if (attribute.defaultUnit !== undefined) {
      const unit = unitByCode.get(attribute.defaultUnit);
      if (unit === undefined) {
        problems.push(
          `attribute '${attribute.key}' references unknown unit '${attribute.defaultUnit}'`,
        );
      } else if (unit.dimension !== attribute.dimension) {
        problems.push(
          `attribute '${attribute.key}' has dimension '${attribute.dimension ?? 'none'}' but ` +
            `its default unit '${attribute.defaultUnit}' measures '${unit.dimension}'`,
        );
      }
    }
    if (attribute.vocabulary !== undefined) {
      const vocabulary = vocabularyByKey.get(attribute.vocabulary);
      if (vocabulary === undefined) {
        problems.push(
          `attribute '${attribute.key}' references unknown vocabulary '${attribute.vocabulary}'`,
        );
      } else {
        // The heart of ADR-0016. A NOMINAL_SIZE attribute must point at a nominal-size
        // vocabulary, and an ordinary ENUM must never point at a designation
        // vocabulary -- that is how a designation ends up treated as a plain value.
        const required =
          attribute.valueType === 'NOMINAL_SIZE'
            ? 'NOMINAL_SIZE'
            : attribute.valueType === 'PRESSURE_CLASS'
              ? 'PRESSURE_CLASS'
              : undefined;
        if (required !== undefined && vocabulary.designationKind !== required) {
          problems.push(
            `attribute '${attribute.key}' is ${attribute.valueType} so it must use a ` +
              `vocabulary with designationKind '${required}', but '${vocabulary.key}' has ` +
              `'${vocabulary.designationKind ?? 'none'}'`,
          );
        }
        if (attribute.valueType === 'ENUM' && vocabulary.isDesignation === true) {
          problems.push(
            `attribute '${attribute.key}' is ENUM but '${vocabulary.key}' is a designation ` +
              `vocabulary. Use valueType ${vocabulary.designationKind} so the designation ` +
              `cannot be treated as an ordinary value (ADR-0016).`,
          );
        }
      }
    }
    if (
      attribute.supersededBy !== undefined &&
      !attributeByKey.has(attribute.supersededBy)
    ) {
      problems.push(
        `attribute '${attribute.key}' is superseded by unknown attribute ` +
          `'${attribute.supersededBy}'`,
      );
    }
  }

  // --- product types ---------------------------------------------------------
  const productTypeByKey = new Map(productTypes.map((p) => [p.key, p]));
  for (const productType of productTypes) {
    if (productType.parent !== undefined && !productTypeByKey.has(productType.parent)) {
      problems.push(
        `product type '${productType.key}' has unknown parent '${productType.parent}'`,
      );
    }
  }
  for (const productType of productTypes) {
    const seen = new Set<string>();
    let cursor: string | undefined = productType.key;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        problems.push(`product type '${productType.key}' is part of a parent cycle`);
        break;
      }
      seen.add(cursor);
      cursor = productTypeByKey.get(cursor)?.parent;
    }
  }

  /** Attribute keys available to a product type, including inherited ones. */
  const effectiveAttributeKeys = (key: string): Set<string> => {
    const keys = new Set<string>();
    const guard = new Set<string>();
    let cursor: string | undefined = key;
    while (cursor !== undefined && !guard.has(cursor)) {
      guard.add(cursor);
      const type = productTypeByKey.get(cursor);
      for (const entry of type?.attributes ?? []) keys.add(entry.attribute);
      cursor = type?.parent;
    }
    return keys;
  };

  for (const productType of productTypes) {
    const available = effectiveAttributeKeys(productType.key);
    const declared = new Set<string>();
    for (const entry of productType.attributes ?? []) {
      if (declared.has(entry.attribute)) {
        problems.push(
          `product type '${productType.key}' declares attribute '${entry.attribute}' twice`,
        );
      }
      declared.add(entry.attribute);

      if (!attributeByKey.has(entry.attribute)) {
        problems.push(
          `product type '${productType.key}' references unknown attribute '${entry.attribute}'`,
        );
        continue;
      }
      if (entry.condition === undefined) {
        if (entry.conditionNote !== undefined) {
          problems.push(
            `product type '${productType.key}' attribute '${entry.attribute}' has a ` +
              `conditionNote but no condition`,
          );
        }
        continue;
      }
      if (entry.conditionNote === undefined) {
        problems.push(
          `product type '${productType.key}' attribute '${entry.attribute}': a condition must ` +
            `carry a conditionNote explaining, in prose, why the rule exists`,
        );
      }
      try {
        const condition = parseCondition(entry.condition);
        conditions.set(`${productType.key}:${entry.attribute}`, condition);
        for (const referenced of conditionAttributeKeys(condition)) {
          if (!attributeByKey.has(referenced)) {
            problems.push(
              `product type '${productType.key}' attribute '${entry.attribute}': condition ` +
                `references unknown attribute '${referenced}'`,
            );
          } else if (!available.has(referenced)) {
            problems.push(
              `product type '${productType.key}' attribute '${entry.attribute}': condition ` +
                `references '${referenced}', which this product type does not have. A rule ` +
                `that can never fire is a mistake, not a no-op.`,
            );
          }
        }
      } catch (error) {
        problems.push(
          `product type '${productType.key}' attribute '${entry.attribute}': ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
