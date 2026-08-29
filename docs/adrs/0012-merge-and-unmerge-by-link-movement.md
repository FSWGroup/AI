# ADR-0012: Merge and unmerge move source links; they never rewrite canonical values

- Status: Accepted (provisional)
- Date: 2026-08-29
- Depends on: ADR-0011

## Context

Acceptance criteria 8 and 9 require that two source records resolving to one
organization can be merged and then un-merged, with both source records preserved and
canonical relationships restored correctly. The specification forbids implementing
unmerge by reconstructing state from audit logs.

## Decision

Merging organization `B` into `A` performs exactly these operations:

1. Move every `party.organization_source_link` row from `B` to `A`, recording each move
   in `party.organization_merge_link_move(merge_id, link_id, from_organization_id,
to_organization_id)`.
2. Re-parent `B`'s owned children — sites, commercial accounts, ship-tos, roles,
   affiliations, relationships — recording each move in the same movement ledger.
3. Set `B.merged_into_id = A.id`, `B.lifecycle_status = 'MERGED'`.
4. Recompute survivorship for `A` (ADR-0011). `A`'s canonical column values change
   **only** as a consequence of now having more candidates.
5. Write `party.organization_merge` with actor, reason, score, evidence, and timestamp,
   and emit `fsw.party.OrganizationsMerged`.

Unmerging replays the movement ledger in reverse, clears `merged_into_id`, restores
`B`'s lifecycle status, recomputes survivorship for **both** organizations, marks the
merge record `reversed_at`/`reversed_by`/`reversal_reason`, and emits
`fsw.party.OrganizationMergeReversed`.

Because canonical values were never authored — only derived — recomputation after
reversal reproduces `A`'s and `B`'s pre-merge values exactly, provided no new candidate
arrived in the interim. If new candidates did arrive, the result is the _correct current_
value for each organization, which is the desired behaviour and is not the same as
"restoring a snapshot".

Merged IDs are never deleted and never reused. `GET /v1/organizations/{mergedId}`
returns `301`-style redirect semantics with the surviving ID, so consumers holding an
old ID keep working.

### Guard rails

- Automatic merge only above the configured high-confidence threshold; everything
  between thresholds goes to human review (ADR-0025).
- A merge always requires an actor and a reason, human or service.
- Merge is idempotent by `Idempotency-Key` (ADR-0031); a retried merge request returns
  the original merge record rather than merging twice.
- Chained merges (A←B, then A←C, then unmerge A←B) are supported because each merge has
  its own movement ledger; reversal affects only that merge's moves.

## Alternatives considered

- **Snapshot-and-restore:** store a full copy of `B` before merging. Rejected: it
  restores stale values and silently discards anything learned while merged.
- **Soft-delete `B` and copy its values onto `A`.** The industry's most common
  implementation and the reason most MDM systems cannot unmerge. Rejected.
- **Never merge; only link with a "same-as" relationship.** Genuinely attractive and
  fully reversible, but it pushes the resolution burden onto every consumer, forever.
  Rejected for the canonical spine, though `KNOWN_DIFFERENT` and `SAME_AS` assertions are
  retained as review outcomes.

## Consequences

- The movement ledger is load-bearing. It has its own integration tests, and a
  consistency check that every non-reversed merge's moves are still in place.
- Anything that can be owned by an organization must be enumerated in the merge
  procedure. A new child table is therefore a change to the merge code and its tests —
  enforced by a test that fails when a new table with an `organization_id` foreign key
  is not registered in the merge manifest.

## Risks

An unregistered child table would be silently left behind on merge. Mitigated by the
foreign-key-discovery test described above.

## Reversal cost

High. This shapes the party schema.

## Revisit if

Merges of more than two organizations at once become common enough to need a batch form.
