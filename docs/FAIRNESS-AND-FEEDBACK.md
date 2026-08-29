# Adverse-impact preview, candidate summary, and the manager brief

Three features that sit around the report rather than inside it. All three
are read-only views over data the platform already stores — none of them
introduces a new score, and none of them produces a hiring decision.

## 1. Impact preview (benchmark editor)

Where: **Job Profiles → a profile → benchmark editor**, above the dimension
rows. It updates as you drag ranges, 450 ms after you stop editing. Nothing
is saved until you press **Save benchmark** — the preview is deliberately a
"before you commit" tool, because a benchmark is much easier to reconsider
before it has screened anyone.

It answers two separate questions.

**How would these ranges screen the people already assessed for this role?**
Always available; needs no demographic data. It shows how many of the
already-completed candidates would fall inside every *required* range, and
which dimensions are doing the excluding. A required range that alone
excludes most of the pool is usually a range that is too narrow or set too
high — not evidence that the applicants are unsuitable, which is why the
copy says exactly that.

**Do these ranges produce selection-rate disparities?** Only when the
voluntary self-identification module is on and enough candidates have
answered. The table applies the four-fifths rule from the Uniform Guidelines
on Employee Selection Procedures (29 CFR 1607): the group with the highest
selection rate becomes the reference, every other group's rate is divided by
it, and a ratio below 0.80 is flagged.

Thresholds, all in `src/lib/analytics/impact.ts`:

| Constant | Value | Why |
| --- | --- | --- |
| `MIN_TOTAL_FOR_ANALYSIS` | 30 | Below this, ratios move wildly on one person. |
| `MIN_GROUP_SIZE` | 5 | A group of 2 produces a meaningless 0% or 100%. |
| `FOUR_FIFTHS` | 0.8 | The Uniform Guidelines threshold. |

Under those minimums the panel says "not enough data yet" rather than
showing a number — a ratio computed from four people is worse than no ratio,
because it looks authoritative.

**What this is not.** A ratio below 0.80 is not a finding of
discrimination, and a ratio above it is not a clean bill of health. The
four-fifths rule is a screen that prompts a job-relatedness review. The
panel says so on screen, and it is worth repeating here: discuss results
with counsel before acting on them.

### Voluntary self-identification

Off by default. Turn it on in **Settings → Fairness and candidate
experience**. When on, candidates are asked — *after* they submit, so it
cannot influence anything — for optional sex, race/ethnicity, veteran, and
disability information. Every question has "I prefer not to say", and
skipping the whole form is one click.

The data lands in `EeoRecord`, a table with **no foreign key** to the
candidate or attempt — only opaque reference strings. No report query, no
candidate page, and no admin list can join to it. It is read by exactly one
thing: the aggregate analysis above, which returns counts and ratios and
never individual rows. Writing it is deliberately *not* audited against the
candidate, because an audit row naming who self-identified would defeat the
separation the table exists to create.

Without this module the impact preview still works — you just get the pool
half, not the ratio half.

## 2. Candidate summary

Off by default; **Settings → Fairness and candidate experience**. When on,
the completion screen offers the candidate a summary of their own results.

What it contains: their strongest aptitude areas, their working-style
preferences described as preferences, up to three development suggestions,
and a plain explanation of what the assessment measured.

What it deliberately excludes:

- any benchmark comparison or in-range / below / above indicator
- pass, fail, or anything about the hiring outcome
- the response-validity indicators (distortion, equivocation)
- integrity events and recording data
- **the numeric 1-9 band**, which invites over-reading a single number

The wording is separate content, not a rewrite of the employer report. The
employer-facing definitions in `dimension-meta.ts` are written *about* a
candidate ("Reflects the candidate's reported tendency to…") and talk in
terms of higher and lower results; handed to the person they describe, that
reads coldly and invites exactly the score-hunting the summary avoids. The
candidate-facing copy lives in
`src/content/narratives/candidate-dimension-copy.ts`.

This shape follows the applicant-reactions literature: explaining the
process improves fairness perceptions, while raw performance feedback to
rejected candidates can do harm. So the summary is developmental and
strengths-first, and it is useful whatever the hiring outcome turns out to
be.

**Known limitation:** the summary is reachable from the candidate's own
browser session (their attempt cookie). If they close the browser without
saving it, they cannot get back to it — admins cannot issue a resume link
for a completed attempt, and widening the invitation token to restore a
finished session would let anyone holding a forwarded link read it. The
page tells the candidate to save a copy, and offers Print / Save as PDF.

## 3. Hiring manager brief

**Candidates → a completed candidate → Report tab → Hiring manager brief**,
or the *One-page brief* link on the full report. It prints to a single
sheet.

It is a view over the stored report payload — `buildManagerBrief()` reads
nothing else and computes no new score. That matters: if the brief and the
report could disagree, the brief would be a second, unvalidated instrument.

It shows how many required dimensions fall inside range, the ones that line
up, the ones worth exploring, four interview questions taken verbatim from
the full report's guide, and how much confidence the results deserve
(response quality, session integrity, concern flags, band type).

The count of required dimensions inside range is a **fact, not a verdict**.
Turning it into a hire/pass recommendation would be an automated employment
decision, which this product does not make anywhere. There is no overall fit
score, no ranking, and no recommendation field — `tests/unit/manager-brief.test.ts`
asserts that.

Above-range never counts as a strength. A band above the target range is
listed under "worth exploring" with a note that higher is not automatically
better — the range describes the pattern the role calls for, in both
directions.

The brief carries the same permission gate (`VIEW_REPORTS`), the same job-
profile scoping, and the same audit entry as the full report, because it is
the same data.
