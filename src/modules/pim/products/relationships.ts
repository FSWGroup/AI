/**
 * Cross-references, equivalents and supersession (spec §40, §41).
 *
 * The distinction that matters, and that this module refuses to blur:
 *
 *   "this will bolt in with identical performance"   EXACT_EQUIVALENT
 *   "this is probably the closest alternative"       CLOSEST_COMPARABLE
 *
 * Both are useful. Treating them as the same thing is how a plant ends up with a valve
 * that fits the pipe and not the application. So the API returns relationships grouped
 * by type with `impliesInterchangeable` on each, and never flattens them into one list.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../../platform/db/index.js';
import type { UnitOfWork } from '../../../kernel/unit-of-work.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors.js';
import { ProductRelationshipAsserted, ProductRelationshipVerified } from '../events.js';

export type SubjectLevel = 'PRODUCT' | 'VARIANT';

export interface RelationshipSubject {
  readonly level: SubjectLevel;
  readonly id: string;
}

export interface AssertRelationshipInput {
  readonly from: RelationshipSubject;
  readonly to: RelationshipSubject;
  readonly relationshipType: string;
  readonly confidence?: number;
  readonly evidence?: string;
  readonly notes?: string;
  readonly sourceSystemCode?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  /** Verifying at assertion time requires evidence, as the database enforces. */
  readonly verify?: { readonly by: string; readonly evidence: string };
}

export interface RelationshipView {
  readonly id: string;
  readonly relationshipType: string;
  readonly typeName: string;
  readonly typeDescription: string;
  /** Whether this type asserts substitution without engineering review. */
  readonly impliesInterchangeable: boolean;
  readonly requiresVerification: boolean;
  readonly direction: 'OUTGOING' | 'INCOMING' | 'SYMMETRIC';
  readonly subject: RelationshipSubject;
  readonly counterpart: RelationshipSubject;
  readonly counterpartName: string;
  readonly counterpartPartNumber: string | null;
  readonly confidence: string;
  readonly verificationStatus: string;
  readonly verifiedAt: Date | null;
  readonly evidence: string | null;
  readonly notes: string | null;
  readonly validFrom: Date;
  readonly validTo: Date | null;
  /**
   * True only where the relationship both asserts interchangeability AND has been
   * verified. A consumer that shows one substitution button should use this, not the
   * type alone.
   */
  readonly safeToSubstitute: boolean;
}

function columnsFor(
  subject: RelationshipSubject,
  prefix: 'from' | 'to',
): {
  productColumn: string;
  variantColumn: string;
} {
  return subject.level === 'PRODUCT'
    ? { productColumn: `${prefix}_product_id`, variantColumn: `${prefix}_variant_id` }
    : { productColumn: `${prefix}_product_id`, variantColumn: `${prefix}_variant_id` };
}

export async function assertRelationship(
  uow: UnitOfWork,
  input: AssertRelationshipInput,
): Promise<{ relationshipId: string }> {
  const tx = uow.tx;

  const type = await sql<{
    code: string;
    is_symmetric: boolean;
    requires_verification: boolean;
    implies_interchangeable: boolean;
  }>`
    SELECT code, is_symmetric, requires_verification, implies_interchangeable
      FROM pim.relationship_type WHERE code = ${input.relationshipType}
  `.execute(tx);
  if (type.rows.length === 0) {
    throw new NotFoundError('relationship type', input.relationshipType);
  }
  if (type.rows[0]!.requires_verification && input.verify === undefined) {
    throw new ValidationError(
      `Relationship type '${input.relationshipType}' asserts interchangeability, so it ` +
        `must be verified by a named person with stated evidence when it is created.`,
    );
  }

  await assertSubjectExists(tx, input.from);
  await assertSubjectExists(tx, input.to);

  const fromColumns = columnsFor(input.from, 'from');
  const toColumns = columnsFor(input.to, 'to');
  const relationshipId = uow.ids.next();

  try {
    await sql`
      INSERT INTO pim.product_relationship (
        id,
        ${sql.raw(fromColumns.productColumn)}, ${sql.raw(fromColumns.variantColumn)},
        ${sql.raw(toColumns.productColumn)}, ${sql.raw(toColumns.variantColumn)},
        relationship_type, confidence, evidence, notes, source_system_code,
        created_by, valid_from, valid_to,
        verification_status, verified_by, verified_at
      ) VALUES (
        ${relationshipId},
        ${input.from.level === 'PRODUCT' ? input.from.id : null}::uuid,
        ${input.from.level === 'VARIANT' ? input.from.id : null}::uuid,
        ${input.to.level === 'PRODUCT' ? input.to.id : null}::uuid,
        ${input.to.level === 'VARIANT' ? input.to.id : null}::uuid,
        ${input.relationshipType}, ${input.confidence ?? 0.5}::numeric,
        ${input.verify?.evidence ?? input.evidence ?? null}, ${input.notes ?? null},
        ${input.sourceSystemCode ?? 'MANUAL'}, ${uow.context.actor.principalId ?? null}::uuid,
        ${input.validFrom ?? sql`CURRENT_DATE`}::date, ${input.validTo ?? null}::date,
        ${input.verify === undefined ? 'UNVERIFIED' : 'VERIFIED'},
        ${input.verify?.by ?? null}::uuid,
        ${input.verify === undefined ? null : sql`now()`}
      )
    `.execute(tx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cycle/i.test(message)) {
      throw new ConflictError('Supersession would create a cycle', message);
    }
    if (/one_relationship_per_type_and_period/.test(message)) {
      throw new ConflictError(
        'Relationship already exists',
        `A ${input.relationshipType} relationship between these two already covers this period.`,
      );
    }
    throw error;
  }

  uow.audit({
    schema: 'pim',
    table: 'product_relationship',
    entityId: relationshipId,
    operation: 'INSERT',
    after: {
      relationship_type: input.relationshipType,
      from: input.from.id,
      to: input.to.id,
      confidence: input.confidence ?? 0.5,
    },
  });

  uow.emit(
    ProductRelationshipAsserted,
    {
      relationshipId,
      relationshipType: input.relationshipType,
      fromLevel: input.from.level,
      fromId: input.from.id,
      toLevel: input.to.level,
      toId: input.to.id,
      confidence: input.confidence ?? 0.5,
      verified: input.verify !== undefined,
      impliesInterchangeable: type.rows[0]!.implies_interchangeable,
    },
    { aggregateId: relationshipId },
  );

  return { relationshipId };
}

async function assertSubjectExists(
  tx: DbTransaction,
  subject: RelationshipSubject,
): Promise<void> {
  const table = subject.level === 'PRODUCT' ? 'pim.product' : 'pim.variant';
  const found = await sql`
    SELECT 1 FROM ${sql.raw(table)} WHERE id = ${subject.id}::uuid AND deleted_at IS NULL
  `.execute(tx);
  if (found.rows.length === 0) {
    throw new NotFoundError(subject.level.toLowerCase(), subject.id);
  }
}

/** Record that a person has reviewed a relationship and stands behind it. */
export async function verifyRelationship(
  uow: UnitOfWork,
  relationshipId: string,
  verification: { by: string; evidence: string; confidence?: number },
): Promise<void> {
  const existing = await sql<{ verification_status: string; relationship_type: string }>`
    SELECT verification_status, relationship_type FROM pim.product_relationship
     WHERE id = ${relationshipId}::uuid
  `.execute(uow.tx);
  if (existing.rows.length === 0) throw new NotFoundError('relationship', relationshipId);

  await sql`
    UPDATE pim.product_relationship
       SET verification_status = 'VERIFIED',
           verified_by = ${verification.by}::uuid,
           verified_at = now(),
           evidence = ${verification.evidence},
           confidence = COALESCE(${verification.confidence ?? null}::numeric, confidence)
     WHERE id = ${relationshipId}::uuid
  `.execute(uow.tx);

  uow.audit({
    schema: 'pim',
    table: 'product_relationship',
    entityId: relationshipId,
    operation: 'UPDATE',
    before: { verification_status: existing.rows[0]!.verification_status },
    after: { verification_status: 'VERIFIED', evidence: verification.evidence },
  });
  uow.emit(
    ProductRelationshipVerified,
    {
      relationshipId,
      relationshipType: existing.rows[0]!.relationship_type,
      verifiedBy: verification.by,
    },
    { aggregateId: relationshipId },
  );
}

/**
 * Every relationship touching a subject, grouped by type and direction.
 *
 * Symmetric types (EXACT_EQUIVALENT) are returned from either end. Directional types
 * are returned with their direction, because "supersedes" and "is superseded by" are
 * opposite facts and confusing them is worse than omitting them.
 */
export async function relationshipsFor(
  db: Database | DbTransaction,
  subject: RelationshipSubject,
  options: { asOf?: string; includeExpired?: boolean } = {},
): Promise<RelationshipView[]> {
  const asOf = options.asOf ?? null;
  const includeExpired = options.includeExpired ?? false;

  const result = await sql<Record<string, unknown>>`
    WITH relevant AS (
      SELECT r.*, rt.name AS type_name, rt.description AS type_description,
             rt.is_symmetric, rt.implies_interchangeable, rt.requires_verification,
             rt.sort_order,
             CASE WHEN rt.is_symmetric THEN 'SYMMETRIC'
                  WHEN r.from_key = ${subject.id} THEN 'OUTGOING'
                  ELSE 'INCOMING' END AS direction,
             CASE WHEN r.from_key = ${subject.id} THEN r.to_key ELSE r.from_key END
               AS counterpart_key,
             CASE WHEN r.from_key = ${subject.id} THEN r.to_level ELSE r.from_level END
               AS counterpart_level
        FROM pim.product_relationship r
        JOIN pim.relationship_type rt ON rt.code = r.relationship_type
       WHERE (r.from_key = ${subject.id} OR r.to_key = ${subject.id})
         AND r.verification_status <> 'REJECTED'
         AND (${includeExpired}
              OR r.validity @> COALESCE(${asOf}::date, CURRENT_DATE))
    )
    SELECT rel.*,
           COALESCE(v.name, p.name, pv.name) AS counterpart_name,
           v.manufacturer_part_number AS counterpart_part_number
      FROM relevant rel
      LEFT JOIN pim.variant v ON v.id::text = rel.counterpart_key
      LEFT JOIN pim.product p ON p.id::text = rel.counterpart_key
      LEFT JOIN pim.product pv ON pv.id = v.product_id
     ORDER BY rel.sort_order, rel.confidence DESC
  `.execute(db);

  return result.rows.map((row) => {
    const verificationStatus = row['verification_status'] as string;
    const impliesInterchangeable = row['implies_interchangeable'] as boolean;
    return {
      id: row['id'] as string,
      relationshipType: row['relationship_type'] as string,
      typeName: row['type_name'] as string,
      typeDescription: row['type_description'] as string,
      impliesInterchangeable,
      requiresVerification: row['requires_verification'] as boolean,
      direction: row['direction'] as RelationshipView['direction'],
      subject,
      counterpart: {
        level: row['counterpart_level'] as SubjectLevel,
        id: row['counterpart_key'] as string,
      },
      counterpartName: (row['counterpart_name'] as string | null) ?? '',
      counterpartPartNumber: (row['counterpart_part_number'] as string | null) ?? null,
      confidence: String(row['confidence']),
      verificationStatus,
      verifiedAt: (row['verified_at'] as Date | null) ?? null,
      evidence: (row['evidence'] as string | null) ?? null,
      notes: (row['notes'] as string | null) ?? null,
      validFrom: row['valid_from'] as Date,
      validTo: (row['valid_to'] as Date | null) ?? null,
      // Both conditions, deliberately. A type that asserts interchangeability is a
      // claim; a verified one is a claim someone stands behind.
      safeToSubstitute: impliesInterchangeable && verificationStatus === 'VERIFIED',
    };
  });
}

export interface SupersessionLink {
  readonly relationshipId: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly toLevel: SubjectLevel;
  readonly toName: string;
  readonly toPartNumber: string | null;
  readonly confidence: string;
  readonly verificationStatus: string;
  readonly evidence: string | null;
  readonly effectiveFrom: Date;
}

export interface SupersessionResolution {
  readonly subject: RelationshipSubject;
  /** The last product in the chain that is not itself superseded. */
  readonly activeSuccessor: SupersessionLink | undefined;
  /** Every hop from the subject to the successor, in order. */
  readonly chain: readonly SupersessionLink[];
  /** The weakest confidence anywhere in the chain: a chain is only as good as its worst link. */
  readonly chainConfidence: string;
  readonly allLinksVerified: boolean;
}

/**
 * Follow A → B → C and return C (acceptance criterion 20).
 *
 * The chain is returned with the successor, because "what replaces this" is a question
 * whose answer a person often needs to check: three hops through three manufacturers,
 * one of them unverified, is a different answer from one verified hop, even though both
 * end at a part number.
 *
 * Cycles are prevented at write time by a constraint trigger, so the recursion is
 * bounded; the depth guard here is belt and braces for data loaded before that trigger
 * existed.
 */
export async function resolveSupersession(
  db: Database | DbTransaction,
  subject: RelationshipSubject,
  options: { asOf?: string; maxDepth?: number } = {},
): Promise<SupersessionResolution> {
  const asOf = options.asOf ?? null;
  const maxDepth = options.maxDepth ?? 32;

  const result = await sql<Record<string, unknown>>`
    WITH RECURSIVE chain AS (
      SELECT r.id, r.from_key, r.to_key, r.to_level, r.confidence,
             r.verification_status, r.evidence, r.valid_from, 1 AS depth,
             ARRAY[r.from_key, r.to_key] AS visited
        FROM pim.product_relationship r
       WHERE r.from_key = ${subject.id}
         AND r.relationship_type = 'SUPERSEDED_BY'
         AND r.verification_status <> 'REJECTED'
         AND r.validity @> COALESCE(${asOf}::date, CURRENT_DATE)
      UNION ALL
      SELECT r.id, r.from_key, r.to_key, r.to_level, r.confidence,
             r.verification_status, r.evidence, r.valid_from, c.depth + 1,
             c.visited || r.to_key
        FROM chain c
        JOIN pim.product_relationship r ON r.from_key = c.to_key
       WHERE r.relationship_type = 'SUPERSEDED_BY'
         AND r.verification_status <> 'REJECTED'
         AND r.validity @> COALESCE(${asOf}::date, CURRENT_DATE)
         AND NOT (r.to_key = ANY (c.visited))
         AND c.depth < ${maxDepth}
    )
    SELECT c.id, c.from_key, c.to_key, c.to_level, c.confidence,
           c.verification_status, c.evidence, c.valid_from, c.depth,
           COALESCE(v.name, p.name) AS to_name,
           v.manufacturer_part_number AS to_part_number
      FROM chain c
      LEFT JOIN pim.variant v ON v.id::text = c.to_key
      LEFT JOIN pim.product p ON p.id::text = c.to_key
     ORDER BY c.depth
  `.execute(db);

  const chain: SupersessionLink[] = result.rows.map((row) => ({
    relationshipId: row['id'] as string,
    fromKey: row['from_key'] as string,
    toKey: row['to_key'] as string,
    toLevel: row['to_level'] as SubjectLevel,
    toName: (row['to_name'] as string | null) ?? '',
    toPartNumber: (row['to_part_number'] as string | null) ?? null,
    confidence: String(row['confidence']),
    verificationStatus: row['verification_status'] as string,
    evidence: (row['evidence'] as string | null) ?? null,
    effectiveFrom: row['valid_from'] as Date,
  }));

  const chainConfidence =
    chain.length === 0
      ? '1.00'
      : chain.reduce(
          (worst, link) =>
            Number(link.confidence) < Number(worst) ? link.confidence : worst,
          chain[0]!.confidence,
        );

  return {
    subject,
    activeSuccessor: chain[chain.length - 1],
    chain,
    chainConfidence,
    allLinksVerified:
      chain.length > 0 && chain.every((link) => link.verificationStatus === 'VERIFIED'),
  };
}

export interface CertificationInput {
  readonly subject: RelationshipSubject;
  readonly certificationCode: string;
  readonly issuingBodyCode?: string;
  readonly standardRevision?: string;
  readonly certificateId?: string;
  readonly scope?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly sourceSystemCode?: string;
  readonly verify?: { readonly by: string };
}

/**
 * Attach a certificate to a specific product or variant.
 *
 * Deliberately not attachable to a family: a certificate covering one size and material
 * configuration does not certify everything built on the same drawing (spec §38).
 */
export async function recordCertification(
  uow: UnitOfWork,
  input: CertificationInput,
): Promise<{ certificationId: string }> {
  const term = await sql<{ id: string }>`
    SELECT id FROM pim.vocabulary_term
     WHERE vocabulary_key = 'certification' AND code = ${input.certificationCode}
  `.execute(uow.tx);
  if (term.rows.length === 0) {
    throw new NotFoundError('certification', input.certificationCode);
  }

  const certificationId = uow.ids.next();
  await sql`
    INSERT INTO pim.product_certification (
      id, product_id, variant_id, certification_term_id, issuing_body_code,
      standard_revision, certificate_id, scope, issued_on, expires_on,
      verification_status, verified_by, verified_at, source_system_code, created_by
    ) VALUES (
      ${certificationId},
      ${input.subject.level === 'PRODUCT' ? input.subject.id : null}::uuid,
      ${input.subject.level === 'VARIANT' ? input.subject.id : null}::uuid,
      ${term.rows[0]!.id}::uuid, ${input.issuingBodyCode ?? null},
      ${input.standardRevision ?? null}, ${input.certificateId ?? null},
      ${input.scope ?? null}, ${input.issuedOn ?? null}::date,
      ${input.expiresOn ?? null}::date,
      ${input.verify === undefined ? 'UNVERIFIED' : 'VERIFIED'},
      ${input.verify?.by ?? null}::uuid,
      ${input.verify === undefined ? null : sql`now()`},
      ${input.sourceSystemCode ?? 'MANUAL'}, ${uow.context.actor.principalId ?? null}::uuid
    )
  `.execute(uow.tx);

  uow.audit({
    schema: 'pim',
    table: 'product_certification',
    entityId: certificationId,
    operation: 'INSERT',
    after: {
      certification: input.certificationCode,
      subject: input.subject.id,
      scope: input.scope ?? null,
    },
  });

  return { certificationId };
}

export interface CertificationView {
  readonly id: string;
  readonly certificationCode: string;
  readonly certificationLabel: string;
  readonly issuingBody: string | null;
  readonly standardRevision: string | null;
  readonly certificateId: string | null;
  readonly scope: string | null;
  readonly issuedOn: Date | null;
  readonly expiresOn: Date | null;
  readonly verificationStatus: string;
  readonly isCurrentlyValid: boolean;
  /** PRODUCT means it was recorded against the model series, not this exact variant. */
  readonly attachedAt: SubjectLevel;
}

export async function certificationsFor(
  db: Database | DbTransaction,
  variantId: string,
): Promise<CertificationView[]> {
  const result = await sql<Record<string, unknown>>`
    SELECT c.id, t.code, t.label, b.name AS body_name, c.standard_revision,
           c.certificate_id, c.scope, c.issued_on, c.expires_on,
           c.verification_status,
           CASE WHEN c.variant_id IS NOT NULL THEN 'VARIANT' ELSE 'PRODUCT' END AS attached_at,
           (c.verification_status IN ('VERIFIED','UNVERIFIED')
            AND (c.expires_on IS NULL OR c.expires_on >= CURRENT_DATE)) AS currently_valid
      FROM pim.product_certification c
      JOIN pim.vocabulary_term t ON t.id = c.certification_term_id
      LEFT JOIN pim.certification_body b ON b.code = c.issuing_body_code
      JOIN pim.variant v ON v.id = ${variantId}::uuid
     WHERE c.variant_id = v.id OR c.product_id = v.product_id
     ORDER BY t.sort_ordinal NULLS LAST, t.code
  `.execute(db);

  return result.rows.map((row) => ({
    id: row['id'] as string,
    certificationCode: row['code'] as string,
    certificationLabel: row['label'] as string,
    issuingBody: (row['body_name'] as string | null) ?? null,
    standardRevision: (row['standard_revision'] as string | null) ?? null,
    certificateId: (row['certificate_id'] as string | null) ?? null,
    scope: (row['scope'] as string | null) ?? null,
    issuedOn: (row['issued_on'] as Date | null) ?? null,
    expiresOn: (row['expires_on'] as Date | null) ?? null,
    verificationStatus: row['verification_status'] as string,
    isCurrentlyValid: row['currently_valid'] as boolean,
    attachedAt: row['attached_at'] as SubjectLevel,
  }));
}
