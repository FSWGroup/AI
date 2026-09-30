# Release Gates

The gate is `releaseGate(metrics)` in `/home/user/AI/packages/core/src/eval/runner.ts`. It runs at the end of every `runEvaluation`, is stored in `evaluation_runs.passed_gate`, and `npm run eval:gate` exits with code 2 when it fails. Metric definitions are in `evaluation-strategy.md`.

## Gate conditions (exact)

All conditions must hold; each failure adds a reason string.

| # | Condition | Reason text when violated |
|---|---|---|
| 1 | `claimPrecision >= 0.999` | `claim precision X% < 99.9%` |
| 2 | `criticalClaimPrecision >= 1` (100%) | `critical-claim precision X% < 100%` |
| 3 | `severity1Errors == 0` | `N severity-1 error(s)` |
| 4 | `citationValidity >= 0.999` | `citation validity X% < 99.9%` |
| 5 | `unsupportedClaimRate <= 0.001` | `unsupported claim rate X% > 0.1%` |
| 6 | `regressionPassed == regressionCases` | `N regression case(s) failing` |
| 7 | `partLookupExact.passed == partLookupExact.cases` | `exact part lookup a/b < 100%` |
| 8 | `abstentionQuality >= 1` (every expected abstention honored) | `abstention quality X% < 100%` |
| 9 | For each category in `pricing`, `inventory`, `territory_eligibility` that has cases: `passed == cases` | `<category>: a/b cases pass (target 100%)` |

`passed = reasons.length === 0`.

Caveat: precision-style ratios are vacuously 1 with a zero denominator (error rates are vacuously 0), so a dataset with no cases, no critical claims or no expected abstentions satisfies the corresponding conditions vacuously. A release must therefore also require a minimum dataset (see checklist).

## Severity-1 definitions

A severity-1 failure is recorded by the runner when any of the following occurs; condition 3 makes any of them a hard block:

| Trigger | Where |
|---|---|
| A verified claim with **criticality ≥ 4** is incorrect (wrong value, contradicts the projection, or citation does not support the value) | `runEvaluation` claim loop |
| A verified claim matches an expected claim marked `severity: 1` and its value is wrong | same |
| A verified claim hits a `forbiddenClaims` entry (e.g. a conflicting/stale value, a false substitute, a restricted price for the wrong principal) | same |
| The case expected `abstained` and the system answered (`answered` or `partial`) | outcome check |
| The agent threw an error | dispatch catch |

Consequences beyond the gate: every reported incorrect answer in production is a priority-1 `knowledge_reviews` item and a regression case (`reportIncorrectAnswer`).

## Model-upgrade rule

The evaluation runner always runs with `NullProvider`, so the gate measures the deterministic path. An LLM change (model id in `WPI_LLM_MODEL`, SDK version, prompt text in `llm/provider.ts`, or any new call site) is still a release:

1. No deployment of a model or prompt change until an evaluation run on the current golden + regression dataset passes the gate.
2. In addition, the LLM-assisted paths (`extractRequirements`, `rfqBomAgent` line splitting, `askAgent` intent planning) must be exercised with the new model on the same inputs and produce no severity-1 error and no drop in claim precision versus the `NullProvider` baseline. Today this comparison is manual: the runner has no LLM-enabled mode, and `evaluation_runs.llm_model` is always `'none'`.
3. A model change can never be used to raise the answer rate at the expense of precision; if the LLM proposes fields or lines that the deterministic re-verification rejects, the rejection stands.

## Scope-reduction rule

When the gate fails, the fix is to narrow what the system answers, never to loosen a check:

| Failure | Allowed response |
|---|---|
| Category below target | Remove the category from customer-facing scope (do not route to it in `askAgent` / UI) until its cases pass; keep it in shadow mode. |
| Attribute produces wrong claims | Raise the attribute's `criticality` in `attribute_definitions` (stricter authority, or human approval at 5); add the predicate to `TECHNICAL_PREDICATES`. |
| Source produces wrong claims | Lower its `sources.authority_level` is **not** allowed as a loosening; only demotion (higher number) or removal. |
| Stale data cited | Shorten `freshnessWindowDays`; increase sync frequency. |
| Answered when abstention was required | Mark the relevant claim `critical` in the agent, or add an explicit abstain condition. |

Forbidden responses: deleting or weakening golden/regression cases, editing expected values to match output without a documented root cause, bypassing `runAnswerGate`, projecting `pending` or `conflicting` assertions, allowing `shopify`/`p21` for technical predicates.

## Human review sampling

Mechanisms in code that feed review: `humanReviewRecommended` on every answer (true when outcome ≠ `answered` or criticality ≥ 4), `human_escalations` for abstentions at criticality ≥ 4, `knowledge_reviews` for conflicts and corrections, and full run recording in `agent_runs` / `claims` / `citations`.

Sampling policy (process, not enforced by code):

| Population | Review rate | Reviewer |
|---|---|---|
| All answers with criticality ≥ 4 (assembly, substitutes, criticality-4 specs) | 100% before use in a quote | `app_engineer` |
| Pricing / inventory answers shown to customers | 100% of `partial`/`NEEDS_REVIEW`; random 5% of `VERIFIED` | `sales` / `cs` |
| Product finder results | random 10% of `VERIFIED`; 100% when `hazardous_area` is explicit | `app_engineer` |
| Abstentions | weekly triage of `human_escalations` and `resolvingSources` to prioritize ingestion | `admin` / `app_engineer` |
| Shadow-mode runs | 100% until the category passes the gate | assigned reviewer |

Any reviewer disagreement is filed with `reportIncorrectAnswer` so it becomes a regression case.

## Reading a gate result

`npm run eval:gate` prints the metrics block followed by, for example:

```
RELEASE GATE: FAIL
  - critical-claim precision 99.020% < 100%
  - 1 severity-1 error(s)
  - territory_eligibility: 11/12 cases pass (target 100%)
```

Locate the failing case in the `Failures (N)` section above it or in `eval/runs/<timestamp>-<run>.json` (`results[].claims[].reason`, `missingExpected`, `forbiddenHit`, `dataFailures`, `severity1Failures`). The same structure is stored in `evaluation_runs.results` for the run id printed in the header. Per-claim gate decisions for the underlying answer are in `agent_runs.gate_report.checks` (`{ claim, check, passed, detail }`) and `claims.reason` for that evaluation-mode run.

## Release checklist

1. `npm run db:reset` on a clean database seeded with the target fixture/live data; migrations applied without error.
2. Golden dataset has cases for every agent in scope and at least one expected-abstain case per trap type (open conflict, superseded revision, ineligible source, unknown identifier, missing rule, missing assembly inputs); verify `metrics.cases > 0`, `criticalClaimsTotal > 0`, `expectedAbstain > 0`.
3. `npm run eval:gate` exits 0; attach the `eval/runs/*.json` file and the `evaluation_runs.id` to the release.
4. All regression cases from open `answer_correction` reviews are included and passing.
5. No open `knowledge_conflicts` on attributes in scope, or the affected products are excluded from scope.
6. `sync_conflicts` of type `duplicate_sku`, `uom_conflict`, `price_discrepancy` reviewed for products in scope.
7. For live mode: Shopify and P21 syncs ran within their freshness windows (7 days, 1 day) and `sync_jobs.status = 'succeeded'`; `sources.is_fixture = false` for every source cited in scope.
8. If the LLM is enabled: model id pinned in `WPI_LLM_MODEL`, model-upgrade rule satisfied, `ANTHROPIC_API_KEY` present only in environments where LLM assistance is intended.
9. RBAC spot check: a `public` principal cannot obtain `cost`, `customer_contract_price`, `qty_on_hand`; a `customer` principal cannot obtain another customer's contract price.
10. `code_version` (git SHA) recorded on the evaluation run matches the artifact being deployed.
11. Human review sampling owners and rates confirmed for the categories going live.
