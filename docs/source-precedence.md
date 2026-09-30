# Source Precedence

Implemented in `/home/user/AI/packages/core/src/knowledge/authority.ts`, applied by `src/gate/answerGate.ts` and `src/knowledge/conflicts.ts`. Human overrides live in `src/review/reviews.ts`.

## Precedence table

`AUTHORITY_BY_SOURCE_TYPE` — lower number = higher precedence. `sources.authority_level` (1–10) must be set to this value at ingest (`seedCatalog.ts`, `shopifySync.ts`, `p21Sync.ts`, `correctAssertion` all do so).

| Level | `source_type` | What it is | Fixture examples (`sources.name`) |
|---|---|---|---|
| 1 | `human_override` | A Welsford human-approved correction with author, approver, justification, effective date | "Welsford engineering/business overrides" (created on first `correctAssertion`) |
| 2 | `mfr_document` | Versioned manufacturer document (datasheet, IOM, torque bulletin, product bulletin, compatibility chart) | `[DEV FIXTURE] Bramwell Series 70 … Datasheet` (BVW-70-DS), `Corvin Valve Mounting Compatibility Chart` |
| 3 | `mfr_structured` | Manufacturer structured data (part list / price list) | `[DEV FIXTURE] <mfr> price/part list` — identity evidence for every variant |
| 4 | `p21` | Prophet 21 ERP records | `Prophet 21 (DEV FIXTURE)` |
| 5 | `shopify` | Shopify Admin records | `Shopify (DEV FIXTURE)`, `[DEV FIXTURE] Shopify catalog (valveman)` |
| 6 | `internal_approved` | Approved internal registers (engineering notes, channel/territory register, approved cross-reference register) | `Welsford engineering notes register`, `Welsford channel & territory register 2026`, `Welsford Approved Cross-Reference Register 2025` |
| 7 | `mfr_website` | Manufacturer website capture | `Halden 2000 Series web catalog capture` |
| 8 | `company_website` | Welsford/ValveMan website | none in fixtures |
| 9 | `internal_historical` | Unapproved historical internal data | none in fixtures |
| 10 | `internet` | General internet | `General internet forum capture` (trap) |

## Per-criticality maximum authority

`maxAuthorityForCriticality(criticality)` — the least-authoritative level allowed to support a claim:

| Claim criticality | Max level | Allowed source types | Extra requirement |
|---|---|---|---|
| 1–2 | 9 | everything except `internet` | — |
| 3 | 7 | levels 1–7 (manufacturer website acceptable) | — |
| 4 | 6 | human_override, mfr_document, mfr_structured, p21, shopify, internal_approved | — |
| 5 | 2 | human_override, mfr_document | assertion status must be `human_approved` (gate check `human_approval_required`) |

The gate evaluates each cited record independently; a claim survives if at least one record passes authority, predicate allowance, revision and freshness together. Records that fail are simply not cited.

## Predicate-specific allowed source types

`sourceTypeAllowedForPredicate(predicate, sourceType)`:

- **Technical predicates** (`TECHNICAL_PREDICATES`): `pressure_rating_psi`, `temp_min_f`, `temp_max_f`, `cv`, `steam_rating_psi`, `break_torque_inlb`, `torque_output_inlb_80psi`, `spring_end_torque_inlb`, `air_start_torque_inlb_80psi`, `supply_pressure_min_psi`, `supply_pressure_max_psi`, `media`, `hazardous_area_cert`, `certifications`, `body_material`, `seat_material`, `seal_material`, `mount_pad_iso5211`, `stem_size_mm`, `actuator_mount_iso5211`, `actuator_drive_mm`, `lead_free`, `vacuum_rating`
  → allowed only from `human_override`, `mfr_document`, `mfr_structured`, `internal_approved`, `mfr_website`. **Never from `p21` or `shopify`**, regardless of authority level.
- **All other predicates** → any source type except `internet`.

This check applies to `kind = "attribute"` claims. For identity, relationship, commercial, rule and document claims the gate only excludes `internet`.

Combined effect for a criticality-4 technical spec such as `pressure_rating_psi`: allowed sources are human_override (1), mfr_document (2), mfr_structured (3), internal_approved (6). `mfr_website` (7) is a permitted type but exceeds the level-6 cap, so it cannot support a criticality-4 attribute (e.g. the fixture's Halden web-catalog pressure rating).

## Freshness windows

`freshnessWindowDays(sourceType)`, measured against `source_records.last_verified_at` at gate time (`ctx.now`):

| Source type | Window | Rationale in code |
|---|---|---|
| `p21` | 1 day | ERP snapshot must be re-synced daily; answers also state `as_of` |
| `shopify` | 7 days | |
| `internet` | 0 days | never fresh, never eligible |
| everything else | 3 × 365 days | manufacturer documents are versioned; superseded revisions are excluded by a separate check |

A record with `last_verified_at = NULL` never passes. Fixture internet records are seeded with NULL. Sync jobs set `last_verified_at` to the sync time; seeded documents and part lists set it to `now()` at seed time, so a database seeded more than three years ago would stop answering from those records until re-verified.

## Superseded-revision exclusion

`loadSourceRecords` joins `document_versions.is_current`; the gate check `revision_current` fails when it is `false`. `searchDocumentPages` defaults to `currentOnly`, and `documentFinderAgent` only joins current versions. Seeding marks non-current fixture revisions with `superseded_at`.

Fixture example: Bramwell Series 70 datasheet Rev B (2022-03-01, superseded) vs. Rev C (2025-01-15, current). Assertions with evidence on Rev B pages are removed as `removed_stale`.

## Conflict semantics (`detectConflicts`, `src/knowledge/conflicts.ts`)

Assertions in status verified / pending / conflicting / human_approved are grouped by (subject_type, subject_id, predicate). For each group with ≥ 2 distinct values:

| Situation | Type | Effect |
|---|---|---|
| Any assertion in the group is `human_approved` | resolved by precedence | skipped (override wins) |
| ≥ 2 distinct values each supported by at least one source type that is **allowed for that predicate** | **Blocking** | Eligible assertions set to `conflicting`; one open `knowledge_conflicts` row (idempotent); `knowledge_reviews` row `source_conflict`, priority 1. Nothing picks a winner; the projection omits the attribute; the gate removes claims (`removed_conflict`). |
| Only ineligible sources disagree with the eligible value(s) | **Non-blocking** | Verified assertion stays answerable. One `low_confidence_assertion` review (priority 3) per ineligible assertion so a human can fix the listing (e.g. Shopify metafield says 1000 WOG, datasheet says 1000 — no conflict; says 800 — non-blocking review). |

Note: eligibility here is by source *type* only (`sourceTypeAllowedForPredicate`); authority level and criticality are not considered by the conflict detector, only by the gate.

`resolveConflict(sql, conflictId, winningAssertionId, userId, note)`: winner → `human_approved`, losers → `deprecated`, conflict → `resolved`, review → `approved`, audit event `conflict.resolve`. The caller is expected to run `rebuildAttributeProjection` afterwards (approve/reject/correct paths in `reviews.ts` do so; `resolveConflict` itself does not).

## Human overrides (`correctAssertion`, `src/review/reviews.ts`)

Requires the `review_knowledge` permission. In one transaction:

1. Find or create the single `human_override` source (authority 1, `is_fixture = false`).
2. Insert a `source_records` row: `record_locator = override:<subject>:<predicate>:<timestamp>`, `extracted_text = "Override by <name> (<email>): <predicate> = <value> <unit>. Justification: …"`, `structured = {author, approver, justification}`, `effective_date = current_date`, `last_verified_at = now()`.
3. Insert a new `knowledge_assertions` row with status `human_approved`, the old assertion's criticality, `supersedes_id = old.id`, `created_by = user`.
4. Insert `assertion_evidence` (method `manual`) whose `supporting_text` is the override text — so gate step 7 (value in supporting text) passes.
5. Deprecate the old assertion **and** any other verified/pending/conflicting assertion on the same (subject, predicate).
6. Resolve any open `knowledge_conflicts` on that key with the new assertion.
7. Optionally mark the originating review `corrected`.

Then: audit event `assertion.correct`, `rebuildAttributeProjection`. The override now satisfies every criticality (level 1 ≤ 2) including the criticality-5 human-approval requirement.

Other review actions: `approveReview` (assertion/relationship → `human_approved`, then `detectConflicts` + projection rebuild), `rejectReview` (→ `rejected`, projection rebuild), `commentReview`.

## Ingest-time defaults

| Ingest path | Assertion status on creation |
|---|---|
| `seedCatalog.ts` fixture assertions | `verified` unless the fixture says otherwise (traps use `pending`) |
| `shopifySync.ts` metafield specs | `pending`, evidence method `api_sync` |
| `p21Sync.ts` | no assertions; commercial rows and `p21_item_id` identifiers only |
| planned PDF pipeline (comment in `seedCatalog.ts`) | `pending` until verified |
