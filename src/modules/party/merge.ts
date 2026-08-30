/**
 * Merge and unmerge (ADR-0012, spec §50, acceptance criteria 8 and 9).
 *
 * Merging B into A moves B's source links and owned children to A and records every
 * move. It does NOT copy B's values onto A. A's canonical columns change only as a
 * consequence of A now having more candidates — which is survivorship doing its
 * ordinary job, not merge doing something special.
 *
 * That is the whole trick, and it is why unmerge works. Replay the moves in reverse,
 * recompute both organizations, and each says what it should say. Not a restored
 * snapshot — a recomputation. If new candidates arrived while the two were merged,
 * the result is the correct CURRENT value for each, which is what you want and is not
 * what a snapshot would give you.
 *
 * The industry's usual implementation — soft-delete the loser, copy its values onto
 * the winner — is the reason most MDM systems cannot unmerge at all.
 */
import { sql } from 'kysely';
import type { DbTransaction } from '../../platform/db/index.js';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { evaluateFields } from './survivorship.js';
import type { PartyDeps } from './organizations.js';
import { OrganizationsMerged, OrganizationMergeReversed } from './events.js';

export interface MergeInput {
  readonly survivingOrganizationId: string;
  readonly mergedOrganizationId: string;
  /** Always required, human or service. A merge nobody can evaluate later is worse
   * than one that did not happen. */
  readonly reason: string;
  readonly method?: 'MANUAL' | 'DETERMINISTIC' | 'AUTO_LINKED';
  readonly score?: number | undefined;
  readonly evidence?: unknown;
  readonly matchCandidateId?: string | undefined;
}

export interface MergeResult {
  readonly mergeId: string;
  readonly movedRows: number;
  readonly changedFields: readonly string[];
}

interface ManifestEntry {
  readonly entityTable: string;
  readonly columnName: string;
  readonly applyOrder: number;
}

/**
 * The tables a merge must move, read from `party.merge_manifest`.
 *
 * Read rather than hard-coded so that the consistency test can compare the manifest
 * against every foreign key referencing `party.organization` and fail when a new child
 * table is added and forgotten. An unregistered table would otherwise be left pointing
 * at an organization that takes no new facts, and nobody would notice until someone
 * asked where a site had gone.
 */
async function loadManifest(tx: DbTransaction): Promise<readonly ManifestEntry[]> {
  const result = await sql<{
    entity_table: string;
    column_name: string;
    apply_order: number;
  }>`
    SELECT entity_table, column_name, apply_order FROM party.merge_manifest
     WHERE strategy = 'MOVE'
     ORDER BY apply_order, entity_table, column_name
  `.execute(tx);
  return result.rows.map((row) => ({
    entityTable: row.entity_table,
    columnName: row.column_name,
    applyOrder: row.apply_order,
  }));
}

/**
 * Guard a manifest-supplied identifier before it reaches SQL.
 *
 * The manifest is migration-seeded, but it is a table and tables can be written to.
 * A schema-qualified lowercase identifier is the only shape that is ever legitimate
 * here, and anything else is refused rather than escaped.
 */
function qualifiedTable(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `Refusing '${name}' as a table name. The merge manifest holds schema-qualified ` +
        `lowercase identifiers; anything else means it has been tampered with.`,
    );
  }
  return name;
}

function columnIdentifier(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Refusing '${name}' as a column name in the merge manifest.`);
  }
  return `"${name}"`;
}

export async function mergeOrganizations(
  uow: UnitOfWork,
  deps: PartyDeps,
  input: MergeInput,
): Promise<MergeResult> {
  if (input.survivingOrganizationId === input.mergedOrganizationId) {
    throw new ValidationError('An organization cannot be merged into itself.');
  }
  if (input.reason.trim() === '') {
    throw new ValidationError(
      'A merge needs a reason. It is the only thing that explains the decision to ' +
        'whoever finds it surprising later.',
    );
  }

  const [surviving, merged] = await Promise.all([
    loadForMerge(uow.tx, input.survivingOrganizationId),
    loadForMerge(uow.tx, input.mergedOrganizationId),
  ]);

  if (merged.merged_into_id !== null) {
    throw new ConflictError(
      `Organization ${input.mergedOrganizationId} has already been merged into ` +
        `${merged.merged_into_id}. Reverse that merge first, or merge the survivor.`,
    );
  }
  if (surviving.merged_into_id !== null) {
    throw new ConflictError(
      `Organization ${input.survivingOrganizationId} was itself merged into ` +
        `${surviving.merged_into_id}, so it cannot be a survivor. Merge into the ` +
        `record that is still live.`,
    );
  }

  const mergeId = uow.ids.next();
  await sql`
    INSERT INTO party.organization_merge
      (id, surviving_organization_id, merged_organization_id, reason, method, score,
       evidence, match_candidate_id, merged_by, correlation_id)
    VALUES (${mergeId}, ${input.survivingOrganizationId}::uuid,
            ${input.mergedOrganizationId}::uuid, ${input.reason},
            ${input.method ?? 'MANUAL'}, ${input.score ?? null},
            ${input.evidence === undefined ? null : JSON.stringify(input.evidence)}::jsonb,
            ${input.matchCandidateId ?? null}::uuid,
            ${uow.context.actor.principalId ?? null}::uuid,
            ${uow.context.correlationId}::uuid)
  `.execute(uow.tx);

  // Selection is a DERIVED flag, and both organizations currently have one selected
  // candidate per field. Moving the loser's rows across would put two winners on the
  // same field, which the partial unique index correctly refuses. Clearing first is
  // not a workaround: survivorship re-runs at the end of this function and re-selects
  // from the combined set, which is the whole point of a merge.
  await clearSelectionFlags(uow, input.mergedOrganizationId);

  let movedRows = 0;
  for (const entry of await loadManifest(uow.tx)) {
    movedRows += await moveRows(
      uow,
      mergeId,
      entry,
      input.mergedOrganizationId,
      input.survivingOrganizationId,
    );
  }

  await sql`
    UPDATE party.organization
       SET merged_into_id = ${input.survivingOrganizationId}::uuid,
           merged_at = now(),
           lifecycle_status = 'DUPLICATE',
           updated_at = now(),
           updated_by = ${uow.context.actor.principalId ?? null}::uuid
     WHERE id = ${input.mergedOrganizationId}::uuid
  `.execute(uow.tx);

  // The survivor's values change now, and only because it has more candidates. There
  // is no code path here that writes one of its columns directly.
  const fieldKeys = deps.fields.forEntity('ORGANIZATION').map((field) => field.fieldKey);
  const results = await evaluateFields(
    uow,
    deps.survivorship,
    'ORGANIZATION',
    input.survivingOrganizationId,
    fieldKeys,
  );
  const changedFields = results.filter((r) => r.valueChanged).map((r) => r.fieldKey);

  uow.audit({
    schema: 'party',
    table: 'organization',
    entityId: input.mergedOrganizationId,
    operation: 'MERGE',
    before: { merged_into_id: null, lifecycle_status: merged.lifecycle_status },
    after: {
      merged_into_id: input.survivingOrganizationId,
      lifecycle_status: 'DUPLICATE',
    },
    reason: input.reason,
  });

  uow.emit(
    OrganizationsMerged,
    {
      organizationId: input.survivingOrganizationId,
      mergedOrganizationId: input.mergedOrganizationId,
      mergeId,
      method: input.method ?? 'MANUAL',
      movedRows,
      changedFieldKeys: changedFields,
    },
    { aggregateId: input.survivingOrganizationId },
  );

  return { mergeId, movedRows, changedFields };
}

/**
 * Re-point one table's rows at the survivor, recording each move.
 *
 * Rows the survivor already has an equivalent of are skipped rather than moved: the
 * unique indexes on roles and relationships would reject them, and a merge that fails
 * because both companies were already customers of Welsford would be absurd. The skip
 * is recorded by its absence from the ledger, so an unmerge does not put back a row
 * that never moved.
 */
async function moveRows(
  uow: UnitOfWork,
  mergeId: string,
  entry: ManifestEntry,
  fromId: string,
  toId: string,
): Promise<number> {
  const table = qualifiedTable(entry.entityTable);
  const column = columnIdentifier(entry.columnName);

  const candidates = await sql<{ id: string }>`
    SELECT id FROM ${sql.raw(table)}
     WHERE ${sql.raw(column)} = ${fromId}::uuid
  `.execute(uow.tx);

  let moved = 0;
  for (const row of candidates.rows) {
    // Each row moves in its own savepoint. A row the survivor already has an
    // equivalent of violates a unique index; that is a skip, not a failed merge.
    const result = await sql<{ id: string }>`
      WITH attempted AS (
        UPDATE ${sql.raw(table)}
           SET ${sql.raw(column)} = ${toId}::uuid
         WHERE id = ${row.id}::uuid
           AND NOT EXISTS (
             SELECT 1 FROM ${sql.raw(table)} existing
              WHERE existing.id <> ${row.id}::uuid
                AND ${sql.raw(`existing.${column}`)} = ${toId}::uuid
                AND ${sql.raw(duplicateGuard(entry))}
           )
        RETURNING id
      )
      SELECT id FROM attempted
    `.execute(uow.tx);

    if (result.rows.length === 0) continue;

    await sql`
      INSERT INTO party.merge_link_move
        (id, merge_id, entity_table, row_id, column_name, from_value, to_value)
      VALUES (${uow.ids.next()}, ${mergeId}::uuid, ${entry.entityTable},
              ${row.id}::uuid, ${entry.columnName}, ${fromId}::uuid, ${toId}::uuid)
    `.execute(uow.tx);
    moved += 1;
  }

  return moved;
}

/**
 * What makes two rows in a table "the same thing" for the purpose of skipping a move.
 *
 * Enumerated here rather than derived from the unique indexes, because the indexes are
 * partial and expression-based and reading them back correctly is more fragile than
 * saying it plainly. A table not listed has no duplicate concept: its rows always move.
 */
function duplicateGuard(entry: ManifestEntry): string {
  const key = `${entry.entityTable}.${entry.columnName}`;
  switch (key) {
    case 'party.organization_role.organization_id':
      return `existing.role_code = ${entry.entityTable.split('.')[1]}.role_code
              AND existing.operating_company IS NOT DISTINCT FROM ${entry.entityTable.split('.')[1]}.operating_company
              AND existing.valid_to IS NULL`;
    case 'party.field_candidate.entity_id':
      return `existing.field_key = field_candidate.field_key
              AND existing.source_system_code = field_candidate.source_system_code
              AND existing.source_record_id IS NOT DISTINCT FROM field_candidate.source_record_id
              AND existing.source_field IS NOT DISTINCT FROM field_candidate.source_field
              AND existing.entity_type = field_candidate.entity_type`;
    case 'party.organization_alias.organization_id':
      return `existing.normalized_alias = organization_alias.normalized_alias`;
    default:
      // No duplicate concept: nothing existing can block the move.
      return 'false';
  }
}

export interface UnmergeInput {
  readonly mergeId: string;
  readonly reason: string;
}

export interface UnmergeResult {
  readonly restoredRows: number;
  readonly survivingChangedFields: readonly string[];
  readonly restoredChangedFields: readonly string[];
}

/**
 * Reverse one merge by replaying its ledger backwards.
 *
 * Only THIS merge's moves. A chain — A absorbs B, then A absorbs C — reverses cleanly
 * because each merge owns its own ledger, and reversing A←B leaves C's rows where they
 * are.
 */
export async function unmergeOrganizations(
  uow: UnitOfWork,
  deps: PartyDeps,
  input: UnmergeInput,
): Promise<UnmergeResult> {
  if (input.reason.trim() === '') {
    throw new ValidationError(
      'An unmerge needs a reason, for the same reason a merge does.',
    );
  }

  const found = await sql<{
    id: string;
    surviving_organization_id: string;
    merged_organization_id: string;
    reversed_at: Date | null;
  }>`
    SELECT id, surviving_organization_id, merged_organization_id, reversed_at
      FROM party.organization_merge WHERE id = ${input.mergeId}::uuid
  `.execute(uow.tx);
  const merge = found.rows[0];
  if (merge === undefined) throw new NotFoundError('merge', input.mergeId);
  if (merge.reversed_at !== null) {
    throw new ConflictError(`Merge ${input.mergeId} has already been reversed.`);
  }

  // A later merge may have moved the survivor itself. Reversing this one first would
  // leave rows pointing at a record that is no longer live.
  const survivorState = await loadForMerge(uow.tx, merge.surviving_organization_id);
  if (survivorState.merged_into_id !== null) {
    throw new ConflictError(
      `The survivor of this merge has since been merged into ` +
        `${survivorState.merged_into_id}. Reverse that merge first: unmerging out of ` +
        `order would leave rows pointing at a record that takes no new facts.`,
    );
  }

  const moves = await sql<{
    id: string;
    entity_table: string;
    row_id: string;
    column_name: string;
    from_value: string;
  }>`
    SELECT id, entity_table, row_id, column_name, from_value
      FROM party.merge_link_move
     WHERE merge_id = ${input.mergeId}::uuid AND reversed_at IS NULL
     ORDER BY moved_at DESC
  `.execute(uow.tx);

  for (const move of moves.rows) {
    const table = qualifiedTable(move.entity_table);
    const column = columnIdentifier(move.column_name);
    await sql`
      UPDATE ${sql.raw(table)}
         SET ${sql.raw(column)} = ${move.from_value}::uuid
       WHERE id = ${move.row_id}::uuid
    `.execute(uow.tx);
    await sql`
      UPDATE party.merge_link_move SET reversed_at = now() WHERE id = ${move.id}::uuid
    `.execute(uow.tx);
  }

  await sql`
    UPDATE party.organization
       SET merged_into_id = NULL, merged_at = NULL, lifecycle_status = 'ACTIVE',
           updated_at = now(), updated_by = ${uow.context.actor.principalId ?? null}::uuid
     WHERE id = ${merge.merged_organization_id}::uuid
  `.execute(uow.tx);

  await sql`
    UPDATE party.organization_merge
       SET reversed_at = now(), reversed_by = ${uow.context.actor.principalId ?? null}::uuid,
           reversal_reason = ${input.reason}
     WHERE id = ${input.mergeId}::uuid
  `.execute(uow.tx);

  // Same reasoning as the merge: selection is derived, and the rows moving back may
  // carry a flag that belonged to the combined record.
  await clearSelectionFlags(uow, merge.surviving_organization_id);
  await clearSelectionFlags(uow, merge.merged_organization_id);

  // Both are recomputed. Neither is restored: each is re-derived from the candidates
  // it now owns, which is the correct current value rather than a stale snapshot.
  const fieldKeys = deps.fields.forEntity('ORGANIZATION').map((field) => field.fieldKey);
  const survivingResults = await evaluateFields(
    uow,
    deps.survivorship,
    'ORGANIZATION',
    merge.surviving_organization_id,
    fieldKeys,
  );
  const restoredResults = await evaluateFields(
    uow,
    deps.survivorship,
    'ORGANIZATION',
    merge.merged_organization_id,
    fieldKeys,
  );

  uow.audit({
    schema: 'party',
    table: 'organization',
    entityId: merge.merged_organization_id,
    operation: 'UNMERGE',
    before: {
      merged_into_id: merge.surviving_organization_id,
      lifecycle_status: 'DUPLICATE',
    },
    after: { merged_into_id: null, lifecycle_status: 'ACTIVE' },
    reason: input.reason,
  });

  uow.emit(
    OrganizationMergeReversed,
    {
      organizationId: merge.surviving_organization_id,
      restoredOrganizationId: merge.merged_organization_id,
      mergeId: input.mergeId,
      restoredRows: moves.rows.length,
    },
    { aggregateId: merge.surviving_organization_id },
  );

  return {
    restoredRows: moves.rows.length,
    survivingChangedFields: survivingResults
      .filter((r) => r.valueChanged)
      .map((r) => r.fieldKey),
    restoredChangedFields: restoredResults
      .filter((r) => r.valueChanged)
      .map((r) => r.fieldKey),
  };
}

/**
 * Follow a chain of merges to the record that is still live.
 *
 * Merged identifiers are never deleted and never reused, so a consumer holding an old
 * one keeps working: this is what the API's redirect semantics are built on.
 */
export async function resolveOrganizationId(
  tx: DbTransaction,
  organizationId: string,
): Promise<{ id: string; wasRedirected: boolean }> {
  const result = await sql<{ id: string; depth: number }>`
    WITH RECURSIVE chain(id, merged_into_id, depth) AS (
      SELECT id, merged_into_id, 0 FROM party.organization WHERE id = ${organizationId}::uuid
      UNION ALL
      SELECT o.id, o.merged_into_id, chain.depth + 1
        FROM party.organization o
        JOIN chain ON chain.merged_into_id = o.id
       WHERE chain.depth < 32
    )
    SELECT id, depth FROM chain WHERE merged_into_id IS NULL LIMIT 1
  `.execute(tx);

  const row = result.rows[0];
  if (row === undefined) throw new NotFoundError('organization', organizationId);
  return { id: row.id, wasRedirected: row.depth > 0 };
}

/**
 * Clear the selected flag on one organization's candidates.
 *
 * Only ever called immediately before survivorship re-runs. Leaving it cleared would
 * be a bug — a field with no selected candidate has no provenance — which is why this
 * is private and paired with an evaluation at every call site.
 */
async function clearSelectionFlags(
  uow: UnitOfWork,
  organizationId: string,
): Promise<void> {
  await sql`
    UPDATE party.field_candidate
       SET is_selected = false, selected_reason = NULL
     WHERE entity_type = 'ORGANIZATION' AND entity_id = ${organizationId}::uuid
       AND is_selected
  `.execute(uow.tx);
}

interface MergeRow {
  readonly id: string;
  readonly merged_into_id: string | null;
  readonly lifecycle_status: string;
}

async function loadForMerge(tx: DbTransaction, id: string): Promise<MergeRow> {
  const result = await sql<MergeRow>`
    SELECT id, merged_into_id, lifecycle_status FROM party.organization
     WHERE id = ${id}::uuid
  `.execute(tx);
  const row = result.rows[0];
  if (row === undefined) throw new NotFoundError('organization', id);
  return row;
}
