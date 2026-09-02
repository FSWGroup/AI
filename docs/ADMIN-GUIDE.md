# FSW Talent Scout — Administrator Guide

## Roles

| Role | Can |
| --- | --- |
| Super Admin | Everything, including settings, retention, legal holds, users |
| HR Admin | Candidates, invitations, attempts (invalidate/retest/accommodations), results, reports, recordings (default), benchmarks, audit log |
| Hiring Manager | View candidates and reports **only for assigned job profiles**; no recordings by default |
| Assessment Administrator | Question bank, forms, norms, benchmarks, Assessment Quality |
| Viewer | Read-only candidates/reports |

Recording access is a configurable allowlist in Settings (default: Super
Admin + HR Admin). Every recording view and every consequential action lands
in the append-only Audit Log.

## First-run setup (Settings)

1. Company name, privacy contact, accommodation contact, HR notification
   email.
2. Review the recording/privacy notice and tick "privacy notice configured".
3. Set retention days per record type (answers, scores/reports, invitations,
   integrity logs, recordings, audit records) — with counsel; there is no
   safe universal default. Schedule `npm run retention:run` daily.
4. Confirm object storage and HTTPS. **In production, webcam invitations
   stay disabled until notice + recording retention + storage + HTTPS are
   configured.**
5. Decide on the two **Fairness and candidate experience** switches, both
   off by default: voluntary self-identification (feeds the benchmark
   impact preview) and the candidate summary. Review the candidate-facing
   wording with counsel before turning either on —
   `docs/FAIRNESS-AND-FEEDBACK.md` explains what each one shows and what it
   deliberately withholds.

## Day-to-day flow

1. **Job Profiles** — create a profile (mark sales roles to enable the
   11-trait analysis; enable the leadership module only where relevant).
   Open it to set each dimension's desired 1-9 range by clicking bands,
   plus required/enabled/weight/note, and the areas-of-concern rules
   (flag-at-or-below thresholds). Saving is audited with before/after
   values. `/admin/jobs/{id}/compare` shows completed candidates
   side-by-side against the benchmark — alphabetically, never ranked.
2. **Invite** — Candidates → Invite candidate: name, email, opening,
   expiry. The candidate gets a secure expiring link; emails never contain
   questions or scores. In development the launch link is shown on screen
   and stored in the email outbox table.
3. **Monitor** — Dashboard shows pipeline counts; the Candidates table
   supports search and status filters and shows integrity status and report
   availability per attempt.
4. **Review** — a candidate's page has tabs:
   - *Overview*: dates, sections, accommodations.
   - *Results*: the 1-9 score sheet against the benchmark.
   - *Narrative Report*: web report + PDF download.
   - *Integrity*: summary level, the objective event log, consent records.
   - *Recording*: gated by role, shows the review-purpose reminder, plays
     chunked sessions via expiring URLs; deletion is blocked by legal holds.
   - *Administration*: authorize retest (new invitation; old attempts are
     never overwritten), grant accommodations (extended time, untimed,
     camera exemption, alternate presentation, in-person), recalculate
     scores (explicit; creates a new report version), invalidate with a
     required reason, and add audited notes.
5. **Question bank** (Assessment Administrator) — filter by construct and
   status; move items Draft → Review → Approved → Retired (only approved
   items can be pooled onto forms); edits create new immutable versions and
   return the item to Draft; export JSON for review. Dated current-awareness
   items get an expiry date and go through the same approval workflow.
6. **Assessment Quality** — anonymous aggregate item statistics and the
   norm-table registry. Everything is labeled provisional until real sample
   sizes exist; install norm tables only from actual calibration data.

## Candidate-facing notes worth knowing

- Candidates must use a desktop/laptop; phones and tablets see a
  professional block screen. Accessibility exceptions are granted via the
  attempt's accommodation overrides.
- The entry flow: welcome (70-minute notice) → identity confirmation →
  rules acknowledgment → accommodation notice → recording consent (never
  pre-checked) → camera preflight → Record ID / recovery info →
  instructions → begin.
- Timers are server-side. Refreshes and disconnects never add time; answers
  autosave with an offline queue; a resume link can be re-emailed from the
  invitation page and restores the exact session (same questions, answers,
  and remaining time). Completed timed sections never reopen.
- On completion candidates see a thank-you page. No scores and no pass/fail
  are shown to them anywhere, under any setting.
- If the **candidate summary** is enabled, the completion screen offers each
  candidate a developmental summary of their own results. It carries no
  scores, no benchmark comparison, no validity indicators, and nothing about
  the hiring outcome. It lives in their browser session, so it tells them to
  save a copy.
- If **voluntary self-identification** is enabled, they are asked for
  optional demographic information after they submit. Every question can be
  declined and the whole form skipped. It never reaches a report.

## Sending results to a colleague

The candidate's **Download PDF** tab exports the complete assessment as a
single file — executive summary and score sheet first, then every section
through to the integrity log and a plain-English guide to reading it. The
tab lists exactly what the file contains before you download it.

Two things are never in it: the webcam recording (who may view one is a
separate audited permission that a PDF cannot carry) and the candidate's
résumé (their document, not ours to forward). Your name and the export time
are stamped on the cover and the download is audited, so a forwarded copy
can be traced back.

## Data & compliance

- Legal holds (Settings) block deletion by scope: `GLOBAL`,
  `CANDIDATE:<id>`, or `ATTEMPT:<id>`.
- The retention job deletes database rows and storage objects together and
  logs a per-type summary to the audit trail.
- The benchmark editor's **impact preview** shows how a proposed set of
  ranges would screen the candidates already assessed, and — once voluntary
  self-identification is on and there is enough data — the four-fifths
  selection-rate ratios. Use it before you save a benchmark, not after.
- The admin-only disclaimer shown in Settings applies everywhere: FSW
  Talent Scout is decision-support software and should not be the sole basis for
  an employment decision. See `docs/VALIDATION-ROADMAP.md` before relying
  on it heavily for selection.
