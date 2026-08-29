/**
 * PIM domain events (ADR-0009).
 *
 * Meaningful business facts, not row changes: `ProductAttributeValueChanged`, not
 * `DatabaseRowUpdated`. Payloads carry identifiers and non-personal facts only.
 */
import { Type } from '@sinclair/typebox';
import { defineEvent } from '../events/index.js';

const OwnerLevel = Type.Union([
  Type.Literal('LINE'),
  Type.Literal('FAMILY'),
  Type.Literal('PRODUCT'),
  Type.Literal('VARIANT'),
]);

export const ProductCreated = defineEvent({
  type: 'fsw.pim.ProductCreated',
  version: 1,
  module: 'pim',
  aggregateType: 'Product',
  description:
    'A manufacturer model series was added to the catalogue. Consumers that mirror ' +
    'the catalogue should fetch the product and its variants.',
  payload: Type.Object(
    {
      productId: Type.String({ format: 'uuid' }),
      key: Type.String(),
      brandKey: Type.String(),
      productTypeKey: Type.String(),
      name: Type.String(),
      modelSeries: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
});

export const VariantCreated = defineEvent({
  type: 'fsw.pim.VariantCreated',
  version: 1,
  module: 'pim',
  aggregateType: 'Variant',
  description: 'An orderable configuration was added to a product.',
  payload: Type.Object(
    {
      variantId: Type.String({ format: 'uuid' }),
      productId: Type.String({ format: 'uuid' }),
      manufacturerPartNumber: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
});

export const ProductAttributeValueChanged = defineEvent({
  type: 'fsw.pim.ProductAttributeValueChanged',
  version: 1,
  module: 'pim',
  aggregateType: 'AttributeValue',
  description:
    'A source asserted a value for an attribute. `selected` says whether survivorship ' +
    'chose it; a candidate that lost is still a fact worth publishing, because it ' +
    'explains why the canonical value is what it is.',
  payload: Type.Object(
    {
      attributeValueId: Type.String({ format: 'uuid' }),
      attributeKey: Type.String(),
      ownerLevel: OwnerLevel,
      ownerId: Type.String({ format: 'uuid' }),
      sourceSystemCode: Type.String(),
      selected: Type.Boolean(),
      selectedReason: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
});

export const VariantLifecycleChanged = defineEvent({
  type: 'fsw.pim.VariantLifecycleChanged',
  version: 1,
  module: 'pim',
  aggregateType: 'Variant',
  description:
    'A variant moved between manufacturer lifecycle states. Distinct from FSW ' +
    'commercial stocking status, which is a separate concept (spec §42).',
  payload: Type.Object(
    {
      variantId: Type.String({ format: 'uuid' }),
      from: Type.String(),
      to: Type.String(),
      effectiveFrom: Type.String({ format: 'date' }),
    },
    { additionalProperties: false },
  ),
});

export const VariantQualityEvaluated = defineEvent({
  type: 'fsw.pim.VariantQualityEvaluated',
  version: 1,
  module: 'pim',
  aggregateType: 'Variant',
  description:
    'Completeness and publishability were recomputed for a variant on a channel. A ' +
    'channel consumer uses this to know when a product becomes publishable, or stops ' +
    'being.',
  payload: Type.Object(
    {
      variantId: Type.String({ format: 'uuid' }),
      channelCode: Type.String(),
      isPublishable: Type.Boolean(),
      blockingCount: Type.Integer({ minimum: 0 }),
      warningCount: Type.Integer({ minimum: 0 }),
      completeness: Type.Number({ minimum: 0, maximum: 1 }),
    },
    { additionalProperties: false },
  ),
});

export const pimEvents = [
  ProductCreated,
  VariantCreated,
  ProductAttributeValueChanged,
  VariantLifecycleChanged,
  VariantQualityEvaluated,
] as const;
