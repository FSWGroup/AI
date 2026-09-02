# FSW Talent Scout — Assessment Methodology

All content in FSW Talent Scout is original FSW Group material. This document
describes what the instrument measures and exactly how scores are produced.
The scoring code lives in `src/lib/scoring/` and is deterministic: the same
answers, form version, scoring version, and norm tables always produce
identical results.

## Constructs

### Six mental aptitudes

| Construct | What it measures | Item families |
| --- | --- | --- |
| Mental Acuity | Learning comprehension, judgment, practical/deductive/logical reasoning, problem solving, interpreting information, patterns | verbal analogies, number series, syllogistic deduction, practical judgment scenarios, letter patterns, odd-one-out, information interpretation, sequence completion, quantitative reasoning |
| Business Terms | Practical knowledge of common business concepts | definitions, applications, simple calculations (margin, ROI, terms), document flow (quote → PO → invoice → payment) |
| Business & World Awareness / Memory | Retention of recently presented information plus durable business/economic awareness | timed study briefings with later recall questions; evergreen economic-concept, business-awareness, and interpretation items. Dated current-awareness items are added only through the admin question workflow (Draft → Review → Approved, with an expiry date) — never pulled live into an active test |
| Vocabulary | English vocabulary, verbal comprehension, word relationships | synonyms, antonyms, context meaning, word relationships, sentence completion — professional vocabulary, not obscure trivia |
| Numerical Perception | Speed and accuracy spotting differences among numbers, part numbers, prices, SKUs, alphanumeric strings | same/different pairs, match-the-target, odd-one-out; algorithmically generated original strings with confusable-character mutations; heavily timed |
| Mechanical Interest | Interest/orientation toward mechanical subjects — **not mechanical ability** (stated explicitly in every report) | agree/disagree interest statements, balanced with reverse-coded items |

### Ten performance / behavioral dimensions

Energy, Flexibility, Organization, Communication, Emotional Development,
Assertiveness, Competitiveness, Mental Toughness, Questioning/Probing,
Motivation — each measured by 11-12 original first-person statements on a
five-point agree/disagree scale, 40-50% reverse-coded, never grouped by
trait, never labeled, and separated so paired concepts sit far apart.
Narratives deliberately avoid trait-to-virtue leaps: Flexibility makes no
integrity claims, Communication does not equate extroversion with
competence, Emotional Development uses no clinical language, and neither
pole of Competitiveness or Motivation is framed as better.

### Two response-quality indicators

These are indicators about the response pattern — never proof of deception,
never displayed as accusations, and they never modify substantive scores.

**Distortion / Impression Management** combines (weights and thresholds in
`VALIDITY_CONFIG`, stored with every score):

1. endorsement of improbably-perfect-behavior items (60%)
2. the fraction of substantive answers at the maximally desirable extreme (40%)

Levels: NORMAL < 65, ELEVATED 65-79, HIGH ≥ 80 (0-100 scale). High reads:
"Responses show an elevated impression-management pattern. Interpret
behavioral results with additional caution."

**Equivocation** combines:

1. middle-choice fraction (50%) — the raw middle count and the configurable
   threshold (default 30) are stored and displayed
2. inconsistency across semantically paired items, after reverse-coding (30%)
3. low differentiation: 1 − (response SD / 2) (20%)

Levels: NORMAL < 45, ELEVATED 45-59, HIGH ≥ 60. Every report shows the raw
measurements behind the indicator.

## Scoring pipeline

1. **Cognitive sections** — raw score = weighted count of correct answers
   among presented items; unanswered items count against the score because
   timing is standardized. Scaled = raw / max × 100. Response speed is
   recorded for calibration but never affects the score (no reward for rapid
   guessing).
2. **Statement sections** — item score 1-5 (reverse-coded items flipped);
   construct raw = weighted mean (so no single answer can swing a trait);
   scaled = (mean − 1) / 4 × 100. Constructs with under half their items
   answered are flagged `scorable: false` in the stored detail.
3. **Banding** — see below.
4. **Composites** — transparent weighted means of component bands, defined in
   DB rows (`CompositeDefinition`) admins can inspect; the report prints the
   formula next to every composite.

Raw, scaled, band, band type, norm-table ID, scoring version, and a detail
object are stored per construct (`Score` rows). Nothing is destroyed by
conversion, and recalculation is an explicit, audited admin action that
creates a **new** report version — historical reports are never silently
changed.

## Provisional bands vs validated stanines

- **Provisional internal 1-9 band** — used until real norms exist. The scaled
  score (0-100) maps through the documented threshold table in
  `src/lib/scoring/bands.ts`. Reports label these clearly and never call
  them stanines.
- **Stanine** — used automatically for a construct once an authorized admin
  installs an ACTIVE `NormTable` recording construct, population, sample
  size, methodology, effective date, and raw-score thresholds per band
  (optionally with percentiles). Never fabricate norms; import them only
  from actual calibration data (see `docs/VALIDATION-ROADMAP.md`).

Band labels: 1 very low · 2 low · 3 below average · 4 low average ·
5 average · 6 high average · 7 above average · 8 high · 9 very high.

## Benchmarks and interpretation

Each job profile sets a desired min-max band per dimension (plus
enabled/required/weight/note). Scores classify BELOW / WITHIN / ABOVE;
above-range is explicitly not treated as better (e.g., very high Mental
Acuity against a routine role prompts a role-challenge conversation, not a
bonus). Configurable areas-of-concern rules flag low bands as "Additional
Interview Attention Recommended" — never failure, never auto-rejection.

## Report-selection rules

`src/lib/report/selection.ts` (config `SELECTION_CONFIG`, version-stamped):

- **Interview guide** — 2-4 dimensions chosen by deviation from the desired
  range (below-range deviations weighted 1.25× above-range), plus a bonus
  for role-critical dimensions (weight ≥ 1.5), plus validity follow-ups when
  an indicator is elevated. If nothing deviates, the dimensions nearest
  their range edges are probed instead. Each selected dimension yields 3-4
  behavioral questions with limited-work-history alternates and
  employer-only "listen for" guidance.
- **Development** — up to 4 dimensions meaningfully below range where
  development is possible (all behavioral constructs plus Business Terms,
  Awareness/Memory, Vocabulary, Mechanical Interest as familiarity-building).
  "Too much" of an aptitude never generates a development section.

## Sales and leadership composites

Eleven sales trait composites and five leadership composites are seeded as
`CompositeDefinition` rows (equal weights, version 1.0) — e.g. *Persistence
and consistency* = Mental Toughness + Energy + Flexibility. The sales
summary classifies each composite qualitatively (Strong alignment /
Generally aligned / Mixed alignment / Requires additional investigation) via
transparent band cut-offs and an overall count rule — deliberately **not** a
"probability of sales success", which would be unsupportable without
predictive validation.

## Integrity summary

Only objective events (tab hidden, window blur, camera interruptions,
disconnects, copy attempts, refreshes) are logged. A weighted count maps to
"No notable events" / "Minor review recommended" / "Review recommended",
with the underlying events always visible. There is no black-box cheating
probability, no automatic consequence, and the recording itself is never
analyzed (see `docs/RECORDING-PRIVACY.md`).
