# FSW People

**Everything about our people, in one place.**

An internal HRIS/HCM platform for FSW Group and its operating companies (FS Welsford,
ValveMan, and future subsidiaries). It covers the full employee lifecycle: recruiting,
onboarding, the people system of record, time off, time tracking, performance, compensation,
benefits, a payroll-ready data hub, training, equipment, application access, offboarding,
compliance, reporting and workflow automation.

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running it](#running-it)
- [Signing in to the demo data](#signing-in-to-the-demo-data)
- [Database & migrations](#database--migrations)
- [Testing](#testing)
- [Scheduled jobs](#scheduled-jobs)
- [Environment variables](#environment-variables)
- [Production deployment](#production-deployment)
- [Backups](#backups)
- [Further documentation](#further-documentation)

---

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19 | Server Components keep sensitive data on the server; server actions give typed mutations without a separate API surface |
| Language | TypeScript, strict mode | |
| Styling | Tailwind CSS v4 with a design-token theme | Tokens live in `src/app/globals.css`; every colour is a token, none are hard-coded |
| Database | PostgreSQL 16 | |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter | |
| Validation | Zod | Shared between server actions and environment loading |
| Auth | First-party: bcrypt passwords, DB-backed sessions, TOTP MFA | No third-party auth dependency; architected for Entra ID / SAML / SCIM later |
| Email | Outbox pattern with a pluggable driver | Fully testable without a provider key |
| Storage | Driver interface (`local` \| `s3`) | Documents are never publicly addressable |

### Shape of the code

```
prisma/
  schema.prisma            Full HRIS data model (~60 entities)
  migrations/              Includes the append-only audit trigger and
                           circular-manager guard as real SQL
  seed.ts, seed-demo.ts    Roles, org scaffolding, and labelled demo data
src/
  app/
    (auth)/                Login, MFA, activation, password reset
    (app)/                 The authenticated application, one folder per module
    careers/               Public job board — the only unauthenticated content pages
    api/                   Document downloads, audited exports, maintenance sweep,
                           the Indeed job feed and the Indeed Apply webhook
  components/
    ui/                    Design system: index.tsx (server-safe), client.tsx (interactive)
    shell/                 SideNav, TopBar
  lib/
    authz/                 Permission catalog + the single authorization entry point
    people.ts              Worker creation and effective-dated job/comp changes
    lifecycle.ts           Onboarding/offboarding template engine
    pto.ts                 Accrual engine and ledger-derived balances
    workflows.ts           Trigger → condition → action automation engine
    approvals.ts           Reusable sequential approval engine
    compliance.ts          Data-driven compliance rules and retention eligibility
    reports.ts             Report registry powering both the UI and CSV export
    imports.ts             CSV validate-then-apply import engine
    crypto.ts              AES-256-GCM field encryption, TOTP, signed URLs
    indeed.ts              Indeed XML feed generation and Apply signature verification
    ai/                    The only place the app talks to an external model:
                           client.ts (provider), redact.ts (data minimisation),
                           interview-questions.ts (generation + guardrails)
tests/
  unit/                    Pure logic (crypto, formatting, CSV safety)
  integration/             Real database: permission boundaries and HR journeys
```

### Architectural decisions worth knowing

**Effective dating over mutation.** `EmploymentRecord` and `Compensation` are never
updated in place. A change closes the current row (`effectiveTo`) and opens a new one, so
"what was this person's title in March?" is always answerable.

**Balances are derived, never stored.** PTO balance is `SUM(hours)` over
`PtoTransaction`. There is no mutable balance column that could drift out of sync with its
history.

**Authorization is server-side, in one place.** `src/lib/authz/index.ts` builds a `Ctx`
from the session and exposes `can()`, `workerAccess()` and the manager-hierarchy helpers.
Every server action and page calls it. Frontend hiding is a convenience, never the control.

**Compliance rules are data.** Jurisdiction, authoritative source URL, applicability,
deadline calculation, severity, owner and review date all live in the `ComplianceRule`
table. Laws change; the application does not need a deploy when they do.

**Onboarding starts in the service layer, not only in a workflow.** `createWorker()` calls
`startLifecycle()` directly so a new hire can never silently end up without a checklist if
an admin disables the automation. `startLifecycle()` is idempotent, so a workflow that also
runs `START_ONBOARDING` will not create a second instance.

**Job boards are a feed, not an API call.** Indeed sources jobs by crawling XML you host,
so "published" means "in the feed" and the UI says exactly that, showing when Indeed last
fetched rather than claiming a listing is live. Inbound Indeed Apply deliveries are
HMAC-verified against the raw request bytes and deduplicated by a unique
`Application.sourceRef`, so a webhook retry cannot create a second application. Every
delivery — including the ones we refuse — is written to an append-only `JobBoardDelivery`
log that records what happened, not a second copy of the applicant's contact details.

**AI is advisory, minimal and screened.** `src/lib/ai` is the only path to an external
model. It runs after the caller's permission check, on data that caller could already read,
and sends the least it can: a first name, a résumé with contact details and identifiers
redacted, and the job text. Generated interview questions are screened in code for
protected characteristics before they are stored — the model's instructions are a request,
the screen is the enforcement. Nothing the AI returns can advance, rate or reject a
candidate.

---

## Prerequisites

- Node.js 20+ (developed on 22)
- PostgreSQL 16+
- npm

---

## Setup

```bash
git clone <repo> && cd fsw-people
npm install

cp .env.example .env
# Generate the three required secrets:
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # FIELD_ENCRYPTION_KEY (must be exactly 32 bytes of hex)
openssl rand -hex 32   # DOCUMENT_URL_SIGNING_KEY
```

Create the database and apply the schema:

```bash
createdb fsw_people
npx prisma migrate deploy
npm run db:seed
```

`db:seed` creates the ten system roles with their permissions, FSW Group with FS Welsford
and ValveMan, the Exton HQ and Philippines-remote locations, US and Philippine holiday
calendars, PTO policies, onboarding/offboarding templates, compliance rules with their
source URLs, retention policies, and a set of **clearly labelled fictional demo workers**
(`Worker.isDemo = true`). No real SSNs, bank accounts or government identifiers are ever
seeded.

---

## Running it

```bash
npm run dev          # http://localhost:3000
npm run build        # production build
npm start            # serve the production build
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply pending migrations (production) |
| `npm run db:seed` | Seed roles, org scaffolding and demo data |
| `npm test` | Full test suite (unit + integration) |
| `npm run lint` | ESLint |
| `node scripts/smoke.mjs` | Sign in with a headless browser and walk every page |

---

## Signing in to the demo data

| Account | Password | Sees |
|---|---|---|
| `admin@fswelsford.com` | `FswPeople!Demo2026` | Super Admin — everything |
| `dana.reyes@fswelsford.com` | `FswPeople!Demo2026` | HR Admin |
| `miguel.torres@fswelsford.com` | `FswPeople!Demo2026` | Manager (VP Operations) |
| `tyler.brooks@fswelsford.com` | `FswPeople!Demo2026` | Employee self-service |
| `joshua.villanueva@fswelsford.com` | `FswPeople!Demo2026` | Philippines contractor |
| `sam.okafor@fswelsford.com` | `FswPeople!Demo2026` | IT Administrator |
| `olivia.chen@fswelsford.com` | `FswPeople!Demo2026` | Payroll / Finance |

Signing in as different personas is the fastest way to see the permission model working:
the manager sees their reports' PTO and goals but not their pay or SSN; IT sees equipment
and access but no HR data at all.

**Change or remove these accounts before any real deployment.**

---

## Database & migrations

```bash
npx prisma migrate dev --name describe_your_change   # development
npx prisma migrate deploy                            # production
npx prisma studio                                    # inspect data
```

Two migrations contain hand-written SQL that is part of the security model:

- `audit_immutability` — a trigger that raises on any `UPDATE` or `DELETE` against
  `AuditEvent` and `DocumentSignature`, so the audit trail cannot be rewritten even by
  someone holding the application's database credentials.
- The same migration adds `fsw_check_manager_cycle()`, which walks the reporting chain on
  insert/update of `EmploymentRecord` and rejects circular management structures.

Both are covered by tests in `tests/integration/journeys.test.ts`.

---

## Testing

```bash
npm test                                  # everything
npx vitest run tests/unit                 # fast, no database
npx vitest run tests/integration          # requires fsw_people_test
npx vitest                                # watch mode
```

Integration tests need a dedicated database:

```bash
createdb fsw_people_test
DATABASE_URL="postgresql://…/fsw_people_test" npx prisma migrate deploy
```

`tests/setup.ts` automatically rewrites `DATABASE_URL` to point at `fsw_people_test`, so a
test run can never touch development data.

The suite covers field encryption and tamper detection, TOTP drift, signed-URL forgery, CSV
formula-injection escaping, PTO accrual and ledger math, every role's permission boundaries,
manager hierarchy resolution, and end-to-end HR journeys (hire → onboarding → job change →
PTO → approval → offboarding → termination), plus the append-only audit guarantee.

For the job-board and AI features it also covers Indeed feed token comparison and XML
escaping, Apply signature verification against the raw bytes, webhook idempotency and
rejection logging, résumé redaction, and the protected-characteristic screen on generated
interview questions.

### Verification scripts

These run against a **running** server with the demo seed, and check behaviour the unit and
integration tests cannot: that the real UI is wired to the real server action.

```bash
npm run build && npm start &
npx tsx scripts/verify-mfa-fix.ts        # a password-only session cannot disable MFA
npx tsx scripts/verify-indeed-flow.ts    # publish → feed → careers page → signed webhook
npx tsx scripts/verify-ai-questions.ts   # the AI panel reports an outcome, never nothing
```

`verify-ai-questions.ts` checks the not-configured path by default. Give it a real
`ANTHROPIC_API_KEY` to exercise a full generation, including that exactly five questions are
stored with their model and basis.

---

## Scheduled jobs

One idempotent daily sweep handles everything time-based: birthdays, work anniversaries,
approaching start dates, expiring documents and contractor agreements, overdue training,
unreturned equipment, PTO accruals, and failed-email retries.

```bash
curl -X POST https://your-host/api/internal/maintenance \
  -H "Authorization: Bearer $CRON_SECRET"
```

Set `CRON_SECRET` in the environment and point any scheduler at it daily. A Super Admin can
also run it on demand from **Admin → Workflows → Run daily sweep now**. Running it twice in
one day is a no-op — workflow dedupe keys and status guards make it safe.

---

## Environment variables

See [`.env.example`](.env.example) for the annotated list. Required: `DATABASE_URL`,
`SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `DOCUMENT_URL_SIGNING_KEY`, `APP_BASE_URL`,
`STORAGE_DRIVER`. Everything else is optional and the application degrades gracefully
without it — email falls back to a viewable in-app outbox, and unconfigured integrations
are shown as "not configured" rather than failing.

`src/lib/env.ts` validates all of it at startup with Zod and fails fast with a readable
message naming the specific variable.

Two optional groups are worth calling out:

- **Indeed** — `INDEED_FEED_TOKEN` (protects the job feed Indeed crawls) and
  `INDEED_APPLY_SECRET` (verifies inbound applications). Both should be
  `openssl rand -hex 32`. With neither set, both endpoints return 404 and the publish
  controls stay disabled rather than failing when clicked. See
  [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md#posting-jobs-to-indeed).
- **AI** — `ANTHROPIC_API_KEY`, optionally `AI_MODEL` (default `claude-opus-5`). Without a
  key the AI panels say the feature is not configured.

---

## Production deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for exact steps. In short: managed PostgreSQL, private
object storage, a real SMTP provider, all secrets from a secrets manager, `migrate deploy`
on release, and a daily scheduler hitting the maintenance endpoint.

## Backups

See [`DEPLOYMENT.md`](DEPLOYMENT.md#backup-and-recovery) for the backup schedule, the
encrypted off-site copy, and the **restore runbook** — including the quarterly restore
rehearsal. HR data must not depend on hoping the cloud provider has a backup.

---

## Further documentation

| Document | Contents |
|---|---|
| [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) | Day-to-day HR administration: users, permissions, onboarding, PTO, performance, reports, workflows, compliance, integrations |
| [`SECURITY.md`](SECURITY.md) | Authentication, encryption, the permission model, audit logging, secrets, incident handling |
| [`DATA_MODEL.md`](DATA_MODEL.md) | Core entities and relationships, effective dating, data integrity constraints |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Production deployment, backups, restore runbook, observability |
| [`BENCHMARK_MATRIX.md`](BENCHMARK_MATRIX.md) | Feature comparison against category-leading HR platforms, with honest gaps |
