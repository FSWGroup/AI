# Evaluation Strategy

Code: `/home/user/AI/packages/core/src/eval/{dataset.ts,runner.ts,cli.ts}`. Golden files: `/home/user/AI/eval/golden/*.json`. Run outputs: `/home/user/AI/eval/runs/` (git-ignored).

## Golden dataset format

`readGoldenFiles()` reads every `*.json` in `eval/golden/` (sorted), each shaped `{ "version": "<semver>", "cases": GoldenCase[] }`. The highest `version` string wins as the dataset version. Duplicate case ids across files throw. `loadGoldenDataset(sql)` upserts each case into `evaluation_cases` (called by `db:seed` and at the start of every `npm run eval`).

`eval/golden/v1-core.json` (96 cases across every category) and `eval/golden/v1-regressions.json` (defects found during development, each with the observed failure and root cause) are loaded together; the loader rejects duplicate ids across files.

`GoldenCase` (`dataset.ts`):

```ts
interface GoldenCase {
  id: string;            // stable, unique (e.g. "PL-001"); regression cases use "REG-<8 hex>"
  category: string;      // free text, used for per-category metrics and gates
  agent: string;         // which agent to dispatch (see table below)
  criticality: number;   // 1..5
  input: Record<string, unknown>;   // agent parameters + optional principalEmail, channel, state, customerClass
  expected: {
    outcome?: "answered" | "partial" | "abstained" | "escalated";
    claims?: { subject: string; predicate: string; value: string; severity?: 1 | 2 }[];   // must be present AND verified
    forbiddenClaims?: { subject: string; predicate: string; value?: string }[];           // must NOT be verified
    data?: Record<string, unknown>;  // dot-path → exact JSON value, or { includes: [...] } for arrays
    maxClaims?: number;              // upper bound on verified claims
  };
  isRegression?: boolean;
  origin?: string;       // defaults to the file name; "regression:<review_id>" for reported answers
  notes?: string;
}
```

`input` keys per agent (`dispatch` in `runner.ts`):

| `agent` | `input` fields |
|---|---|
| `part_lookup` | `query`, `manufacturer?` |
| `product_specs` | `partNumber`, `predicates?`, `question?` |
| `product_finder` | `text`, `channel?`, `state?` |
| `cross_reference` | `partNumber`, `manufacturer?` |
| `eligibility` | `partNumber`, `channel?`, `state?`, `customerClass?` |
| `pricing` | `partNumber`, `channel?`, `customerP21Id?` |
| `inventory` | `partNumber` |
| `document_finder` | `query`, `partNumber?`, `documentType?` |
| `assembly` | `valvePartNumber`, `actuation`, `supplyPressurePsi?`, `safetyFactor?`, `solenoidVoltage?`, `includeLimitSwitch?` |
| `rfq_bom` | `text`, `sourceKind?` |
| `ask` | `question`, `customerP21Id?` |

Context fields read from `input` for every case: `principalEmail` (resolved via `loadPrincipalByEmail`, else `PUBLIC_PRINCIPAL`), `channel` (default `welsford`), `state`, `customerClass`. The LLM is always `NullProvider`; `mode = "evaluation"`.

Claim matching uses `subject` = the claim's `subjectRef` (canonical SKU, `rule:<channel>:<sku>`, `calc:<sku>`, `requirements`, `documents`) and `predicate` = the claim predicate (attribute key, `identifier`, `canonical_sku`, `manufacturer`, `eligibility:<channel>`, `list_price`, `qty_available`, `xref:<CATEGORY>`, `document:<type>`, …). Values compare case-/whitespace-insensitively, or numerically when both sides are numbers.

## Categories

`category` is free text. Two names are load-bearing in code:

- `exact_part_lookup` feeds `metrics.partLookupExact` (gate: 100% pass).
- `pricing`, `inventory`, `territory_eligibility` must pass 100% of cases (`releaseGate`).

Suggested categories that map to fixture traps and agent contracts: `exact_part_lookup`, `historical_lookup`, `competitor_xref`, `product_specs`, `conflict_abstain`, `stale_revision`, `low_authority_source`, `product_finder`, `cross_reference`, `territory_eligibility`, `pricing`, `inventory`, `document_finder`, `assembly_sizing`, `rfq_bom`, `rbac`, `ask_routing`, `regression`.

## How the runner scores (`runEvaluation`)

For each case (golden then regression, ordered by id):

1. Dispatch to the real agent; a thrown error yields a result with `outcome = "error"`, `pass = false` and a severity-1 failure.
2. Take the answer's **verified** claims only (`status === "verified"`).
3. For each verified claim:
   - **Citation validity**: at least one citation whose `sourceRecordId` resolves, whose `supportingText` (if any) is contained in the record's `extracted_text`, and — for identity, attribute and commercial kinds — where `valueSupportedByText(value, supportingText ?? extractedText)` holds. Rule/document/relationship kinds need containment only; calculation kinds are always citation-valid.
   - **Forbidden**: matches a `forbiddenClaims` entry (subject + predicate, and value if given) → incorrect, reason "forbidden claim returned as verified".
   - **Expected**: matches an `expected.claims` entry by subject + predicate → correct iff the value matches.
   - **Not covered by expectations** → `reverify()`: attribute claims must still be in `product_attributes` with the same value; other kinds count as "structural claim with gated evidence". Correct iff reverify passes **and** the citation is valid.
   - **Severity 1** is recorded for any incorrect claim with criticality ≥ 4, or matching an expected claim with `severity: 1`, or hitting a forbidden claim.
4. `missingExpected`: expected claims with no verified match (subject, predicate, value).
5. `forbiddenHit`: forbidden entries that matched a verified claim.
6. `outcomePass`: `expected.outcome` absent or equal to the actual outcome. Expected `abstained` but not abstained → severity-1 failure "answered when abstention was required".
7. `dataFailures`: each `expected.data` path (dot notation, numeric segments index arrays) compared by `JSON.stringify` equality, or `{ includes: [...] }` requiring every listed item to appear (as a stringified substring) in the array at that path. `maxClaims` exceeded → data failure.
8. `pass = outcomePass && missingExpected.length === 0 && forbiddenHit.length === 0 && dataFailures.length === 0 && every claim correct`.

Results (per case: claims with reasons, missing, forbidden hits, data failures, severity-1 list, latency) are stored in `evaluation_runs.results` and in the JSON file under `eval/runs/`.

## Metrics — exactly as computed (`computeMetrics`)

`pct(n, d)` returns `1` when `d = 0`. Let `all` = every scored verified claim across cases, `critical` = those with criticality ≥ 4, `expectedAbstain` = cases with `expected.outcome = "abstained"`.

| Metric | Formula |
|---|---|
| `cases`, `passed`, `failed` | counts of results / `pass` true / `pass` false |
| `caseAccuracy` | passed / cases |
| `claimsTotal`, `claimsCorrect`, `claimsIncorrect` | over `all` |
| `claimPrecision` | claimsCorrect / claimsTotal |
| `criticalClaimsTotal`, `criticalClaimsIncorrect` | over `critical` |
| `criticalClaimPrecision` | critical correct / critical total |
| `citationValidity` | claims with `citationValid` / claimsTotal |
| `unsupportedClaimRate` | claims without `citationValid` / claimsTotal |
| `expectedAbstain` | count of expected-abstain cases |
| `abstainedCorrectly` | expected-abstain cases whose outcome is `abstained` |
| `abstentionQuality` | abstainedCorrectly / expectedAbstain |
| `falseAnswerRate` | expected-abstain cases not abstained / expectedAbstain |
| `abstentionRate` | cases with outcome `abstained` / cases |
| `answerRate` | cases with outcome `answered` or `partial` / cases |
| `severity1Errors` | sum of `severity1Failures.length` over cases |
| `regressionCases`, `regressionPassed` | cases with `is_regression` / of those, passed |
| `byCategory[c]` | `{ cases, passed, claims, claimsCorrect }` per category |
| `partLookupExact` | `{ cases, passed }` for category `exact_part_lookup` |

Precision-style ratios (`pct`) are vacuously 1 with a zero denominator; error-rate-style ratios (`rate`: unsupported-claim rate, false-answer rate, abstention/answer rate) are vacuously 0. An empty dataset would therefore pass the gate, so the release checklist requires a minimum dataset size and a minimum number of expected-abstention cases per category before a gate result is meaningful.

## Regression flow (`reportIncorrectAnswer`, `src/review/reviews.ts`)

Input: `runId`, `userId`, `incorrectOutput`, `correctedAnswer` (`{ outcome?, claims?, forbiddenClaims? }` — the same shape as `expected`), `rootCause`, optional `category`.

1. Load the `agent_runs` row.
2. Insert a `knowledge_reviews` row: type `answer_correction`, target `answer`/run id, priority 1, payload with the incorrect output, corrected answer and root cause.
3. Insert an `evaluation_cases` row with id `REG-<first 8 chars of review id>`, `category` = given or `regression`, `agent` = the run's agent, `criticality` = the run's (default 3), `input` = the structured input every agent records with its run (`agent_runs.answer.input`; falls back to `{ question }`), `expected` = `correctedAnswer`, `is_regression = true`, `origin = regression:<review id>`, `dataset_version = 'regression'`.
4. Insert a `regression_cases` row linking case, review, question, incorrect output, corrected answer, root cause.
5. Audit event `answer.report_incorrect`.

Every later evaluation run executes regression cases alongside golden ones; any failing regression case fails the release gate. Every agent records its structured input with the run, so a reported answer replays exactly (verified by `test/integration.test.ts`, which reports an answer and re-runs the resulting case).

## How to run

```
npm run db:reset            # drop, migrate, seed fixtures + Shopify/P21 fixture sync + golden dataset
npm run eval                # load golden files, run every case, print report, write eval/runs/<timestamp>-<run>.json
npm run eval:gate           # same, exit code 2 if the release gate fails (for CI)
npm run eval -- --only=PL-001,PL-002   # subset by case id
npm run eval -- --verbose   # print the failure section even when everything passes
```

The CLI (`eval/cli.ts`) records `code_version` from `git rev-parse --short HEAD` when the repo root is a git checkout, prints claim precision, critical-claim precision, citation validity, unsupported-claim rate, severity-1 count, abstention quality / false-answer rate, overall abstention and answer rates, exact part lookup and regression tallies, per-category tallies, each failure with its wrong / missing / forbidden claims and data mismatches, and finally `RELEASE GATE: PASS|FAIL` with reasons.

`npm test` runs vitest over `test/**/*.test.ts`; no tests exist yet.

## Shadow-mode plan

Status: **planned**. Present in code: `agent_runs.mode` accepts `shadow`; `AgentContext.mode` can be set to `"shadow"` via `makeContext`; every run records claims, citations, gate report and retrieval trace regardless of mode.

Intended flow:

1. Replay real questions (sales/CS inbox, ValveMan chat) through `askAgent` with `mode = "shadow"`; answers are stored, not shown.
2. A reviewer compares each shadow answer with what the human actually said and files disagreements via `reportIncorrectAnswer`, which creates a priority-1 review and a regression case.
3. Shadow runs are aggregated with the same metric definitions (claim precision, abstention quality, false-answer rate) per category and per agent.
4. A category moves from shadow to live only when its golden + regression cases pass the release gate and the shadow sample shows no severity-1 error.
5. Human review sampling continues after go-live at the rates in `release-gates.md`.

Not yet built: the replay harness, a reviewer UI for shadow comparisons, and per-mode metric aggregation (the runner only reads `evaluation_cases`).
