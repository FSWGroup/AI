# Architecture

How FSW Academy is put together, and why it is put together this way.

---

## The central idea

Most training platforms are document repositories with a quiz feature bolted on.
The knowledge lives in one place, the training lives in another, and they drift
apart within months.

FSW Academy is built around **relationships** instead:

```
        Position ──requires──► Course ──teaches──► Skill
            │                    │
         held by              contains
            │                    │
            ▼                    ▼
         Person ◄──assigned── Assignment          Lesson ──references──► SOP
            │                    │                                        │
        completes                │                                    indexed as
            │                    │                                        │
            ▼                    ▼                                        ▼
    CompletionRecord ────► Certificate                          KnowledgeChunk
    (immutable evidence)                                     (AI-retrievable, ACL-scoped)
```

The system knows **who** needs to know **what**, **why** they need to know it,
**whether** they learned it, **when** they need to learn it again, and **where**
the approved answer lives. Every design decision below serves that.

The clearest expression is the SOP-to-everything pipeline: one written procedure
becomes the SOP page, a training lesson, an AI-retrievable knowledge chunk, a
generated video, a quiz, an acknowledgement, and a training record — from a single
source, with version lineage tracked throughout.

---

## Stack and why

| Layer | Choice | Reasoning |
|---|---|---|
| Framework | Next.js 15 App Router | Server components keep authorization and data access on the server by default. A page that forgets to guard itself is a visible mistake, not a silent data leak. |
| Language | TypeScript strict + `noUncheckedIndexedAccess` | Array and record access must be guarded. Catches a whole class of runtime errors at compile time. |
| Styling | Tailwind CSS v4 with CSS custom properties | Brand values live in one token layer. Renaming or rebranding is a token change, not a search-and-replace through components. |
| Components | Radix primitives + original components | Accessible behavior (focus management, ARIA, keyboard) from primitives; all visual design original to FSW. |
| Database | PostgreSQL 16 | Relational integrity matters for training evidence. `pgvector` for retrieval and `pg_trgm` for typo-tolerant search mean one datastore, not three. |
| ORM | Prisma | Single ORM, used consistently. Typed queries, real migrations. Raw SQL via tagged templates where set-based work is clearer. |
| Auth | Auth.js v5 | Providers activate from environment configuration; enabling Entra ID SSO needs no code change. |
| Jobs | Postgres queue (`Job` table) | No extra vendor, identical in dev and production, transactionally consistent with the data it acts on. `FOR UPDATE SKIP LOCKED` gives safe horizontal scaling. |
| Video | ffmpeg pipeline behind a `VideoProvider` interface | Renders FSW-branded video locally with no vendor dependency; avatar vendors are optional adapters. |
| AI | Provider interfaces with adapters | No domain code imports a vendor SDK. |

### Why a Postgres queue rather than Inngest or Trigger.dev

Those are good products, but they add a vendor, a webhook surface, and a
development/production divergence. Video rendering and content indexing act on
data already in Postgres; keeping the queue there means a job and the state it
mutates share a transaction boundary. `FOR UPDATE SKIP LOCKED` is a well-worn
pattern for exactly this. The tradeoff is that scheduling granularity is
minute-level rather than second-level, which is irrelevant for reminders and
renders.

---

## Module layout

```
src/
├── app/
│   ├── (app)/              Authenticated pages, wrapped by the app shell
│   │   ├── home/           Learner dashboard + first-login onboarding
│   │   ├── my-training/    Assignments
│   │   ├── courses/        Course overview and the lesson player
│   │   ├── catalog/        Searchable course catalog
│   │   ├── paths/          Learning paths
│   │   ├── sops/           SOP library and reader
│   │   ├── certificates/   Certificates
│   │   ├── skills/         Skills library
│   │   ├── people/         People directory
│   │   ├── team/           Manager surface
│   │   ├── ask/            Ask FSW AI
│   │   ├── reports/        Report runner
│   │   └── admin/          Administration
│   ├── api/
│   │   ├── auth/           Auth.js handlers
│   │   ├── media/          Authorized media delivery (sandboxed)
│   │   ├── search/         Global search
│   │   ├── progress/       Video and checklist progress
│   │   ├── ai/             Streaming AI endpoints
│   │   └── v1/             Public REST API (API-key auth)
│   ├── sign-in/            Unauthenticated auth pages
│   └── verify/             Public certificate verification (opt-in)
├── components/
│   ├── ui/                 Primitives: Button, Card, Badge, Field, EmptyState, Progress
│   ├── shell/              Sidebar, topbar, command palette
│   ├── editor/             Block editor
│   ├── lesson/             One player per lesson type
│   ├── charts/             Dependency-free accessible SVG charts
│   └── ai/                 Chat surfaces
├── lib/
│   ├── auth/               guard.ts (authorization), config.ts (Auth.js)
│   ├── services/           Domain logic — business rules live here
│   ├── ai/                 Provider interfaces, adapters, RAG, generation
│   ├── video/              Render pipeline and providers
│   ├── content/            Block content model and renderer
│   ├── storage/            Local and S3-compatible drivers
│   ├── email/              Provider abstraction and templates
│   └── jobs/               Queue
└── worker/                 Background job runner
```

### The layering rule

```
Page / API route  →  Service  →  Prisma
     │                  │
  authorize          business
  + render            rules
```

Pages authorize and render. Services hold business rules and are the only place
that writes evidence. Pages never contain domain logic, and services never
render. This keeps rules testable without a browser and reusable between a page,
an API route, and a background job — the same `completeCourse` runs whether a
learner clicks the button, an administrator overrides, or an API client posts.

---

## Request lifecycle

A learner opening an SOP:

```
1. Middleware       assigns x-request-id, sets CSP
2. Layout           getActor() → user + effective permissions (cached per request)
                    buildNavigation() filters nav by capability
3. Page             requirePermission("sop.view")
4. Service          getSopForReader(actor, id)
                      • PUBLISHED currentVersion (or draft if actor can author)
                      • records a ContentView
                      • returns null when not permitted → notFound()
5. Render           BlockRenderer walks the immutable version snapshot
6. Response         streamed HTML; interactive blocks hydrate as islands
```

Authorization appears at step 3 *and* inside step 4. That redundancy is
deliberate: a service must be safe to call from an API route or job that never
passed through step 3.

---

## Key design decisions

### 1. Capabilities, not role names

Code asks "does this actor hold `sop.publish`?" — never "is this actor an
admin?". Roles are editable bundles of capabilities, so an organization can
create "Warehouse Trainer" without a code change, and the 13 seeded roles are
defaults rather than structure.

### 2. Immutable evidence with snapshots

Training records must hold up after the course changes. Evidence tables are
append-only and carry snapshots — `userSnapshot`, `titleSnapshot`,
`versionLabel`, `questionSnapshot` — not just foreign keys. Editing a lesson
cannot retroactively change what a record says happened, and an acknowledgement
always points at the exact version signed.

### 3. Draft/published split in one row plus version table

`Sop` and `Course` hold working draft content (`draftBlocks`) and point at a
`currentVersionId`. Editing touches only the draft; publishing writes a new
immutable version row. This gives editing without a checkout dance, and version
history without diffing mutable state.

### 4. One content model for everything

`Block[]` (`src/lib/content/types.ts`) serves SOP bodies, lesson bodies, and the
source text for search, retrieval, and AI. `blocksToPlainText` and
`blocksToChunks` derive search text and citation-carrying retrieval chunks from
the same structure — so "SOP OPS-014, Procedure > Step 4" is a real address, not
a guess. This is what avoids five copies of the same knowledge.

### 5. Authorization before retrieval

The RAG query filters on the asking actor's capabilities inside the SQL
statement. Content the user cannot open is never fetched, never embedded in a
prompt, and therefore cannot leak. Filtering after generation is not a security
boundary; this is.

### 6. Capability registry for optional providers

`src/lib/providers/registry.ts` declares every optional capability, the
environment variables that enable it, and what degrades without it. Features
consult `isCapabilityAvailable()` and render an informative disabled state rather
than a broken button. One registry drives both the runtime checks and the
Admin → Integrations screen, so the two cannot disagree.

### 7. Assignment rules as data

Rules are JSON criteria (`{all: [...]}`, `{any: [...]}`, `{not: {...}}`,
nestable) evaluated by a pure function with no database access — which makes the
engine exhaustively unit-testable. Assignments record a human-readable `reason`,
so mandatory training always explains why it was assigned. Recommendations may be
inferred; requirements are never opaque.

### 8. Dark mode architected, not shipped

Every color is a semantic token with a complete `[data-theme="dark"]` set. The
light theme ships; the dark theme is behind the `darkMode` feature flag. Adding
it later is a flag flip, not a refactor.

---

## Performance

Targets: comfortable at 100 users, correct at 5,000.

- **Server pagination everywhere.** No list loads a full table; the people
  directory and course catalog page at 25 and never ship the whole dataset to the
  browser.
- **Selective column fetching.** `select` clauses fetch what a view needs.
- **N+1 avoidance.** Nested `select`, or a single raw query with a CTE. The
  training matrix — the worst case, people × courses — uses a small fixed number
  of queries and assembles in memory rather than one query per cell.
- **Per-request actor caching.** React `cache` collapses repeated permission
  lookups to one query per request.
- **Settings caching.** `unstable_cache` with tag invalidation; settings are read
  on nearly every request and change rarely.
- **Intentional indexes.** Every foreign key used in a filter, plus composites for
  real access patterns (`Assignment(userId, status)`, `Notification(userId,
  readAt)`, `CompletionRecord(userId, completedAt)`).
- **Background processing.** Renders, indexing, email, and reminders never run in
  a request.
- **Range-request media.** Video seeks without re-downloading.

---

## Testing strategy

| Layer | Location | Covers |
|---|---|---|
| Unit | `src/**/*.test.ts` | Pure logic, no database: permission catalog invariants, criteria evaluation, quiz grading, due-date computation, version numbering, content transforms, crypto |
| Integration | `tests/integration/*.test.ts` | Real database: publishing, assignment, completion, acknowledgement, certificates, and authorization boundaries with real `Actor` objects built from real rows |
| End-to-end | `e2e/*.spec.ts` | Real browser: the flows an administrator, manager, and learner actually perform |
| Security | `tests/integration/security.test.ts` | Role escalation, IDOR, unauthorized file access, AI retrieval leakage, API authorization |

Integration tests build real users, roles, and permission rows and construct
`Actor` objects exactly as `getActor()` does — permission sets are never mocked,
because a mocked permission set would test the mock rather than the boundary.

---

## Extension points

**A new lesson type** — add to the `LessonType` enum plus a migration, add a
player in `src/components/lesson/`, add an editor in the course builder, and
teach `completion.ts` its completion criteria.

**A new AI provider** — implement the interface in `src/lib/ai/types.ts`, add the
adapter under `src/lib/ai/providers/`, register it in `src/lib/ai/index.ts`, and
declare it in the capability registry. No domain code changes.

**A new video provider** — implement `VideoProvider`, register in
`src/lib/video/registry.ts`.

**A new report** — add a `ReportDefinition` to the registry. Filtering,
pagination, and CSV/XLSX/PDF export come from the shared runner.

**A new integration** — add a descriptor to the capability registry; the
Integrations screen and runtime gating both follow automatically.

**SCIM provisioning** — the `User` model already separates identity (email) from
employment attributes, and SSO deliberately does not auto-provision, so a SCIM
endpoint slots in beside the people import service.
