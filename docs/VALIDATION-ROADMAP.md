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

1. Define the reference population (e.g., applicants to FSW technical sales
   roles over a period).
2. From real score distributions, derive raw-score cut points per band
   (classical stanine: ~4/7/12/17/20/17/12/7/4% of the distribution).
3. Install them as `NormTable` rows (construct, population, sample size,
   methodology, effective date, thresholds). From that moment the construct
   reports validated stanines; earlier reports remain reproducible under
   their provisional bands.

## Phase 4 — Criterion validity (before any predictive claims)

1. Collect job-performance criteria (ratings, quota attainment, retention)
   for assessed hires, under a documented governance plan.
2. Correlate assessment dimensions/composites with criteria
   (concurrent and/or predictive designs); involve a qualified I/O
   psychologist.
3. Only validated relationships justify predictive language or any
   quantitative "fit" model — and only for the roles studied.

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
