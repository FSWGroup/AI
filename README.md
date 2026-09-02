# FSW WorkFit Assessment

FSW Group's independent pre-employment and employee-development assessment
platform. Candidates complete a proctored, webcam-recorded assessment of six
mental aptitudes, ten performance/behavioral dimensions, and two
response-quality indicators; authorized FSW personnel configure job
benchmarks, review 1-9 score sheets against desired ranges, and generate
narrative reports with targeted interview guides and development
recommendations.

FSW WorkFit is an original FSW Group instrument. It is not affiliated with,
licensed by, or equivalent to any third-party assessment product, and all
questions, scoring logic, narratives, and visual design are original.

> **Employment-testing notice.** Assessment instruments used for employment
> decisions should be evaluated for job relevance, reliability, validity,
> accessibility, and potential adverse impact. FSW WorkFit is
> decision-support software and should not be the sole basis for an
> employment decision. See `docs/VALIDATION-ROADMAP.md`.

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4, small in-repo UI kit (`src/components/ui.tsx`) |
| Database | PostgreSQL + Prisma ORM |
| Auth | Server-side sessions (bcrypt password hashes, HMAC-hashed session tokens, httpOnly cookies), five-role RBAC |
| Object storage | Abstraction over local disk (dev) and any S3-compatible store (presigned PUT/GET) — `src/lib/storage/` |
| Recording | Browser `MediaRecorder`, video-only, ~10s chunks → IndexedDB queue → direct upload to storage via short-lived signed URLs |
| PDF | Headless Chromium (playwright-core) printing a signed, print-styled report route |
| Email | Provider abstraction; dev "console" provider persists to an outbox table |
| Validation | Zod on every API input |
| Tests | Vitest (scoring/logic units), Playwright (E2E with fake camera) |

Key directories:

```
prisma/                 schema + migrations + seed
src/content/            original question banks + narrative templates (typed)
src/lib/scoring/        deterministic scoring engine (pure, unit-tested)
src/lib/attempt/        attempt engine: frozen question sets, server timers
src/lib/report/         report generation, selection rules, PDF
src/lib/storage/        local + S3 object storage providers
src/app/assessment/     candidate flow (entry screens, section runner)
src/app/admin/          employer portal
src/app/api/            candidate + admin route handlers
docs/                   methodology, privacy, validation, admin guide
tests/unit/  e2e/       Vitest + Playwright suites
```

## Local setup

Prerequisites: Node 22+, PostgreSQL 14+.

```bash
npm install
createdb fsw_workfit                      # or any Postgres database
cp .env.example .env                      # then edit DATABASE_URL + APP_SECRET
npx prisma migrate deploy                 # apply migrations
npm run db:seed                           # question bank, form v1, Welsford profile,
                                          # Alex Sample fixture, dev admin accounts
npm run dev                               # http://localhost:3000
```

Dev sign-in (seeded only outside production; password `fsw-workfit-dev` or
`SEED_ADMIN_PASSWORD`):

| Email | Role |
| --- | --- |
| `super@fsw.local` | Super Admin |
| `hr@fsw.local` | HR Admin |
| `manager@fsw.local` | Hiring Manager (job-scoped, no recording access) |
| `psych@fsw.local` | Assessment Administrator |
| `viewer@fsw.local` | Viewer |

Invite a candidate from **Candidates → Invite candidate**; in development the
result screen shows the launch link directly (the "console" email provider
also stores the full email in the `EmailMessage` outbox table).

## Environment variables

See `.env.example`. Summary:

- `DATABASE_URL` — Postgres connection string.
- `APP_SECRET` — 64+ hex chars; signs sessions, resume tokens, playback URLs
  (`openssl rand -hex 32`).
- `APP_BASE_URL` — public base URL used in emails and signed links.
- `STORAGE_PROVIDER` — `local` (dev) or `s3`; with `s3` set `S3_ENDPOINT`,
  `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
  The bucket must be **private**.
- `EMAIL_PROVIDER` — `console` (dev outbox) or wire a real provider in
  `src/lib/email/index.ts`.
- `CHROMIUM_PATH` — Chromium executable for PDF rendering.
- `SEED_ADMIN_PASSWORD` — dev seed password override. Never ship known
  passwords to production; the seed refuses to create dev users there.

## How the platform works

- **Question bank** — 830+ original items across seven sections, stored as
  immutable `QuestionVersion` snapshots with a Draft → Review → Approved →
  Retired workflow. Only approved questions can appear on forms. Bulk JSON
  export exists at Admin → Question Bank; import by POSTing the same shape
  to `/api/admin/questions`.
- **Forms & fairness** — an `AssessmentVersion` freezes sections, timers,
  question pool, scoring and narrative versions. Every attempt records its
  version and its exact served question list, so historical attempts render
  forever even after edits. Selection is randomization within equivalent
  difficulty buckets (for the behavioral inventory, buckets are constructs,
  guaranteeing balanced coverage).
- **Timing security** — timed sections store `startedAt/expiresAt`
  server-side; the browser countdown is display only. Refreshes, clock
  changes, and disconnects never add time; expiry locks unanswered items.
- **Scoring** — deterministic and reproducible (same answers + form +
  scoring version + norms ⇒ identical scores). Raw scores are never
  destroyed. 1-9 bands are **provisional** internal bands until a real
  `NormTable` (population, sample size, methodology, effective date) is
  installed, after which the construct reports validated **stanines**. See
  `docs/ASSESSMENT-METHODOLOGY.md`.
- **Benchmarks** — per-job desired ranges (1-9) per dimension, edited
  visually; above range is not automatically better. Configurable
  areas-of-concern rules flag "Additional Interview Attention Recommended" —
  never automatic failure. There is no ranking view and no automated
  hire/reject anywhere.
- **Recording** — video only, consented, chunked to private object storage,
  never analyzed, never scored, with audited least-privilege playback.
  See `docs/RECORDING-PRIVACY.md`.
- **Reports** — web + PDF: executive summary, per-dimension narratives,
  response-validity section with raw trigger measurements, the 1-9 score
  sheet, 11-trait sales analysis (transparent DB-backed formulas), optional
  leadership module, targeted interview guide, development recommendations,
  and an employer-only integrity appendix.
- **Retention & legal hold** — per-record-type retention policies drive the
  scheduled deletion job (`npm run retention:run` via cron); active legal
  holds block deletion in both the app and the job; DB and object-store
  deletions happen together. All of it is audited.

## Testing

```bash
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm test              # Vitest unit tests (scoring, validity, selection, RBAC…)
npm run test:e2e      # Playwright: full candidate journey with a fake camera,
                      # timer-safe refresh, recording upload, RBAC denials
```

E2E uses Chromium's `--use-fake-device-for-media-stream`, so no physical
camera is needed; global setup creates a miniature E2E form (retired again on
teardown) so runs finish in seconds.

## Deployment

**Netlify (fastest path):** the repo ships `netlify.toml` and a build
pipeline that migrates, seeds, and bootstraps your admin account from env
vars — see **`docs/DEPLOY-NETLIFY.md`** for the 15-minute runbook
(hosted Postgres + `STORAGE_PROVIDER=netlify` for recordings in private
Netlify Blobs; PDFs via the report's Print button there).

**Generic Node host:**

1. Provision PostgreSQL and a **private** S3-compatible bucket.
2. Set the environment variables above (`STORAGE_PROVIDER=s3`, real
   `APP_SECRET`, HTTPS `APP_BASE_URL`).
3. `npx prisma migrate deploy`, then run the seed only for content
   (`db:seed` skips dev users in production) and create real admin users.
4. `npm run build && npm start` behind HTTPS. PDF generation needs a
   Chromium binary (`CHROMIUM_PATH`); on serverless platforms run PDF
   rendering in a container/worker or wire `@sparticuz/chromium`.
5. Schedule `npm run retention:run` (daily cron).
6. Back up Postgres (e.g. `pg_dump`) and the recordings bucket on your
   normal schedule; recordings and PDFs live only in object storage.
7. In **Admin → Settings**, complete first-run configuration: contacts,
   privacy notice, retention, storage + HTTPS confirmation. In production
   the app refuses webcam invitations until privacy notice, recording
   retention, object storage, and HTTPS are configured.

## Security highlights

- Candidate payloads never contain answer keys, constructs, weights, or
  internal IDs; only the current section is ever sent to the browser, and
  objective questions are scored server-side.
- Invitation/resume tokens are 256-bit, stored hashed, expiring, and
  single-purpose; sessions are httpOnly + SameSite cookies; login and
  sensitive candidate endpoints are rate limited.
- Job-scoped roles cannot reach other jobs' candidates by editing URLs
  (checked server-side on every read).
- The audit log is append-only — no code path edits or deletes it.
- Recordings: private bucket, short-lived signed URLs, audited access,
  configurable role allowlist (default SUPER_ADMIN + HR_ADMIN), and **no
  biometric or content analysis of any kind** (see
  `docs/RECORDING-PRIVACY.md`).

## Documentation

- `docs/AI-FEATURES.md` — the résumé/interview brief and job-description
  benchmark proposals: setup, guardrails, and why they are shaped that way.
- `docs/DEPLOY-NETLIFY.md` — click-by-click hosted deployment runbook.
- `docs/ASSESSMENT-METHODOLOGY.md` — constructs, item types, scoring,
  validity indicators, bands vs stanines, composites, selection rules.
- `docs/RECORDING-PRIVACY.md` — recording architecture and protections.
- `docs/VALIDATION-ROADMAP.md` — what FSW must do before treating results
  as validated predictors.
- `docs/RECRUITING.md` — the ATS: requisitions, job feeds and multi-source
  intake, pipeline, structured interviewing, offers, and funnel-wide adverse
  impact.
- `docs/REVIEWS-AND-CHECKS.md` — independent team review and the consolidated
  ratings view, the consent-based social media workflow, and the Checkr
  background-check integration with the FCRA adverse-action sequence.
- `docs/PDF-EXPORT.md` — the complete assessment export: what is in it, what
  is deliberately left out, and how it is rendered.
- `docs/FAIRNESS-AND-FEEDBACK.md` — the benchmark impact preview, voluntary
  self-identification, the candidate summary, and the one-page manager brief.
- `docs/ADMIN-GUIDE.md` — operating the system day to day.

## Known limitations

- Real email delivery requires wiring a provider (`src/lib/email/index.ts`).
- Norm tables must be imported from actual calibration data; until then all
  bands are provisional and labeled as such.
- **Getting results as a PDF.** A candidate's **Download PDF** tab exports
  the complete assessment as one file — summary and score sheet first, then
  every section including the interview guide, session record, and integrity
  log. It is generated with `pdf-lib` (pure JavaScript), so it works on every
  host including serverless functions with no Chromium, and the download is
  audited. See `docs/PDF-EXPORT.md`.
- The report views are also print-styled, so **Print / Save as PDF** produces
  a clean document from any of them (the manager brief prints to exactly one
  sheet). The older server-side renderer at `/api/admin/attempts/:id/pdf`
  prints the web report through headless Chromium and still needs a browser
  binary at runtime; the complete export above replaced it in the UI.
- The EEO/adverse-impact module is off by default and collects nothing until
  FSW switches it on in Settings. Once on, the four-fifths table still needs
  30+ scored candidates with 5+ per group before it reports a ratio; below
  that it says so rather than showing a number.
- The candidate summary is reachable only from the candidate's own browser
  session, so it must be saved at the time. See
  `docs/FAIRNESS-AND-FEEDBACK.md`.
