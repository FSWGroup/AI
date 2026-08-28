# FSW Academy

Internal training, SOP, onboarding, compliance, knowledge-management, and AI
learning platform for FSW Group.

FSW Academy answers four questions for every employee:

1. What am I supposed to know?
2. How am I supposed to do my job?
3. What training do I still need to complete?
4. Where can I immediately find the answer when I forget something?

The platform's core idea is that one written procedure should be able to exist
simultaneously as an **SOP**, a **training lesson**, **AI-searchable knowledge**,
a **video**, and an **assessment** — without maintaining five separate copies.

---

## Table of contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Local setup](#local-setup)
- [Development accounts](#development-accounts)
- [Commands](#commands)
- [Configuration](#configuration)
- [Running the background worker](#running-the-background-worker)
- [Testing](#testing)
- [Deployment](#deployment)
- [Further documentation](#further-documentation)

---

## What it does

**Knowledge and procedure**
- SOPs and policies as first-class objects with a block editor, immutable
  version history, approval workflow, review cycles, and change-impact analysis
- Report-outdated-information routing to the SOP owner
- Knowledge library, global search with typo tolerance, favorites, recently viewed

**Training**
- Visual course builder: course → section → lesson → activity, 25 lesson types
- Video-first learning with real playback tracking (opening a video is not completion)
- Assessments with 10 question types, attempt history, and per-attempt evidence
- Learning paths with relative due dates ("Day 1", "Week 1", "Day 30")
- Certificates as generated PDFs, with recertification cycles

**People and compliance**
- People directory, org chart, positions with required training and skills
- Automatic assignment engine driven by combinable rules
- Training requirements matrix, compliance center, immutable training evidence
- Electronic acknowledgements and signatures tied to an exact content version
- Skills library with manager practical sign-off

**AI**
- Ask FSW AI: retrieval-augmented answers with clickable citations, filtered by
  the asking user's permissions *before* retrieval
- AI drafting of SOPs, courses, and quiz questions — always as drafts for review
- AI Video Studio: SOP → objectives → script → storyboard → narration →
  FSW-branded MP4, with source-version tracking

**Platform**
- Granular RBAC enforced server-side, audit trail, field-level encryption
- Report engine with CSV/XLSX/PDF export
- REST API with scoped keys, webhooks, integration center
- WCAG 2.2 AA target, responsive from phone to desktop

---

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22 or later | |
| PostgreSQL | 16 or later | Needs `pgvector`, `pg_trgm`, `unaccent` |
| ffmpeg | any recent | Only for rendering AI videos |

No AI, email, or storage credentials are required to run the application. Those
capabilities disable themselves cleanly when unconfigured.

---

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Provision PostgreSQL

The `pgvector` extension must be installable. On Debian/Ubuntu:

```bash
sudo apt-get install -y postgresql-16 postgresql-16-pgvector
```

Create the user and databases (the shadow and test databases are used by
`prisma migrate dev` and the integration test suite):

```bash
sudo -u postgres psql -c "CREATE USER fsw WITH PASSWORD 'fsw_dev_password' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE fsw_academy OWNER fsw;"
sudo -u postgres psql -c "CREATE DATABASE fsw_academy_shadow OWNER fsw;"
sudo -u postgres psql -c "CREATE DATABASE fsw_academy_test OWNER fsw;"
```

Docker alternative:

```bash
docker run -d --name fsw-postgres \
  -e POSTGRES_USER=fsw -e POSTGRES_PASSWORD=fsw_dev_password \
  -e POSTGRES_DB=fsw_academy -p 5432:5432 \
  pgvector/pgvector:pg16
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Then set the three required values in `.env`:

```bash
# Generate two independent 32-byte secrets
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → FIELD_ENCRYPTION_KEY
```

```dotenv
DATABASE_URL="postgresql://fsw:fsw_dev_password@localhost:5432/fsw_academy?schema=public"
SHADOW_DATABASE_URL="postgresql://fsw:fsw_dev_password@localhost:5432/fsw_academy_shadow?schema=public"
AUTH_SECRET="<generated>"
FIELD_ENCRYPTION_KEY="<generated>"
```

> `FIELD_ENCRYPTION_KEY` encrypts sensitive profile fields. If it is lost, those
> values cannot be recovered. Back it up separately from the database.

### 4. Run migrations and seed

```bash
npm run db:migrate      # applies migrations
npm run db:seed         # roles, org structure, demo people and content
```

### 5. Start the application

```bash
npm run dev             # http://localhost:3000
```

In a second terminal, start the worker so reminders, AI jobs, and video renders
process:

```bash
npm run worker
```

Sign in at http://localhost:3000 with any account from the table below.

---

## Development accounts

All seeded accounts share the password from `SEED_PASSWORD`, which defaults to:

```
FswAcademy!2026
```

**These accounts exist only in development seed data. Never seed a production
database.**

| Email | Role | What it demonstrates |
|---|---|---|
| `admin@fswelsford.com` | Super Administrator | Everything, including audit and sensitive fields |
| `hr.admin@fswelsford.com` | HR Administrator + Manager | People records, privacy tools, sensitive fields |
| `training.admin@fswelsford.com` | Training Administrator | Course/SOP authoring, publishing, AI tools |
| `compliance@fswelsford.com` | Compliance Administrator | Compliance center, exemptions, audit review |
| `sales.manager@fswelsford.com` | Manager + Instructor | Team dashboards, sign-offs, live sessions |
| `jordan.pace@fswelsford.com` | Learner (recent hire) | The onboarding experience and learner dashboard |
| `kim.harlow@fswelsford.com` | Learner + SME | Content review as a subject matter expert |
| `dev.singh@fswelsford.com` | Learner (warehouse) | Safety training and practical sign-off |
| `ph.manager@fswelsford.com` | Manager (Philippines) | Timezone handling, non-US team management |
| `ph.contractor@fswelsford.com` | Contractor (Philippines) | The deliberately narrowed contractor surface |
| `us.contractor@fswelsford.com` | Contractor + Author | US contractor with authoring rights |
| `author@fswelsford.com` | Content Author | Authoring without publish authority |
| `auditor@fswelsford.com` | Auditor | Read-only access to records and audit history |
| `ar@fswelsford.com` | Learner (accounting) | Department-scoped assignment rules |

Sign in as `jordan.pace@fswelsford.com` to see the learner and onboarding
experience, then as `training.admin@fswelsford.com` to see authoring.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run worker` | Background job worker (reminders, AI, video renders) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests |
| `npm run test:integration` | Integration tests against `fsw_academy_test` |
| `npm run test:all` | Unit + integration |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create and apply a migration in development |
| `npm run db:seed` | Seed roles, org structure, and demonstration content |
| `npm run db:reset` | Drop, re-migrate, and re-seed (**development only**) |
| `npm run db:generate` | Regenerate the Prisma client |

---

## Configuration

Every variable is documented in [`.env.example`](.env.example).

**Required:** `DATABASE_URL`, `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`.

**Everything else is optional.** A missing provider disables only its own
capability — the application never crashes because an integration is
unconfigured. Check live status at **Admin → Integrations**, which shows each
capability, the environment variables that enable it, and exactly what degrades
without it.

| Capability | Enabled by | Without it |
|---|---|---|
| AI text | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | AI authoring and Ask FSW AI are hidden; everything else works |
| Semantic search | `OPENAI_API_KEY` | Ask FSW AI falls back to keyword retrieval, with identical permission filtering |
| Text to speech | `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` | AI videos render with on-screen text and captions but no narration |
| Avatar presenter | `HEYGEN_API_KEY` or `SYNTHESIA_API_KEY` | The avatar video mode is unavailable; other modes render locally |
| Video rendering | `FFMPEG_PATH` (or ffmpeg on PATH) | Scripts, storyboards, and captions still generate; no MP4 output |
| Email | `RESEND_API_KEY` or `EMAIL_SERVER_HOST` | Notifications are in-app only; magic-link sign-in is off |
| Microsoft SSO | `AUTH_MICROSOFT_ENTRA_ID_*` | Password and magic-link sign-in only |
| Object storage | `S3_*` | Media stored on local disk — fine for development, not for multi-instance production |

Renaming the product from "FSW Academy" is a settings change, not a code change:
**Admin → Settings → Brand**.

---

## Running the background worker

The worker processes the Postgres job queue: due reminders, overdue sweeps,
recertification, SOP review notices, content indexing for AI retrieval, AI
generation, video rendering, email delivery, webhook delivery, link checking,
and retention sweeps.

```bash
npm run worker
```

Run one or more instances. Claiming uses `FOR UPDATE SKIP LOCKED`, so workers
scale horizontally without processing the same job twice. Recurring work is
enqueued with idempotency keys, so multiple workers do not multiply it.

Without a worker running, the web application still works — but scheduled
reminders, AI jobs, and video renders stay queued.

---

## Testing

```bash
npm run test              # unit — pure logic, no database
npm run test:integration  # integration — real database
npm run test:e2e          # end-to-end — real browser
```

Integration tests require the test database and refuse to run against any
database whose name does not contain `test`.

```bash
npx prisma migrate deploy   # against TEST_DATABASE_URL
npm run test:integration
```

End-to-end tests need a built application and seeded database:

```bash
npm run build && npm run db:seed && npm run test:e2e
```

See [ARCHITECTURE.md](ARCHITECTURE.md#testing-strategy) for what each layer covers.

---

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions covering Vercel plus
managed Postgres, container deployment, the worker process, storage, backups,
and the production checklist.

The short version:

```bash
npm ci
npx prisma migrate deploy     # never `db push` in production
npm run build
npm run start                 # plus at least one `npm run worker`
```

---

## Further documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, module boundaries, request lifecycle, key decisions |
| [DATA-MODEL.md](DATA-MODEL.md) | Every entity, relationships, immutability rules, indexing |
| [SECURITY.md](SECURITY.md) | Authentication, authorization, encryption, uploads, AI boundaries, audit |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment, backups, recovery, monitoring |
| [AI.md](AI.md) | Provider abstraction, RAG design, authorization filtering, prompt-injection defense |
| [VIDEO.md](VIDEO.md) | Video pipeline, render jobs, providers, SOP-to-video tracking |
| [CONVENTIONS.md](CONVENTIONS.md) | Coding conventions for contributors |

---

## A note on compliance

FSW Academy provides tooling to **manage** training and compliance evidence. It
does not determine what any law or regulation requires, and installing software
does not make an organization compliant. Compliance requirements are
configurable data entered by administrators, never hard-coded facts. Screens
that touch regulatory interpretation display a prompt to verify the requirement
with a qualified legal or safety advisor.

Demonstration content shipped in the seed is labelled as demonstration content.
It is not approved FSW Group policy and must be replaced with reviewed material
before rollout.
