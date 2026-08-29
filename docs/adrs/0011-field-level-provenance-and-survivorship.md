# ADR-0011: Canonical field values are materialized survivorship outputs

- Status: Accepted (provisional)
- Date: 2026-08-29
- Resolves: specification §11, §51, and the reversibility requirement in §50

## Context

The specification requires field-level provenance ("why does this field have this
value?"), configurable survivorship, preservation of losing candidate values, and fully
reversible merges. These requirements are not independent: **reversible merge is only
achievable if canonical field values are derived rather than authored.**

If merging organization B into A physically overwrites A's columns, then unmerging
requires reconstructing A's prior state from audit logs — which the specification
explicitly forbids as an implementation of unmerge (§50).

## Decision

For every mastered entity, canonical scalar fields are **materialized outputs of a
deterministic survivorship function** over candidate values.

### Shape

- `party.organization_field_candidate` holds one row per (entity, field, source record):
  the value as that source asserts it, plus `source_system_id`, `source_record_id`,
  `source_field`, `source_updated_at`, `ingested_at`, `confidence`,
  `verification_status`, and — after evaluation — `is_selected` and `selected_reason`.
- `party.organization` carries the selected value in a real, typed, indexable,
  foreign-keyable column. It is a cache of the survivorship result, recomputed inside
  the same transaction as any candidate change. It is never written directly.
- The same pattern applies to `party.person`, `party.site`, and `party.location`.
  In PIM, `pim.attribute_value` rows _are_ the candidates and carry `is_selected`
  directly, so no separate candidate table is needed there.

### The consequence that must be stated plainly

**A human editing a value in the admin UI does not update the canonical row.** It writes
a candidate value attributed to the `MANUAL` source system, with a verification stamp,
an actor, and a reason. Survivorship then runs. `MANUAL` normally has the highest
priority, so the human's value normally wins — but it wins _through the same mechanism as
every other source_, which is what keeps merge reversible and provenance complete.

### Rules

`party.survivorship_rule(entity_type, field_key, strategy, prefer_verified,
ignore_null, source_priority[])`, loaded from version-controlled configuration
(ADR-0017). Strategies: `PRIORITY`, `RECENCY`, `PRIORITY_THEN_RECENCY`. Re-evaluation is
a first-class operation: changing a rule and re-running produces a new selection with a
new reason, and no candidate is ever destroyed.

## Alternatives considered

- **Write survivorship results directly to canonical columns and log the reasoning.**
  Simpler, and fails acceptance criteria 9 and 10.
- **Compute survivorship on read (a view).** Perfect provenance, but canonical values
  could not be indexed, foreign-keyed, or constrained, and every read would pay for the
  computation. Rejected.
- **Full EAV for organizations.** Rejected: organizations have a small, stable, known
  field set. Typed columns are correct here; EAV is correct in PIM (ADR-0013) because
  the field set there is genuinely open.

## Consequences

- Every mastered write is at least two writes: a candidate and a recomputation.
- Provenance queries are direct: `SELECT * FROM organization_field_candidate WHERE
organization_id = $1 AND field_key = $2 ORDER BY is_selected DESC` answers
  "why does this field have this value" with no interpretation.
- Field-level ownership (open question B2) becomes configuration, not code.

## Risks

Candidate tables grow. Mitigated by superseding rather than accumulating: a new payload
from the same (source, record, field) updates that candidate row and archives the prior
value to `ingest.source_record_version`, which already holds the full history.

## Reversal cost

Very high after mastering begins. Day-one decision.

## Revisit if

Profiling shows recomputation cost dominating ingestion throughput, in which case
recomputation moves to a deferred queue for bulk paths only, never for interactive writes.
