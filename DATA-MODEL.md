# Data model

The authoritative schema is [`prisma/schema.prisma`](prisma/schema.prisma). This
document explains the shape, the invariants, and the reasoning.

---

## Conventions

- **Primary keys** are `cuid()` strings. Sortable, non-sequential, safe in URLs,
  and they do not leak record counts the way auto-increment integers do.
- **Timestamps** are always UTC. Display-time conversion uses the person's
  `timezone` (IANA identifier). No offset is ever hard-coded — this matters
  because US Eastern and Asia/Manila both observe rules that change.
- **JSON columns** hold structured editor content and immutable snapshots. Their
  shapes are defined and validated with zod at the boundary
  (`src/lib/content/types.ts`), so "JSON" does not mean "unvalidated".
- **Soft delete** (`isDeleted`) on content that may carry history; hard delete
  only where nothing references the row.
- **Append-only tables** have no update or delete path in the service layer. This
  is a code-enforced invariant, not merely a convention.

---

## Organization structure

```
Organization
└── BusinessUnit          Welsford, ValveMan, Shared Services, …
    └── Department        Sales, Operations, Accounting, …
        ├── Team          Inside Sales, Warehouse, …
        └── Position      Inside Sales Representative, …

Location                  independent of the hierarchy; carries country/state/timezone
```

Nothing is hard-coded to the seeded entities. Adding a fourth FSW business is a
row, not a migration.

`Position` is the pivot that makes role-based training work. It carries
`responsibilities`, `toolsUsed`, and two requirement tables:

- `PositionTrainingRequirement` — courses, SOPs, or paths this role requires
- `PositionSkillRequirement` — skills and the level required

Because requirements attach to the position rather than the person, moving
someone between positions can be **diffed**: what is newly required, what is no
longer required, what carries over
(`computePositionChangeDiff` in `src/lib/services/assignment.ts`).

---

## Identity and access

```
User ──┬── UserRole ──► Role ──► RolePermission
       ├── SensitiveField        (encrypted, separately permissioned)
       ├── Account / Session     (Auth.js)
       └── managerId → User      (self-referential reporting line)
```

`User` merges identity and employment attributes: login identity (`email`,
`passwordHash`, `emailVerified`), personal details (`name` preferred,
`legalName`), placement (`businessUnitId`, `departmentId`, `teamId`,
`positionId`, `locationId`, `managerId`), and classification (`workerType`,
`country`, `state`, `timezone`, `language`, `startDate`, `endDate`,
`trainingStartDate`).

`workerType` covers US employee and contractor, Philippines employee and
contractor, and international employee and contractor. It drives assignment
rules and compliance population targeting.

**`managerId` is self-referential**, and manager visibility walks the whole
subtree with a recursive CTE (`getVisibleUserIds`) — not just direct reports, so a
director sees their whole organization without any denormalized copy to keep in
sync.

**Permissions are not stored on the user.** They are derived from
`UserRole → Role → RolePermission` at request time and cached per request. Editing
a role's permissions takes effect on the next request for everyone holding it.

### SensitiveField

Deliberately a separate table, not columns on `User`:

| Column | Purpose |
|---|---|
| `fieldKey` | Administrator-defined key |
| `ciphertext` | `base64(iv‖authTag‖ciphertext)`, AES-256-GCM |
| `updatedBy` | Who last wrote it |

Separation means the common `User` query can never accidentally include sensitive
values — there is nothing to accidentally include. No high-risk identifier
columns (SSN, TIN, bank details) exist anywhere in the schema by default.

---

## Content: SOPs and courses

Both follow the same draft/version pattern.

### SOP

```
Sop                          working draft + pointer to the published version
├── draftBlocks              Block[]  — the editable body
├── draftMeta                purpose, scope, definitions, troubleshooting, …
├── currentVersionId ────►   SopVersion (immutable)
├── reviewCycleDays, lastReviewedAt, nextReviewAt
└── versions[] ──────────►   SopVersion (full history)
```

`SopVersion` is immutable and holds a complete snapshot: `blocks`, `meta`,
`title`, author, reviewer, approver, `changeSummary`, `isMaterial`,
`publishedAt`. Nothing edits a published version — restoring an old one copies
its content into the draft.

`isMaterial` drives version numbering (material → major bump) and the retraining
question: a material change asks the administrator whether previously trained
people need to re-acknowledge or retrain.

Policies are `Sop` rows with `kind = POLICY`. One authoring pipeline, one version
model, one acknowledgement path — not a parallel subsystem.

### Course

```
Course
├── sections[] ──► CourseSection ──► Lesson ──► Question
├── currentVersionId ──► CourseVersion (immutable full-tree snapshot)
├── skills[] ──► CourseSkill        skills granted on completion
├── prerequisites[] ──► CoursePrerequisite
├── passingScore, attemptLimit, recertifyMonths, requiredVideoPercent
└── selfEnrollAllowed
```

`CourseVersion.snapshot` holds the **entire tree** — course meta, sections,
lessons with their content, and questions with their configs — in one JSON
document. A `CompletionRecord` referencing that version can always answer "what
exactly did this person complete?", even after the live course is restructured or
archived.

`Lesson.type` spans 25 activity types; `Lesson.content` is the type-specific
payload (blocks for rich text, `sopId` for an SOP reference, `mediaId` for video,
items for a checklist, statement for an acknowledgement).

---

## Assessments

```
Question ──► QuizAttempt ──► QuizResponse
```

`Question.config` is type-specific: `{options, correctIndex}`,
`{options, correctIndexes}`, `{correct}`, `{acceptableAnswers}`,
`{acceptableKeywords}`, `{pairs}`, `{items}`.

`Question.isDraft` exists so AI-suggested questions are stored but not live until
a human accepts them.

`QuizAttempt` records every attempt — never just the best or last — with
`attemptNumber`, `status`, `scorePercent`, points, timestamps, and
`questionOrder` (evidence of the randomized order presented).

`QuizResponse.questionSnapshot` captures the question **as presented**. Editing a
question afterwards cannot change what a past attempt was actually asked, which
is the difference between a record and a reconstruction.

---

## Assignment and progress

```
AssignmentRule ──generates──► Assignment ──► LessonProgress
                                  │
                              completes
                                  │
                                  ▼
                          CompletionRecord ──► Certificate
```

`Assignment` carries a `source` (`MANUAL`, `RULE`, `POSITION`, `LEARNING_PATH`,
`COMPLIANCE`, `RECERTIFICATION`, `SELF_ENROLLED`) and a human-readable `reason`.
Every mandatory assignment can explain itself.

A composite unique constraint on
`(userId, targetType, courseId, sopId, pathId, parentAssignmentId)` makes rule
evaluation idempotent at the database level — re-running the engine cannot
duplicate assignments, so correctness does not depend on the engine being careful.

`LessonProgress` tracks `videoPositionSeconds` and `videoWatchedPercent`
separately. Progress is monotonic and rate-limited against wall-clock time, so
scrubbing to the end does not register as watching.

`AssignmentRule.criteria` is nestable JSON evaluated by a pure function:

```json
{ "all": [
    { "field": "workerType",     "op": "eq", "value": "US_EMPLOYEE" },
    { "field": "departmentName", "op": "eq", "value": "Sales" }
]}
```

---

## Immutable evidence

These five tables are the reason the platform can be trusted in an audit.

### CompletionRecord

| Column | Why it exists |
|---|---|
| `userSnapshot` | Name, email, employee ID **at completion time** |
| `titleSnapshot`, `versionLabel` | Survives renaming, restructuring, archival |
| `courseVersionId` | Points at the exact immutable snapshot completed |
| `scorePercent`, `attemptCount`, `durationMinutes` | The result and the effort |
| `assignmentSource` | Why the training was required |
| `expiresAt` | Drives recertification |
| `overriddenById` | A manual override is distinguishable forever |

Snapshots mean the record is self-contained. Deleting the course does not
degrade it.

### Acknowledgement

Ties a person to a **specific version** of a policy or course, with `statement`
(the exact wording agreed to), `signatureMethod`, `typedSignature`, `ipAddress`,
`userAgent`, `acknowledgedAt`. Append-only: a new acknowledgement never
overwrites a historic one, so "what did they agree to, and when?" always has an
answer.

### Certificate

`certificateNumber` (`FSW-YYYY-NNNNNN`), name and course title snapshots, issue
and expiry, optional `verificationToken` — set **only** when an administrator
enables public verification.

### AuditEvent

Actor, action, entity, `requestId`, `ipAddress`, redacted metadata. Append-only.

### SopVersion / CourseVersion

Immutable content snapshots, described above.

---

## Skills

```
Skill ──┬── SkillLevel              configurable scale (None → Expert, 0–6)
        ├── PositionSkillRequirement required level per position
        ├── UserSkill                current level + how it was earned
        ├── CourseSkill              level granted by completing a course
        └── SkillAssessment          manager practical sign-off
```

`UserSkill.source` records provenance: `TRAINING`, `MANAGER_ASSESSMENT`,
`PRACTICAL_DEMO`, `CERTIFICATION`, `MANUAL`. A skill from a quiz and a skill a
manager watched someone demonstrate are different claims, and the model keeps
them distinguishable.

`SkillAssessment.rating` is the practical scale: `NOT_DEMONSTRATED`,
`NEEDS_COACHING`, `COMPETENT`, `HIGHLY_COMPETENT`, with comments, attachment, and
a reassessment date. Some competence cannot be proven by a quiz.

Gap analysis is `PositionSkillRequirement` minus `UserSkill`.

---

## Compliance

`ComplianceRule` holds `jurisdiction`, `requirement`, `sourceReference`,
population `criteria`, `courseId`, `frequencyMonths`, `effectiveDate`,
`expirationDate`, `retentionYears`, `ownerId`, `lastVerifiedAt`, `notes`.

**No legal requirement is hard-coded.** Rules are administrator-entered data with
an owner and a last-verified date, because regulations change and
interpretation is not a software concern. `TrainingExemption` records exceptions
with a reason, a granting actor, and an expiry.

---

## AI and retrieval

```
KnowledgeChunk        the retrieval corpus — one row per content chunk
├── entityType, entityId, versionLabel
├── title, sectionPath          "Procedure > Step 4"  (precise citations)
├── content                     plain text
├── businessUnitId, departmentId, requiredPermission   ← ACL, filtered pre-retrieval
└── embedding  vector(1536)     nullable — keyword retrieval works without it
```

The ACL columns are the security boundary. Retrieval filters on them **inside the
SQL query**, so content the asking user cannot open is never fetched and cannot
appear in a prompt. `sectionPath` is why a citation can address a section rather
than a document.

`embedding` is nullable by design: without an embedding provider the system falls
back to keyword and trigram retrieval, with identical permission filtering.

`AiConversation` / `AiMessage` persist chat history with `citations` as
structured JSON. `AiJob` and `VideoJob` track generation with status, progress,
and error, and `VideoJob.sourceSopVersion` is what makes
*"generated from SOP version 2.1 — may be outdated"* a programmatic fact rather
than a note someone forgot to update.

---

## Content relationships

`ContentRelationship` is a generic edge table:

```
fromEntityType/Id ──relation──► toEntityType/Id
```

with relations `USES`, `REFERENCES`, `GENERATED_FROM`, `TRANSLATES`.

This powers impact analysis. Before publishing a material SOP change, the system
can answer: which courses use this, which paths include those courses, how many
people acknowledged an earlier version, how many certifications depend on it. The
reverse index `(toEntityType, toEntityId)` makes that a single query.

---

## Platform tables

| Table | Purpose |
|---|---|
| `AppSetting` | Key/value settings: brand (including the app name), training defaults, privacy, feature flags, languages |
| `Job` | Queue. Indexed `(status, runAt, priority)` for the `SKIP LOCKED` claim; `idempotencyKey` prevents duplicate enqueues |
| `Integration` | Per-integration status and encrypted config |
| `ApiKey` | SHA-256 hash only — plaintext is shown once at creation. Scoped permissions |
| `Webhook` / `WebhookDelivery` | Outbound events with HMAC signing and delivery history |
| `Notification` / `NotificationPreference` | In-app notifications and per-type channel preferences |
| `AnalyticsEvent` | Privacy-conscious product events — no content bodies, no sensitive data |
| `RateLimitBucket` | Fixed-window counters, shared across instances |
| `ContentTranslation` | Translations linked to a source version, marked `OUTDATED` when the source changes |
| `MediaAsset` | Media with `sha256` for duplicate detection, transcript, captions, chapters |

---

## Indexing

Indexes are chosen from real access patterns, not added reflexively — each one
costs write throughput.

**Composite indexes for known queries**

| Index | Query it serves |
|---|---|
| `Assignment(userId, status)` | "My overdue training" — the most frequent learner query |
| `Assignment(dueAt)` | The reminder and overdue sweeps |
| `CompletionRecord(userId, completedAt)` | Chronological transcript |
| `CompletionRecord(expiresAt)` | Recertification sweep |
| `Notification(userId, readAt)` | Unread badge on every page load |
| `LessonProgress(userId, courseId)` | Course progress calculation |
| `Job(status, runAt, priority)` | The queue claim |
| `Sop(nextReviewAt)` | The review dashboard |
| `ContentRelationship(toEntityType, toEntityId)` | Reverse impact analysis |

**Unique constraints as correctness guarantees**

- `Assignment(userId, targetType, courseId, sopId, pathId, parentAssignmentId)` —
  idempotent rule evaluation
- `LessonProgress(userId, lessonId)` — one progress row per person per lesson
- `QuizAttempt(userId, lessonId, attemptNumber)` — no duplicate attempt numbers
- `SopVersion(sopId, versionNumber)` and `CourseVersion(courseId, versionNumber)`
- `Job.idempotencyKey`, `Certificate.certificateNumber`,
  `ApiKey.keyHash`, `User.email`, `User.employeeId`

**Extension indexes**

`pg_trgm` supports `similarity()` for typo-tolerant search on titles;
`pgvector` supports cosine distance on `KnowledgeChunk.embedding`; `unaccent`
normalizes diacritics.

---

## Migrations

Real migration files under `prisma/migrations/`, applied with
`prisma migrate deploy`. **`db push` is never used in production** — it cannot be
reviewed, replayed, or rolled back.

The initial migration runs safely against an empty production database and
creates the required extensions itself. Because evidence tables are append-only
and content uses the draft/version split, future migrations that change content
structure can transform drafts while leaving historical versions untouched — the
snapshots stay readable as the shape they were written in.
