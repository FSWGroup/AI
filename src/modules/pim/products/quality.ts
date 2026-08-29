/**
 * Data quality as a product feature (spec §44).
 *
 * Completeness is not a report run at month end. It is computed in the same
 * transaction as the change, so "what is incomplete, why, and how many products are
 * affected" is always a query away — and a variant failing a blocking rule is ABSENT
 * from the channel's publishable view rather than flagged within it.
 */
import { sql } from 'kysely';
import type { DbTransaction } from '../../../platform/db/index.js';
import {
  evaluateCondition,
  parseCondition,
  describeCondition,
  type AttributeResolver,
  type ConditionScalar,
} from '../rules/condition.js';

export interface QualityFinding {
  readonly ruleKey: string;
  readonly severity: 'BLOCKING' | 'WARNING';
  readonly attributeKey: string | null;
  readonly message: string;
}

export interface VariantQuality {
  readonly variantId: string;
  readonly channelCode: string;
  readonly isPublishable: boolean;
  readonly completeness: number;
  readonly findings: readonly QualityFinding[];
}

interface ApplicableAttribute {
  readonly attributeKey: string;
  readonly attributeName: string;
  readonly requirement: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  readonly condition: unknown;
  readonly conditionNote: string | null;
}

interface ChannelRule {
  readonly key: string;
  readonly name: string;
  readonly channelCode: string | null;
  readonly productTypeKey: string | null;
  readonly severity: 'BLOCKING' | 'WARNING';
  readonly ruleKind: string;
  readonly parameters: Record<string, unknown>;
  readonly appliesWhen: unknown;
}

/**
 * The effective values of one variant, in the form the condition DSL compares
 * against: term codes for enumerated attributes, normalized base values for
 * quantities, and the scalar itself otherwise.
 */
async function effectiveValues(
  tx: DbTransaction,
  variantIds: readonly string[],
): Promise<Map<string, Map<string, ConditionScalar[]>>> {
  const result = await sql<{
    variant_id: string;
    attribute_key: string;
    value_kind: string;
    num_value: string | null;
    term_code: string | null;
    bool_value: boolean | null;
    text_value: string | null;
  }>`
    SELECT f.variant_id, f.attribute_key, f.value_kind, f.num_value,
           t.code AS term_code, f.bool_value, f.text_value
      FROM pim.variant_facet f
      LEFT JOIN pim.vocabulary_term t ON t.id = f.term_id
     WHERE f.variant_id = ANY(${[...variantIds]}::uuid[])
  `.execute(tx);

  const byVariant = new Map<string, Map<string, ConditionScalar[]>>();
  for (const row of result.rows) {
    let attributes = byVariant.get(row.variant_id);
    if (attributes === undefined) {
      attributes = new Map();
      byVariant.set(row.variant_id, attributes);
    }
    const value: ConditionScalar | undefined =
      row.term_code !== null
        ? row.term_code
        : row.num_value !== null
          ? Number(row.num_value)
          : row.bool_value !== null
            ? row.bool_value
            : (row.text_value ?? undefined);
    if (value === undefined) continue;
    const existing = attributes.get(row.attribute_key);
    if (existing === undefined) attributes.set(row.attribute_key, [value]);
    else existing.push(value);
  }
  return byVariant;
}

/**
 * Attributes that apply to a product type, including everything inherited from its
 * ancestors. A child's declaration of an attribute overrides its parent's.
 */
async function applicableAttributes(
  tx: DbTransaction,
  productTypeKeys: readonly string[],
): Promise<Map<string, ApplicableAttribute[]>> {
  const result = await sql<{
    root_key: string;
    attribute_key: string;
    attribute_name: string;
    requirement: ApplicableAttribute['requirement'];
    condition: unknown;
    condition_note: string | null;
    depth: number;
  }>`
    WITH RECURSIVE ancestry AS (
      SELECT key AS root_key, key, parent_key, 0 AS depth
        FROM pim.product_type
       WHERE key = ANY(${[...productTypeKeys]}::text[])
      UNION ALL
      SELECT a.root_key, pt.key, pt.parent_key, a.depth + 1
        FROM ancestry a
        JOIN pim.product_type pt ON pt.key = a.parent_key
    )
    SELECT DISTINCT ON (a.root_key, pta.attribute_key)
           a.root_key, pta.attribute_key, at.name AS attribute_name,
           pta.requirement, pta.condition, pta.condition_note, a.depth
      FROM ancestry a
      JOIN pim.product_type_attribute pta ON pta.product_type_key = a.key
      JOIN pim.attribute at ON at.key = pta.attribute_key
     WHERE at.deprecated_at IS NULL
     ORDER BY a.root_key, pta.attribute_key, a.depth ASC
  `.execute(tx);

  const byType = new Map<string, ApplicableAttribute[]>();
  for (const row of result.rows) {
    const list = byType.get(row.root_key) ?? [];
    list.push({
      attributeKey: row.attribute_key,
      attributeName: row.attribute_name,
      requirement: row.requirement,
      condition: row.condition,
      conditionNote: row.condition_note,
    });
    byType.set(row.root_key, list);
  }
  return byType;
}

async function activeChannelRules(tx: DbTransaction): Promise<ChannelRule[]> {
  const result = await sql<{
    key: string;
    name: string;
    channel_code: string | null;
    product_type_key: string | null;
    severity: 'BLOCKING' | 'WARNING';
    rule_kind: string;
    parameters: Record<string, unknown>;
    applies_when: unknown;
  }>`
    SELECT key, name, channel_code, product_type_key, severity, rule_kind,
           parameters, applies_when
      FROM pim.quality_rule WHERE is_active
  `.execute(tx);
  return result.rows.map((row) => ({
    key: row.key,
    name: row.name,
    channelCode: row.channel_code,
    productTypeKey: row.product_type_key,
    severity: row.severity,
    ruleKind: row.rule_kind,
    parameters: row.parameters,
    appliesWhen: row.applies_when,
  }));
}

/**
 * Evaluate quality for the given variants across every channel, and persist the
 * result. Called inside the same transaction as the change that prompted it.
 */
export async function evaluateVariantQuality(
  tx: DbTransaction,
  variantIds: readonly string[],
): Promise<VariantQuality[]> {
  if (variantIds.length === 0) return [];

  const variants = await sql<{
    id: string;
    product_type_key: string;
  }>`
    SELECT v.id, p.product_type_key
      FROM pim.variant v JOIN pim.product p ON p.id = v.product_id
     WHERE v.id = ANY(${[...variantIds]}::uuid[]) AND v.deleted_at IS NULL
  `.execute(tx);

  if (variants.rows.length === 0) return [];

  const channels = await sql<{ code: string }>`SELECT code FROM pim.channel`.execute(tx);
  const values = await effectiveValues(tx, variantIds);
  const applicable = await applicableAttributes(tx, [
    ...new Set(variants.rows.map((v) => v.product_type_key)),
  ]);
  const rules = await activeChannelRules(tx);

  const identifiers = await sql<{ variant_id: string; namespace_code: string }>`
    SELECT variant_id, namespace_code FROM pim.product_identifier
     WHERE variant_id = ANY(${[...variantIds]}::uuid[])
  `.execute(tx);
  const identifiersByVariant = new Map<string, Set<string>>();
  for (const row of identifiers.rows) {
    const set = identifiersByVariant.get(row.variant_id) ?? new Set();
    set.add(row.namespace_code);
    identifiersByVariant.set(row.variant_id, set);
  }

  const results: VariantQuality[] = [];

  for (const variant of variants.rows) {
    const variantValues = values.get(variant.id) ?? new Map<string, ConditionScalar[]>();
    const resolve: AttributeResolver = (key) => {
      const list = variantValues.get(key);
      if (list === undefined || list.length === 0) return undefined;
      return list.length === 1 ? list[0] : list;
    };
    const attributesForType = applicable.get(variant.product_type_key) ?? [];

    // Which attributes actually apply to *this* variant, once conditional rules are
    // evaluated against its own values.
    const applies = attributesForType.filter((entry) => {
      if (entry.condition === null || entry.condition === undefined) return true;
      try {
        return evaluateCondition(parseCondition(entry.condition), resolve);
      } catch {
        // A malformed stored rule must not take catalogue-wide validation down with
        // it. The loader validates rules on the way in, so reaching here means the
        // row was written outside that path.
        return false;
      }
    });

    const scored = applies.filter((a) => a.requirement !== 'OPTIONAL');
    const present = scored.filter((a) => resolve(a.attributeKey) !== undefined);
    const completeness = scored.length === 0 ? 1 : present.length / scored.length;

    for (const channel of channels.rows) {
      const findings: QualityFinding[] = [];

      for (const entry of applies) {
        if (entry.requirement === 'OPTIONAL') continue;
        if (resolve(entry.attributeKey) !== undefined) continue;

        const because =
          entry.condition === null || entry.condition === undefined
            ? ''
            : ` It applies here because ${describeCondition(parseCondition(entry.condition))}.`;
        findings.push({
          ruleKey: 'product_type_requirements',
          severity: entry.requirement === 'REQUIRED' ? 'BLOCKING' : 'WARNING',
          attributeKey: entry.attributeKey,
          message:
            `${entry.attributeName} is ${entry.requirement.toLowerCase()} for ` +
            `${variant.product_type_key} and has no value.${because}`,
        });
      }

      for (const rule of rules) {
        // Evaluated inline above, from the product type's own requirements.
        if (rule.ruleKind === 'PRODUCT_TYPE_REQUIREMENTS') continue;
        if (rule.channelCode !== null && rule.channelCode !== channel.code) continue;
        if (
          rule.productTypeKey !== null &&
          rule.productTypeKey !== variant.product_type_key
        ) {
          continue;
        }
        if (rule.appliesWhen !== null && rule.appliesWhen !== undefined) {
          try {
            if (!evaluateCondition(parseCondition(rule.appliesWhen), resolve)) continue;
          } catch {
            continue;
          }
        }
        findings.push(...evaluateRule(rule, variant.id, resolve, identifiersByVariant));
      }

      const blocking = findings.filter((f) => f.severity === 'BLOCKING').length;
      const warnings = findings.length - blocking;

      await sql`
        INSERT INTO pim.variant_quality
          (variant_id, channel_code, evaluated_at, is_publishable, blocking_count,
           warning_count, completeness)
        VALUES (${variant.id}, ${channel.code}, now(), ${blocking === 0}, ${blocking},
                ${warnings}, ${completeness.toFixed(4)}::numeric)
        ON CONFLICT (variant_id, channel_code) DO UPDATE SET
          evaluated_at = now(),
          is_publishable = EXCLUDED.is_publishable,
          blocking_count = EXCLUDED.blocking_count,
          warning_count = EXCLUDED.warning_count,
          completeness = EXCLUDED.completeness
      `.execute(tx);

      await sql`
        DELETE FROM pim.variant_quality_finding
         WHERE variant_id = ${variant.id} AND channel_code = ${channel.code}
      `.execute(tx);

      for (const finding of findings) {
        await sql`
          INSERT INTO pim.variant_quality_finding
            (variant_id, channel_code, rule_key, severity, attribute_key, message)
          VALUES (${variant.id}, ${channel.code}, ${finding.ruleKey}, ${finding.severity},
                  ${finding.attributeKey}, ${finding.message})
        `.execute(tx);
      }

      results.push({
        variantId: variant.id,
        channelCode: channel.code,
        isPublishable: blocking === 0,
        completeness,
        findings,
      });
    }
  }

  return results;
}

function evaluateRule(
  rule: ChannelRule,
  variantId: string,
  resolve: AttributeResolver,
  identifiersByVariant: ReadonlyMap<string, ReadonlySet<string>>,
): QualityFinding[] {
  const findings: QualityFinding[] = [];

  switch (rule.ruleKind) {
    case 'REQUIRED_ATTRIBUTES': {
      const required = (rule.parameters['attributes'] as string[] | undefined) ?? [];
      for (const attributeKey of required) {
        if (resolve(attributeKey) === undefined) {
          findings.push({
            ruleKey: rule.key,
            severity: rule.severity,
            attributeKey,
            message: `${rule.name}: '${attributeKey}' has no value.`,
          });
        }
      }
      return findings;
    }

    case 'MISSING_IDENTIFIER': {
      const namespace = rule.parameters['namespace'] as string | undefined;
      if (namespace === undefined) return findings;
      const held = identifiersByVariant.get(variantId);
      if (held === undefined || !held.has(namespace)) {
        findings.push({
          ruleKey: rule.key,
          severity: rule.severity,
          attributeKey: null,
          message: `${rule.name}: no ${namespace} identifier is recorded.`,
        });
      }
      return findings;
    }

    case 'NUMERIC_RANGE': {
      const attributeKey = rule.parameters['attribute'] as string | undefined;
      if (attributeKey === undefined) return findings;
      const value = resolve(attributeKey);
      if (typeof value !== 'number') return findings;
      const min = rule.parameters['min'] as number | undefined;
      const max = rule.parameters['max'] as number | undefined;
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        findings.push({
          ruleKey: rule.key,
          severity: rule.severity,
          attributeKey,
          message:
            `${rule.name}: ${attributeKey} is ${value}, outside the plausible range ` +
            `${min ?? '-inf'}..${max ?? 'inf'} (normalized units).`,
        });
      }
      return findings;
    }

    case 'INVALID_COMBINATION': {
      // `applies_when` already matched, so reaching here means the combination is
      // present. The rule's whole job is to say so.
      findings.push({
        ruleKey: rule.key,
        severity: rule.severity,
        attributeKey: null,
        message: `${rule.name}: ${(rule.parameters['message'] as string | undefined) ?? 'invalid combination'}`,
      });
      return findings;
    }

    default:
      // MISSING_ASSET and MISSING_CERTIFICATION arrive with the asset and
      // certification phases. An unimplemented kind produces no finding rather than a
      // false pass, and the loader refuses to store a kind this function cannot
      // evaluate.
      return findings;
  }
}
