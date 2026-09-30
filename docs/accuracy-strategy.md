# Accuracy Strategy

Code references are relative to `/home/user/AI/packages/core/src/`.

## Definitions

| Term | Definition | Where computed |
|---|---|---|
| **Claim** | One factual statement (subject, predicate, value) with the evidence that supports it (`ProposedClaim`, `answer/types.ts`). An answer is a set of claims plus a summary built only from the verified ones. | agents |
| **Answer rate** | Cases whose outcome is `answered` or `partial`, divided by all cases. | `computeMetrics.answerRate`, `eval/runner.ts` |
| **Abstention rate** | Cases whose outcome is `abstained`, divided by all cases. | `computeMetrics.abstentionRate` |
| **Accuracy (case level)** | Cases that pass every expectation (outcome, expected claims present, no forbidden claim, data expectations, every verified claim correct) divided by all cases. | `computeMetrics.caseAccuracy` |
| **Claim-level precision** | Correct verified claims divided by verified claims returned, across all cases. This is the headline ≥ 99.9% requirement. Recall is deliberately not gated: an abstention costs answer rate, not precision. | `computeMetrics.claimPrecision` |
| **Critical-claim precision** | Same, restricted to claims with criticality ≥ 4. Target 100%. | `computeMetrics.criticalClaimPrecision` |
| **Citation validity** | Verified claims with at least one citation whose supporting text is contained in the cited record and contains the value. | `computeMetrics.citationValidity` |

Answer rate and accuracy are independent dials: the system is allowed to answer less in order to stay above the precision bar, never the reverse.

## Claims are extracted structurally

Claims are never parsed out of prose. Each agent constructs `ProposedClaim` objects directly from database rows:

| Claim kind | Built from | Example builder |
|---|---|---|
| `identity` | `product_identifiers` row + its `source_record_id` (or the variant's part-list record) | `identityClaims`, `agents/partLookup.ts` |
| `attribute` | `knowledge_assertions` + `assertion_evidence` (all statuses; the gate filters) | `attributeClaims`, `agents/partLookup.ts` |
| `relationship` | `product_relationships` + `relationship_evidence`; supersession from historical identifiers | `agents/crossReference.ts`, `agents/assembly.ts` |
| `commercial` | `customer_pricing`, `inventory` rows and their `source_record_id` | `agents/commercial.ts` |
| `rule` | `channel_rules` rows applied by `decideEligibility`, citing their `source_record_id` | `eligibilityClaims`, `agents/eligibility.ts` |
| `calculation` | Deterministic arithmetic over other claims, `support.dependsOn` indices + `formula` | `agents/assembly.ts` |
| `document` | `documents` / `document_versions` / page `source_records` | `agents/documentFinder.ts` |
| `assumption` | INFERRED requirement fields; labeled, never verified, never presented as fact | `agents/productFinder.ts` |

The `summary` string is assembled by `buildAnswer` (`gate/answerGate.ts`) from verified claim labels (or from the deterministic rule-engine explanation for eligibility). `LlmProvider.explain` exists but is not used.

## The gate (`runAnswerGate`, `gate/answerGate.ts`)

Per claim, in execution order:

| Step | Check name(s) in `GateReport.checks` | Failure status | Notes |
|---|---|---|---|
| 0 | — | `assumption` | `kind = "assumption"` claims are passed through unchanged, never verified. |
| 8 (runs first) | `channel_permission` | `removed_channel` | Predicate is in `restrictedPredicatesFor(principal)` (RBAC). |
| — | `dependencies_verified` | `removed_unsupported` | `kind = "calculation"`: every `dependsOn` claim must already be `verified`; citations are inherited from dependencies. No further checks. |
| 1 | `evidence_exists` | `removed_unsupported` | At least one `source_record` in `support.sourceRecordIds` loads. |
| 2 | `assertion_status` | `removed_conflict` if status is `conflicting`, else `removed_unapproved` | Assertion must be `verified` or `human_approved`. |
| 6 | `no_open_conflict` | `removed_conflict` | No open `knowledge_conflicts` row on the assertion's (subject, predicate). Only applied to assertion-backed claims. |
| 2 | `relationship_status` | `removed_unapproved` | Relationship must be `verified` or `human_approved`. |
| 3 | `source_authority:<rec>` | — | `sources.authority_level <= maxAuthorityForCriticality(claim.criticality)`. |
| 3 | `source_type_allowed:<rec>` | — | Attribute claims: `sourceTypeAllowedForPredicate(predicate, sourceType)`. Other kinds: any type except `internet`. |
| 4 | `revision_current:<rec>` | — | `document_versions.is_current` is not `false`. |
| 5 | `freshness:<rec>` | — | `source_records.last_verified_at` is set and within `freshnessWindowDays(sourceType)`; a window of 0 (internet) always fails. |
| 3–5 result | — | `removed_stale` if any record was superseded or never verified, else `removed_unsupported` | A claim survives only if at least one record passes all four. |
| 5* | `human_approval_required` | `removed_unapproved` | Criticality ≥ 5 assertion-backed claims must be `human_approved`. |
| 7 | `citation_text_in_record:<rec>`, `value_in_supporting_text:<rec>` | `removed_unsupported` | `support.supportingText` must be a substring of the record's `extracted_text`, and `valueSupportedByText(value, text)` must hold (skipped for rule, document and relationship kinds). Citations are emitted only for records that pass. |
| 9 | — | — | Assumptions remain labeled assumptions (step 0). |

`valueSupportedByText` (`gate/textSupport.ts`) is deterministic: numbers must appear as numeric tokens (decimals, fractions such as `3/4` or `1-1/2`, digits glued to letters like `Cv260`); ranges need both bounds; booleans need an explicit yes/true/compliant or no/false/not; text values need every significant token present with a stem-tolerant prefix match for tokens of 4+ characters.

## Confidence categories

Computed deterministically at the end of `runAnswerGate` from the gate report, then possibly tightened by the agent:

| Outcome | Condition (gate) | Confidence |
|---|---|---|
| `abstained` | `removedCritical > 0`, or `verified = 0` while claims were proposed | `INSUFFICIENT_EVIDENCE` |
| `partial` | any non-assumption claim removed | `NEEDS_REVIEW` |
| `answered` | every non-assumption claim verified | `VERIFIED` |

Inputs to that computation: the per-claim `status` values produced by the checks above, the `critical` flag on each proposed claim (set by agents: identity claims, requested spec attributes, matched-requirement attributes in product finder, authorization rule claims, ecommerce/contract price, `qty_available`, break torque and required-torque calculations), and the counts `proposed / verified / removed / removedCritical`.

Agents may only move the outcome toward abstention:

- `productSpecsAgent`: a requested attribute with no assertion at all → `abstained`.
- `partLookupAgent`, `crossReferenceAgent`, `eligibilityAgent`, `pricingAgent`, `inventoryAgent`, `documentFinderAgent`, `assemblyAgent`, `askAgent`: unresolved part, no rule, no verified price/inventory/document, no passing actuator, unknown intent → `abstained`.
- `productFinderAgent`: demotes individual candidates whose matched-requirement claims failed; abstains when no verified candidate remains; `partial` when any candidate was demoted.
- `rfqBomAgent`: any line needing review → `partial`.

Confidence is additionally stored per RFQ line (`rfq_lines.confidence`) using the same three values.

## Abstention behavior

- The abstention text is a constant: `ABSTAIN_TEXT = "I don't have enough verified information to answer that confidently."` (`answer/types.ts`), followed by whatever was verified so far and what is missing.
- Every answer carries `known[]`, `unknown[]` (each removed claim with its reason) and `resolvingSources[]` — what would make the answer possible (e.g. "Resolve the open knowledge conflict on pressure_rating_psi in Knowledge Review", "Re-ingest or re-verify the current manufacturer document for …", "The customer's state (territory rules are state-scoped)").
- `humanReviewRecommended` is true whenever the outcome is not `answered` or criticality ≥ 4.
- Abstentions at criticality ≥ 4 create a `human_escalations` row (`recordRun`).
- Fuzzy or prefix identifier hits are returned as candidates in `data`, never as claims.
- In the fixtures, three deliberate traps exercise this path: `BVW-S40-100` pressure rating has two eligible but disagreeing sources (datasheet 600 WOG vs. approved engineering note 800 WOG) → open conflict → abstain; `BVW-S40-200` Cv exists only from an internet forum → never eligible; `HLD-2000-2SS` pressure rating is LLM-extracted and `pending` → not answerable.

## When precision falls short

The rule is **tighten, never loosen**. Available levers, all in code:

| Symptom | Lever |
|---|---|
| Wrong value from a low-authority source | Lower `maxAuthorityForCriticality` for that level, or add the predicate to `TECHNICAL_PREDICATES` (`knowledge/authority.ts`) |
| Stale ERP/ecommerce data cited | Shorten `freshnessWindowDays` |
| Value not actually on the cited page | `valueSupportedByText` already blocks it; raise the attribute's `criticality` so human approval is required (level 5) |
| Wrong substitute | Relationship must be `human_approved` with `approval_authority = welsford` to appear as a Welsford substitute; reject it in review (`rejectReview`) |
| Category-level failures | Remove the category from scope until its golden cases pass (release gate is per category for pricing, inventory, territory_eligibility) |
| Any reported wrong answer | `reportIncorrectAnswer` → priority-1 review + regression case that must pass before release |

No lever exists to accept a claim without evidence, to pick a winner among conflicting eligible sources automatically, or to skip the gate.

## Zero-hallucination policy → mechanisms

| Policy statement | Mechanism |
|---|---|
| The LLM is never a source of truth | `NullProvider` default; LLM outputs are zod-validated hints only (`llm/provider.ts`, `requirements/extract.ts`, `agents/rfqBom.ts`, `agents/ask.ts`); no LLM text reaches `Answer.summary` |
| Every stated fact is cited | Gate step 1 + step 7; `citations` table per run |
| Citations point at the current revision | Gate step 4 (`document_versions.is_current`) |
| Commercial data is dated | Freshness window (P21 1 day, Shopify 7 days); labels include "as of <timestamp>" (`citationFor`) |
| Merchandising copy cannot state a technical spec | `sourceTypeAllowedForPredicate`; Shopify metafield specs land as `pending` assertions (`ingest/shopifySync.ts`) |
| Disagreements are surfaced, not resolved by the machine | `detectConflicts` marks assertions `conflicting`, opens a conflict and a priority-1 review; projection excludes them |
| Sizing math is deterministic and traceable | `calculation` claims carry `formula` and `dependsOn`; abstain outside verified data (80 psi only, no interpolation) |
| Substitute categories are never blurred | `categorize` in `agents/crossReference.ts`; "technically similar" labels say "NOT an approved substitute" |
| Restricted data cannot leak through an answer | `restrictedPredicatesFor` applied in the gate before evidence checks |
| Fixture data cannot masquerade as real | `sources.is_fixture`, `[FIXTURE]` citation prefix, `sync_jobs.mode` |
| Every answer is reproducible | `agent_runs` + `claims` + `citations` + `retrieval_events` |
| Prompt injection via documents/RFQs/emails is contained | `<untrusted_data>` framing, tag stripping, JSON-only output, schema validation, literal-quote requirement |
