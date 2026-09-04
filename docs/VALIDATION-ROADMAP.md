# FSW Talent Scout — Validation Roadmap

FSW Talent Scout ships as **decision-support software with provisional scoring**.
Until the work below is done, treat results as structured interview
preparation — one input among many — and keep the in-product language
("FSW Talent Scout internal assessment scores", "provisional 1-9 band") exactly
as is. Do not describe the instrument as a scientifically proven predictor
of performance, and do not lean on it heavily for selection decisions.

## Why this matters

Employment selection procedures in the U.S. are evaluated under the Uniform
Guidelines on Employee Selection Procedures (and analogous rules elsewhere):
if a procedure contributes to selection decisions and adversely impacts a
protected group, the employer must be able to show the procedure is
job-related and consistent with business necessity. That showing requires
evidence this software cannot generate by existing — it must be collected.

## Phase 1 — Job analysis (before heavy reliance)

1. Document, per role, the tasks and the knowledge/skills/abilities/other
   characteristics they require (interviews with incumbents and supervisors,
   task questionnaires).
2. Map each FSW Talent Scout dimension used in that role's benchmark to specific
   job requirements; disable dimensions you cannot connect to the job.
3. Set desired ranges from the job analysis (and incumbent data where
   available), not intuition; record the rationale in each benchmark's note
   field.

## Phase 2 — Reliability and item calibration

1. Accumulate administrations; the **Assessment Quality** page aggregates
   anonymous item statistics (difficulty = % correct, missing rate, response
   time). Treat everything as provisional until at least a few hundred
   administrations per form.
2. Compute internal-consistency reliability (e.g., coefficient alpha) per
   scale and item-total correlations; revise or retire weak items through
   the question workflow (versioned, so history is preserved).
3. Never fabricate sample sizes or reliability coefficients — the platform
   deliberately has no place to display numbers that were not computed.

## Phase 3 — Norms

**Now supported in-product: Admin → Validation → Norm tables.**

1. Define the reference population. The default, and the right one for a
   selection instrument, is **applicants** — not hires. The band on a
   candidate's report is used to compare them with the other people who
   applied; norming on people who already got through would compare an
   applicant against a pre-selected group and make almost everyone look
   below average.
2. Cut points are placed at the sample's **observed** percentiles
   (4/11/23/40/60/77/89/96 cumulative), not at z-score points from an
   assumed normal curve. Short cognitive sections are usually skewed and
   would be badly served by cuts placed as if they were not.
3. Generation always produces **drafts**. Activation is a separate,
   audited act, and the screen first shows how many already-scored
   candidates would change band and by how much.
4. Gates: under 100 cases nothing can be built; 100–199 can be drafted and
   reviewed but never activated; 200 and above can be activated. At 200,
   about eight people define each of the outer bands — thin, but arguable.
   The thresholds live in `src/lib/validation/gates.ts`, named and
   documented so they can be argued with in one place.
5. Promotion is **per dimension**. A report routinely mixes validated
   stanines and provisional bands, says which each one is, and names the
   reference group and its sample size for the stanines.
6. **Invalidated attempts are excluded** from the norming sample. A norm
   table *is* the reference group, so a score somebody already marked
   unreliable would shift the band boundaries for everyone measured against
   it afterwards. The same exclusion applies to validity studies and to the
   applicant pool the range-restriction correction is measured from, and the
   study reports how many were excluded rather than dropping them silently.
7. Distortion and Equivocation are never normed. They flag how to read a
   profile, not where someone stands; a stanine on Distortion would read as
   "distorts more than 77% of applicants", turning a response-quality check
   into a trait comparison.

## Phase 4 — Criterion validity (before any predictive claims)

**Now supported in-product: Admin → Validation.**

The mechanics are built; the evidence still has to be collected, and no
amount of software substitutes for a qualified I/O psychologist reading the
study. What the platform does:

1. **Employment records.** A `Hire` is opened automatically when a candidate
   accepts an offer, freezing the link to the attempt whose scores were in
   front of the people who decided. Hires from before the platform can be
   entered by hand and linked to an attempt.
2. **Performance cycles.** A cycle is one round of ratings — 90-day, annual,
   ad hoc. Criteria are rated 1–5 with written behavioral anchors at 1, 3
   and 5 (`src/content/performance-criteria.ts`). The rating form
   deliberately does **not** use the assessment's dimension names: asking a
   manager to rate "Mental Acuity" invites them to recall the test result
   rather than the work, and the study would then be correlating the test
   with itself.
3. **Studies.** One criterion — overall rating, one competency, a composite,
   an objective metric, or retention to a fixed tenure — correlated against
   every dimension and composite.
4. **What is reported**: Pearson r with a 95% Fisher interval, the Spearman
   rank correlation as a linearity check, an exact two-tailed t-test p, and
   a Benjamini–Hochberg adjusted q. The adjustment is not optional:
   eighteen dimensions against one criterion produce roughly one "significant"
   result at p < .05 by chance, and reading the raw p would manufacture a
   finding about once per study.
5. **Corrections, only where the data supports them.** Range restriction uses
   Thorndike Case II with the applicant-pool standard deviation *measured
   from this platform's own records* — scoped to the same form versions and
   job profile as the sample — rather than an assumed value. Criterion
   unreliability is corrected only where two or more raters actually rated
   the same people, so the reliability is a measured ICC(1,k) rather than an
   invented number. The predictor is never corrected: the test being studied
   is the real one, with its real reliability. Observed values are always
   reported alongside corrected ones.
6. **Verdicts.** Under 20 hires, no coefficient at all. Under 100, everything
   is labelled preliminary whatever its p value. At 100+, a coefficient is
   "Supported" only if q < .05 *and* the interval excludes zero; otherwise it
   is reported as "No relationship" — which is a finding, not a gap.
7. **Technical report.** A PDF following the shape 29 CFR 1607.15B expects of
   criterion-related validity evidence: sample, criterion and why, method,
   results, and — first, and not optional — what the study does *not*
   establish. It is regenerated from a fresh computation each time, so it
   never quotes numbers older than its own date.

What the platform deliberately does **not** do: recommend a benchmark change,
reweight a dimension, or apply a study's findings automatically. A supported
coefficient is a fact about a sample. Changing how a dimension is used in
hiring is a judgement a person makes, having read the whole study.

Differential validity and adverse impact are **out of scope** for these
studies. Both need demographic data and sample sizes well beyond what a local
study has, and estimating them from too few cases produces a number that reads
as reassurance without being evidence. See Phase 5.

## Phase 5 — Fairness / adverse-impact monitoring

1. If FSW chooses to collect voluntary EEO data, enable the separate
   compliance module: data is stored apart from candidate records, is never
   visible on candidate pages, and is never used in scoring.
2. Periodically compare selection rates across groups (e.g., four-fifths
   rule as a screen); investigate flagged dimensions for measurement bias.
3. Keep accommodations effective: timing multipliers, untimed
   administration, camera exemptions, and alternate presentation are
   supported per attempt and audited.

## Standing obligations (already enforced by the software — keep them)

- Same form version and standards for candidates competing for the same
  opening, absent an approved accommodation.
- No automated rejection, ranking, or pass/fail — humans decide.
- Full audit trail and version history for questions, forms, benchmarks,
  scoring, and reports.
- Recording is never analyzed and never affects scores.
- Statistics are computed, never fabricated. `scripts/seed-validation-demo.ts`
  can fabricate a sample so the engine can be *seen working* before real data
  exists — it refuses to run against production, requires
  `--confirm-synthetic`, and names everything it creates "DEMO" so nothing it
  produces can be mistaken for evidence. Purge it with `--purge`.
