/**
 * The catalogue service: the one place a product change goes through.
 *
 * Every write does the whole job inside one transaction — candidate value,
 * survivorship, inheritance, facet projection, quality evaluation, audit and events —
 * because doing part of it is what produces a catalogue that disagrees with itself.
 *
 * The facet refresh being synchronous is the reason a product is filterable the
 * instant its create call returns (acceptance criterion 5). It costs write latency,
 * and that is the trade ADR-0013 makes deliberately.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../../platform/db/index.js';
import type { UnitOfWork } from '../../../kernel/unit-of-work.js';
import {
  PreconditionFailedError,
  NotFoundError,
  ConflictError,
} from '../../../platform/errors.js';
import { loadUnitRegistry } from '../units/registry-loader.js';
import type { UnitRegistry } from '../units/conversion.js';
import { loadAttributeRegistry, type AttributeRegistry } from './attribute-registry.js';
import {
  insertAttributeValue,
  prepareValue,
  recomputeSelection,
  type AttributeValueInput,
  type ValueOwner,
} from './attribute-values.js';
import { affectedVariantIds, refreshVariantFacets } from './facets.js';
import { evaluateVariantQuality } from './quality.js';
import {
  ProductAttributeValueChanged,
  ProductCreated,
  VariantCreated,
  VariantLifecycleChanged,
  VariantQualityEvaluated,
} from '../events.js';

export interface CatalogDeps {
  readonly attributes: AttributeRegistry;
  readonly units: UnitRegistry;
}

/**
 * Load the metadata a catalogue operation needs. Per unit of work rather than cached
 * process-wide: a stale snapshot would let a value be written against a definition
 * that no longer holds.
 */
export async function loadCatalogDeps(
  db: Database | DbTransaction,
): Promise<CatalogDeps> {
  const [attributes, units] = await Promise.all([
    loadAttributeRegistry(db),
    loadUnitRegistry(db),
  ]);
  return { attributes, units };
}

export interface AttributeAssignment {
  readonly attributeKey: string;
  readonly value: unknown;
  readonly ordinal?: number;
  readonly sourceSystemCode?: string;
  readonly sourceRecordId?: string;
  readonly sourceField?: string;
  readonly confidence?: number;
  readonly verificationStatus?: 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED' | 'REJECTED';
  readonly verifiedBy?: string;
  readonly enteredRaw?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
}

export interface CreateProductInput {
  readonly key: string;
  readonly brandKey: string;
  readonly productTypeKey: string;
  readonly name: string;
  readonly modelSeries?: string;
  readonly description?: string;
  readonly familyKey?: string;
  readonly attributes?: readonly AttributeAssignment[];
}

export interface CreateVariantInput {
  readonly productId: string;
  readonly manufacturerPartNumber?: string;
  readonly name?: string;
  readonly description?: string;
  readonly attributes?: readonly AttributeAssignment[];
  readonly identifiers?: readonly {
    namespace: string;
    value: string;
    sourceSystemCode?: string;
  }[];
}

export async function createProduct(
  uow: UnitOfWork,
  input: CreateProductInput,
  deps: CatalogDeps,
): Promise<{ productId: string }> {
  const tx = uow.tx;

  const brand = await sql<{ id: string }>`
    SELECT id FROM pim.brand WHERE key = ${input.brandKey}
  `.execute(tx);
  if (brand.rows.length === 0) throw new NotFoundError('brand', input.brandKey);

  let familyId: string | null = null;
  if (input.familyKey !== undefined) {
    const family = await sql<{ id: string }>`
      SELECT id FROM pim.product_family WHERE key = ${input.familyKey}
    `.execute(tx);
    if (family.rows.length === 0)
      throw new NotFoundError('product family', input.familyKey);
    familyId = family.rows[0]!.id;
  }

  const productId = uow.ids.next();
  await sql`
    INSERT INTO pim.product
      (id, key, brand_id, product_family_id, product_type_key, name, model_series, description)
    VALUES (
      ${productId}, ${input.key}, ${brand.rows[0]!.id}, ${familyId}::uuid,
      ${input.productTypeKey}, ${input.name}, ${input.modelSeries ?? null},
      ${input.description ?? null}
    )
  `.execute(tx);

  uow.audit({
    schema: 'pim',
    table: 'product',
    entityId: productId,
    operation: 'INSERT',
    after: {
      id: productId,
      key: input.key,
      name: input.name,
      product_type_key: input.productTypeKey,
    },
  });
  uow.emit(
    ProductCreated,
    {
      productId,
      key: input.key,
      brandKey: input.brandKey,
      productTypeKey: input.productTypeKey,
      name: input.name,
      ...(input.modelSeries === undefined ? {} : { modelSeries: input.modelSeries }),
    },
    { aggregateId: productId },
  );

  if (input.attributes !== undefined && input.attributes.length > 0) {
    await setAttributeValues(
      uow,
      { level: 'PRODUCT', id: productId },
      input.attributes,
      deps,
    );
  }

  return { productId };
}

export async function createVariant(
  uow: UnitOfWork,
  input: CreateVariantInput,
  deps: CatalogDeps,
): Promise<{ variantId: string }> {
  const tx = uow.tx;

  const product = await sql<{ id: string }>`
    SELECT id FROM pim.product WHERE id = ${input.productId}::uuid AND deleted_at IS NULL
  `.execute(tx);
  if (product.rows.length === 0) throw new NotFoundError('product', input.productId);

  const variantId = uow.ids.next();
  await sql`
    INSERT INTO pim.variant (id, product_id, manufacturer_part_number, name, description)
    VALUES (${variantId}, ${input.productId}::uuid, ${input.manufacturerPartNumber ?? null},
            ${input.name ?? null}, ${input.description ?? null})
  `.execute(tx);

  for (const identifier of input.identifiers ?? []) {
    await sql`
      INSERT INTO pim.product_identifier
        (variant_id, namespace_code, is_global_unique, value, source_system_code)
      SELECT ${variantId}::uuid, n.code, n.is_global_unique, ${identifier.value},
             ${identifier.sourceSystemCode ?? 'MANUAL'}
        FROM pim.identifier_namespace n WHERE n.code = ${identifier.namespace}
    `.execute(tx);
  }

  uow.audit({
    schema: 'pim',
    table: 'variant',
    entityId: variantId,
    operation: 'INSERT',
    after: {
      id: variantId,
      product_id: input.productId,
      manufacturer_part_number: input.manufacturerPartNumber ?? null,
    },
  });
  uow.emit(
    VariantCreated,
    {
      variantId,
      productId: input.productId,
      ...(input.manufacturerPartNumber === undefined
        ? {}
        : { manufacturerPartNumber: input.manufacturerPartNumber }),
    },
    { aggregateId: variantId },
  );

  // Always refresh, even with no attributes of its own: a new variant inherits from
  // its product, family and line, and must be filterable immediately.
  await setAttributeValues(
    uow,
    { level: 'VARIANT', id: variantId },
    input.attributes ?? [],
    deps,
  );

  return { variantId };
}

/**
 * Write candidate values and bring everything downstream back into agreement.
 *
 * Order matters: candidates, then survivorship, then the projection that reads the
 * survivors, then the quality evaluation that reads the projection.
 */
export async function setAttributeValues(
  uow: UnitOfWork,
  owner: ValueOwner,
  assignments: readonly AttributeAssignment[],
  deps: CatalogDeps,
): Promise<{ valueIds: string[]; variantIds: string[] }> {
  const tx = uow.tx;
  const valueIds: string[] = [];
  const touchedAttributes = new Set<string>();

  for (const assignment of assignments) {
    const input: AttributeValueInput = {
      attributeKey: assignment.attributeKey,
      owner,
      value: assignment.value,
      ordinal: assignment.ordinal ?? 0,
      sourceSystemCode: assignment.sourceSystemCode ?? 'MANUAL',
      sourceRecordId: assignment.sourceRecordId,
      sourceField: assignment.sourceField,
      confidence: assignment.confidence,
      verificationStatus: assignment.verificationStatus ?? 'UNVERIFIED',
      verifiedBy: assignment.verifiedBy,
      enteredRaw: assignment.enteredRaw,
      validFrom: assignment.validFrom,
      validTo: assignment.validTo,
    };

    const prepared = prepareValue(input, deps.attributes, deps.units);
    const valueId = await insertAttributeValue(
      tx,
      input,
      prepared,
      deps.attributes,
      uow.context.actor.principalId ?? null,
    );
    valueIds.push(valueId);
    touchedAttributes.add(assignment.attributeKey);

    uow.audit({
      schema: 'pim',
      table: 'attribute_value',
      entityId: valueId,
      operation: 'INSERT',
      after: {
        attribute_key: assignment.attributeKey,
        owner_level: owner.level,
        owner_id: owner.id,
        entered_raw: prepared.enteredRaw,
        source_system_code: input.sourceSystemCode,
      },
    });
  }

  if (touchedAttributes.size > 0) {
    await recomputeSelection(tx, [owner.id], [...touchedAttributes]);

    const selections = await sql<{
      id: string;
      attribute_key: string;
      source_system_code: string;
      is_selected: boolean;
      selected_reason: string | null;
    }>`
      SELECT id, attribute_key, source_system_code, is_selected, selected_reason
        FROM pim.attribute_value
       WHERE id = ANY(${valueIds}::uuid[])
    `.execute(tx);

    for (const row of selections.rows) {
      uow.emit(
        ProductAttributeValueChanged,
        {
          attributeValueId: row.id,
          attributeKey: row.attribute_key,
          ownerLevel: owner.level,
          ownerId: owner.id,
          sourceSystemCode: row.source_system_code,
          selected: row.is_selected,
          ...(row.selected_reason === null
            ? {}
            : { selectedReason: row.selected_reason }),
        },
        { aggregateId: row.id },
      );
    }
  }

  const variantIds = await affectedVariantIds(tx, owner);
  await refreshVariantFacets(tx, variantIds);
  await emitQuality(uow, variantIds);

  return { valueIds, variantIds };
}

async function emitQuality(
  uow: UnitOfWork,
  variantIds: readonly string[],
): Promise<void> {
  const results = await evaluateVariantQuality(uow.tx, variantIds);
  for (const result of results) {
    uow.emit(
      VariantQualityEvaluated,
      {
        variantId: result.variantId,
        channelCode: result.channelCode,
        isPublishable: result.isPublishable,
        blockingCount: result.findings.filter((f) => f.severity === 'BLOCKING').length,
        warningCount: result.findings.filter((f) => f.severity === 'WARNING').length,
        completeness: Number(result.completeness.toFixed(4)),
      },
      { aggregateId: result.variantId },
    );
  }
}

/**
 * Change a variant's manufacturer lifecycle state, with optimistic concurrency.
 *
 * `expectedVersion` is the ETag the client read. A stale value is a 412, never a
 * silent overwrite (ADR-0028, acceptance criterion 25).
 */
export async function setVariantLifecycle(
  uow: UnitOfWork,
  variantId: string,
  status: string,
  expectedVersion: number,
  effectiveFrom?: string,
): Promise<void> {
  const current = await sql<{ lifecycle_status: string; version: number }>`
    SELECT lifecycle_status, version FROM pim.variant
     WHERE id = ${variantId}::uuid AND deleted_at IS NULL
  `.execute(uow.tx);

  const row = current.rows[0];
  if (row === undefined) throw new NotFoundError('variant', variantId);
  if (row.version !== expectedVersion) {
    throw new PreconditionFailedError('variant', String(expectedVersion), row.version);
  }
  if (row.lifecycle_status === status) return;

  await sql`
    UPDATE pim.variant
       SET lifecycle_status = ${status},
           lifecycle_from = COALESCE(${effectiveFrom ?? null}::date, lifecycle_from),
           version = version + 1,
           updated_at = now()
     WHERE id = ${variantId}::uuid
  `.execute(uow.tx);

  uow.audit({
    schema: 'pim',
    table: 'variant',
    entityId: variantId,
    operation: 'UPDATE',
    before: { lifecycle_status: row.lifecycle_status, version: row.version },
    after: { lifecycle_status: status, version: row.version + 1 },
  });
  uow.emit(
    VariantLifecycleChanged,
    {
      variantId,
      from: row.lifecycle_status,
      to: status,
      effectiveFrom:
        effectiveFrom ?? new Date(uow.clock.nowMs()).toISOString().slice(0, 10),
    },
    { aggregateId: variantId },
  );
}

/** Create a brand. Manufacturer identity moves to party.organization in a later phase. */
export async function createBrand(
  uow: UnitOfWork,
  input: { key: string; name: string; description?: string },
): Promise<{ brandId: string }> {
  const existing = await sql`SELECT 1 FROM pim.brand WHERE key = ${input.key}`.execute(
    uow.tx,
  );
  if (existing.rows.length > 0) {
    throw new ConflictError(
      'Brand already exists',
      `A brand with key '${input.key}' exists.`,
    );
  }
  const brandId = uow.ids.next();
  await sql`
    INSERT INTO pim.brand (id, key, name, description)
    VALUES (${brandId}, ${input.key}, ${input.name}, ${input.description ?? null})
  `.execute(uow.tx);
  uow.audit({
    schema: 'pim',
    table: 'brand',
    entityId: brandId,
    operation: 'INSERT',
    after: { id: brandId, key: input.key, name: input.name },
  });
  return { brandId };
}

export interface ResolvedAttribute {
  readonly attributeKey: string;
  readonly attributeName: string;
  readonly valueType: string;
  readonly ordinal: number;
  /** The effective value, rendered for display. */
  readonly display: string;
  readonly termCode: string | null;
  readonly numericBase: string | null;
  readonly originalValue: string | null;
  readonly originalUnit: string | null;
  readonly enteredRaw: string | null;
  /** Which level supplied the value, and where that level got it from. */
  readonly sourceLevel: string;
  readonly sourceSystemCode: string;
  readonly selectedReason: string | null;
  readonly confidence: string;
  readonly verificationStatus: string;
}

/**
 * The resolved effective attributes of a variant, each with its provenance.
 *
 * The API returns both together because spec §27 requires it: a consumer must be able
 * to see the value and where it came from, including which level of the hierarchy
 * supplied it.
 */
export async function resolvedAttributes(
  db: Database | DbTransaction,
  variantId: string,
): Promise<ResolvedAttribute[]> {
  const result = await sql<Record<string, unknown>>`
    SELECT f.attribute_key,
           a.name AS attribute_name,
           av.value_type,
           f.ordinal,
           f.source_level,
           t.code AS term_code,
           t.label AS term_label,
           f.num_value,
           f.num_min,
           f.num_max,
           f.bool_value,
           f.text_value,
           av.value_qty_original,
           av.value_qty_original_unit,
           av.entered_raw,
           av.source_system_code,
           av.selected_reason,
           av.confidence,
           av.verification_status
      FROM pim.variant_facet f
      JOIN pim.attribute_value av ON av.id = f.attribute_value_id
      JOIN pim.attribute a ON a.key = f.attribute_key
      LEFT JOIN pim.vocabulary_term t ON t.id = f.term_id
     WHERE f.variant_id = ${variantId}::uuid
     ORDER BY f.attribute_key, f.ordinal
  `.execute(db);

  return result.rows.map((row) => {
    const display =
      (row['term_label'] as string | null) ??
      (row['value_qty_original'] !== null
        ? `${String(row['value_qty_original'])} ${String(row['value_qty_original_unit'])}`
        : null) ??
      (row['bool_value'] !== null ? String(row['bool_value']) : null) ??
      (row['text_value'] as string | null) ??
      (row['num_value'] !== null ? String(row['num_value']) : null) ??
      '';

    return {
      attributeKey: row['attribute_key'] as string,
      attributeName: row['attribute_name'] as string,
      valueType: row['value_type'] as string,
      ordinal: row['ordinal'] as number,
      display,
      termCode: (row['term_code'] as string | null) ?? null,
      numericBase: (row['num_value'] as string | null) ?? null,
      originalValue: (row['value_qty_original'] as string | null) ?? null,
      originalUnit: (row['value_qty_original_unit'] as string | null) ?? null,
      enteredRaw: (row['entered_raw'] as string | null) ?? null,
      sourceLevel: row['source_level'] as string,
      sourceSystemCode: row['source_system_code'] as string,
      selectedReason: (row['selected_reason'] as string | null) ?? null,
      confidence: String(row['confidence']),
      verificationStatus: row['verification_status'] as string,
    };
  });
}

export interface CandidateValue {
  readonly id: string;
  readonly sourceSystemCode: string;
  readonly enteredRaw: string | null;
  readonly display: string;
  readonly isSelected: boolean;
  readonly selectedReason: string | null;
  readonly confidence: string;
  readonly verificationStatus: string;
  readonly ingestedAt: Date;
}

/**
 * Every candidate for one attribute on one owner, winner first.
 *
 * This is the answer to "why does this field have this value" (spec §11) and the
 * evidence behind acceptance criterion 10: both source values, which won, and why.
 */
export async function candidateValues(
  db: Database | DbTransaction,
  owner: ValueOwner,
  attributeKey: string,
): Promise<CandidateValue[]> {
  const result = await sql<Record<string, unknown>>`
    SELECT av.id, av.source_system_code, av.entered_raw, av.is_selected,
           av.selected_reason, av.confidence, av.verification_status, av.ingested_at,
           t.label AS term_label, av.value_qty_original, av.value_qty_original_unit,
           av.value_text, av.value_numeric, av.value_boolean
      FROM pim.attribute_value av
      LEFT JOIN pim.vocabulary_term t ON t.id = av.value_term_id
     WHERE av.owner_key = ${owner.id} AND av.attribute_key = ${attributeKey}
     ORDER BY av.is_selected DESC, av.ingested_at DESC
  `.execute(db);

  return result.rows.map((row) => ({
    id: row['id'] as string,
    sourceSystemCode: row['source_system_code'] as string,
    enteredRaw: (row['entered_raw'] as string | null) ?? null,
    display:
      (row['term_label'] as string | null) ??
      (row['value_qty_original'] !== null
        ? `${String(row['value_qty_original'])} ${String(row['value_qty_original_unit'])}`
        : null) ??
      (row['value_text'] as string | null) ??
      (row['value_numeric'] !== null ? String(row['value_numeric']) : null) ??
      (row['value_boolean'] !== null ? String(row['value_boolean']) : null) ??
      '',
    isSelected: row['is_selected'] as boolean,
    selectedReason: (row['selected_reason'] as string | null) ?? null,
    confidence: String(row['confidence']),
    verificationStatus: row['verification_status'] as string,
    ingestedAt: row['ingested_at'] as Date,
  }));
}
