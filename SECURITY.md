# Security

How FSW Academy protects personnel data, training evidence, and company
knowledge. This document describes what is implemented, and states limitations
plainly where they exist.

---

## Threat model

The platform holds:

- **Personnel data** — names, work contact details, employment records, reporting
  lines, and optionally encrypted sensitive fields
- **Training evidence** — completion records, assessment attempts, signed
  acknowledgements; used to demonstrate that training happened
- **Company knowledge** — procedures, pricing authority, policies; commercially
  sensitive and, in aggregate, a map of how the business operates

The adversaries we design against:

| Adversary | Concern | Primary control |
|---|---|---|
| Curious insider | Reading colleagues' records or another business unit's content | Server-side RBAC, manager-subtree scoping, permission-filtered retrieval |
| Compromised account | Acting as a legitimate user | Least-privilege roles, audit trail, SSO/MFA delegation, session limits |
| Malicious uploaded content | Script execution, package escape | Type validation, sandboxed delivery, CSP isolation |
| Prompt injection in content | Making the AI leak or misbehave | Pre-retrieval authorization, untrusted-content framing, no tool access |
| Evidence tampering | Altering training history to pass an audit | Append-only evidence tables, immutable version snapshots |
| External attacker | Credential stuffing, enumeration, scraping | Rate limiting, uniform auth failures, no public surface by default |

---

## Authentication

Implemented with Auth.js v5 (`src/lib/auth/config.ts`). Providers activate from
environment configuration alone — enabling SSO requires no code change.

**Email and password** — bcrypt with cost factor 12. Failures are uniform: a
non-existent account, a wrong password, and a deactivated account are
indistinguishable, and a dummy bcrypt comparison runs on the missing-account path
so response timing does not leak account existence.

**Magic link** — single-use, 24-hour expiry, enabled by mail configuration.

**Microsoft Entra ID (OIDC)** — the recommended production configuration.
**Multi-factor authentication is delegated to Entra ID**, which is the correct
place for it in an organization already running Microsoft 365: conditional access,
device compliance, and MFA policies apply to FSW Academy automatically. The
platform does not implement its own second factor.

**SSO does not auto-provision.** A person who authenticates successfully but has
no FSW Academy record is refused rather than silently created. Provisioning goes
through people import or (architecturally) SCIM.

**Deactivated people cannot sign in through any provider.** The `signIn` callback
checks status on every authentication, so deactivation takes effect immediately
rather than at session expiry.

Sessions are JWT-based with a 12-hour default lifetime
(`SESSION_MAX_AGE_SECONDS`), delivered in `HttpOnly`, `SameSite=Lax`, `Secure`
cookies. Every sign-in writes an audit event.

**Sign-out** goes through the Auth.js client helper rather than a plain form
post, because the sign-out endpoint requires a CSRF token. A bare POST is
rejected — which would close the menu and leave the person signed in while
believing otherwise, an obvious hazard on a shared workstation. There is an
end-to-end test asserting that a protected page is unreachable after signing
out, so this cannot regress silently.

---

## Authorization

**Authorization is enforced server-side, in every case. UI hiding is a
convenience, never a control.**

The model is capability-based, not role-name-based. Code asks "does this actor
hold `sop.publish`?", never "is this actor an admin?". Roles are editable bundles
of capabilities; the seeded defaults are a starting point administrators can
change.

### Enforcement points

```ts
// Page rendering — redirects unauthenticated users to sign-in,
// authenticated-but-unauthorized users to an explanatory /forbidden page.
const actor = await requirePermission("sop.create");

// Server actions and API routes — throws, so the caller returns a structured error.
const actor = await assertPermission("sop.publish");
```

Both resolve the actor's effective permission set from the database. The lookup
is memoized per request with React `cache`, so a page with twenty guarded
sections issues one query.

### Record-level scoping

Holding `team.view` is not global. `getVisibleUserIds()` walks the reporting tree
with a recursive CTE and returns the actor's subtree; a learner's scope is
themselves alone. Every list of people, every report, and every search over
people intersects with that scope. `canViewUser` and `canManageUser` gate
individual records.

### Contractor narrowing

The contractor role deliberately omits `people.view` and `org.view`. Contractors
see assigned training and published SOPs, not the staff directory or the org
chart. In AI retrieval, contractors are additionally restricted to their own
business unit's content, so cross-business-unit leakage is structurally
impossible rather than merely unlikely.

Unit tests in `src/lib/permissions.test.ts` assert these boundaries — that
learners hold no administrative capability, that only HR and super admin can
reach sensitive fields, that auditors cannot write, that content authors cannot
publish their own work, and that managers cannot override completions.

---

## Sensitive personal data

**By default the platform does not store Social Security Numbers, Philippine TIN
numbers, bank details, or comparable high-risk identifiers.** There are no
columns for them.

If an organization later determines it needs such a field, an administrator
defines it as a sensitive custom field. Those values are:

- **Encrypted** with AES-256-GCM (`src/lib/crypto.ts`), format
  `base64(iv‖authTag‖ciphertext)`, keyed by `FIELD_ENCRYPTION_KEY` (32 bytes).
  GCM authentication means tampering is detected on decrypt, not silently
  accepted.
- **Separately permissioned** — `people.sensitive_view` and
  `people.sensitive_edit`, held by no role except HR Administrator and Super
  Administrator in the defaults.
- **Never auto-loaded.** The profile page requires an explicit "Reveal sensitive
  fields" action; they are not fetched with the rest of the profile.
- **Audited on every single read.** `person.sensitive_view` records actor,
  subject, timestamp, and request ID.
- **Excluded from global search, AI retrieval context, report exports, analytics,
  and logs.** The logger and audit writer both run a redaction pass over
  key names as a safety net.

> **Key management.** If `FIELD_ENCRYPTION_KEY` is lost, encrypted values are
> unrecoverable — the database backup alone is not sufficient. Store it in a
> secrets manager, back it up independently, and note that rotation requires
> re-encrypting existing values.

---

## Immutable training evidence

Training records must hold up months later, after the underlying course has been
edited or retired. These tables are **append-only**; the service layer provides
no update or delete path:

| Table | Holds |
|---|---|
| `CompletionRecord` | Who completed what, at which version, with what score |
| `Acknowledgement` | Signed policy acknowledgements against an exact version |
| `Certificate` | Issued certificates |
| `QuizAttempt` / `QuizResponse` | Every attempt, with a snapshot of each question as presented |
| `SopVersion` / `CourseVersion` | Immutable published content snapshots |
| `AuditEvent` | The audit trail itself |

Records carry **snapshots**, not just foreign keys: `userSnapshot`
(name/email/employee ID at completion time), `titleSnapshot`, `versionLabel`,
and `questionSnapshot`. Renaming a course, editing a lesson, or archiving content
cannot rewrite what a record says happened.

Published courses with completion history are archived, never hard-deleted; an
attempt to delete one is refused with an explanation. Restoring an old SOP
version copies its content into the working draft — it never mutates the
historical version.

A completion override is a legitimate administrative action, but it is
distinguishable forever: `overriddenById` is set on the record and
`completion.overridden` is audited with the stated reason.

---

## File upload security

Uploads are treated as hostile.

- **Type validation on both extension and content.** The declared extension must
  be on the allowlist *and* the sniffed magic bytes must match. A `.png` whose
  header says otherwise is rejected.
- **Size limits** via `MAX_UPLOAD_MB` (default 200).
- **Filename sanitization** (`sanitizeFilename`): directory components stripped,
  control characters removed, `..` sequences collapsed, length capped.
- **Path traversal prevention** at two layers: `assertSafeStoragePath` rejects
  `..`, absolute paths, and drive letters; the local driver additionally verifies
  the resolved absolute path still sits inside the storage root.
- **No public object storage.** Private content is never publicly addressable.
  Everything is served through `/api/media/[id]`, which authorizes the request
  before streaming a single byte.
- **Sandboxed delivery.** `next.config.ts` applies
  `Content-Security-Policy: sandbox; default-src 'none'` to `/api/media/*` plus
  `X-Content-Type-Options: nosniff`, so uploaded content cannot execute script in
  the application's origin.
- **Duplicate detection** by SHA-256, which also prevents redundant storage.
- **In-use protection.** Deleting an asset referenced by a course or SOP is
  refused; the usage list is returned instead.

**Limitation, stated plainly:** the platform does not include antivirus
scanning. Content-type validation and origin sandboxing are not equivalent to
malware detection. For production use, place an object-storage-level scanner
(for example a bucket-triggered scan) in front of the media bucket.

---

## SCORM packages

SCORM packages are third-party code and are treated as untrusted. They are
extracted under a per-package storage prefix and served inside a sandboxed
iframe; the SCORM JavaScript API is bridged over `postMessage` rather than
same-origin access, so a package cannot reach the application's session or DOM.

The SCORM player sits behind the `scormPlayer` feature flag so it can be turned
off entirely. Only SCORM 1.2 and 2004 are implemented. **xAPI, cmi5, and AICC
are not supported** — extension points exist and are marked as such, but no
support is claimed for formats without passing tests.

---

## AI security

The AI surface is the highest-risk part of a knowledge platform, because it is
designed to read everything and answer in natural language. Details in
[AI.md](AI.md); the controls in summary:

**Authorization happens before retrieval, never after generation.** The
retrieval query in `src/lib/ai/rag.ts` filters on the asking actor's
capabilities inside the SQL statement. Content the user cannot open is not
fetched, not embedded in a prompt, and therefore cannot leak — as opposed to
being fetched and then filtered out of an answer, which is not a security
boundary.

**Only published, approved content is indexed.** Drafts, sensitive personal
fields, audit events, API keys, and integration configuration are never in the
retrieval corpus.

**Prompt-injection defense.** Retrieved chunks are wrapped in delimited blocks
and the system prompt states that retrieved content is untrusted reference
material whose embedded instructions must be ignored. The AI has no tool access,
no write capability, and no ability to change permissions — so a successful
injection yields a wrong answer, not an action. Recognizable injection patterns
are neutralized in chunk text before inclusion.

**Grounding and citations.** Every substantive answer carries citations mapped
back to real retrieved chunks by ID — the model is not trusted to invent source
links. With no supporting source, the answer is
*"I couldn't find an approved FSW source that answers that,"* not a guess.

**AI never publishes.** Generated SOPs, courses, and questions land as drafts
marked `aiGenerated`, visibly badged, awaiting human approval. AI cannot change
compliance requirements, override scores, alter training history, approve
certifications, or modify historic records.

**Rate limiting** per user on AI questions, generation jobs, and video renders,
protecting both provider spend and availability.

---

## Application security controls

| Control | Implementation |
|---|---|
| Transport encryption | TLS terminated at the platform edge; HSTS recommended (see DEPLOYMENT.md) |
| Encryption at rest | Managed Postgres encryption plus field-level AES-256-GCM for sensitive fields |
| SQL injection | Prisma parameterized queries throughout; raw SQL uses tagged templates with bound parameters. `$queryRawUnsafe` appears only in the test helper that truncates tables, with identifiers sourced from `pg_tables`, never user input |
| XSS | React escapes by default. The block renderer parses a restricted inline-markdown subset rather than accepting HTML; `dangerouslySetInnerHTML` is used only for the server-generated brand-token stylesheet |
| CSRF | Auth.js CSRF tokens on auth routes; server actions are origin-checked by Next.js; the REST API is bearer-token authenticated and does not accept cookie auth |
| Clickjacking | `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| CSP | Set in middleware for application routes, and a strict sandbox for media routes |
| Rate limiting | Postgres-backed fixed windows (`src/lib/rate-limit.ts`) — shared across instances, unlike in-memory counters. Covers login, AI, generation, renders, API, search, upload, and public verification |
| Secret management | Environment variables only; no secrets in code or the repository. Integration configs encrypted at rest. API keys stored as SHA-256 hashes — the plaintext is shown once at creation and never again |
| Least privilege | Capability-based roles; defaults withhold sensitive-field access from all but two roles |
| Dependency scanning | `npm audit` in CI; Dependabot recommended |

---

## Audit trail

`AuditEvent` is append-only and records actor, action, entity type and ID,
timestamp, request ID, IP address, and safe metadata for high-risk operations:

person created/changed/deactivated/imported/exported/anonymized, role changed,
**sensitive field viewed**, course and SOP published, version restored, training
completion overridden, certificate issued and revoked, assignment removed,
compliance exemption created, AI content published, integration changed, API key
created and revoked, settings changed, media deleted, and every sign-in.

Metadata is redacted before write: keys matching password, secret, token, API
key, ciphertext, authorization, cookie, and similar are replaced with
`[redacted]`, and long values truncated. An audit write failure logs loudly but
never breaks the user's operation.

`audit.view` gates the search UI, held by Super Administrator, Compliance
Administrator, and Auditor in the defaults.

---

## Privacy by design

Applied to all personnel, with the Philippines Data Privacy Act and comparable
principles in mind:

- **Purpose limitation and minimization** — only fields with a training or
  administration purpose; no high-risk identifiers by default
- **Role-restricted access** — sensitive fields behind separate permissions,
  audited on read
- **Configurable retention** — training evidence, audit, and analytics retention
  periods are administrator-set, applied by the retention sweep job
- **Data export** — a person's data can be exported on request, excluding other
  people's data
- **Correction workflow** — profile correction through the people editor, audited
- **Deletion and anonymization** — anonymization replaces identifying fields
  while preserving completion and audit records, which carry their own snapshots.
  This is deliberate: destroying compliance evidence to satisfy an erasure
  request would create a different problem, so the two are separated
- **Privacy notices** — configurable notice text and URL surfaced to users
- **Records of processing** — audit events serve as the processing log

**Offboarding preserves records.** Deactivation disables sign-in, cancels active
assignments, and prompts for reassignment of owned content and pending
approvals. It does not delete the training transcript or compliance history.

Country-aware policy configuration is supported without pretending there is one
universal state or national privacy rule — jurisdictions and requirements are
data, entered and verified by administrators.

---

## What this platform does not claim

- It does not make an organization legally compliant. It manages compliance
  evidence. Requirements are configurable data, not hard-coded legal facts, and
  screens involving regulatory interpretation prompt verification with a
  qualified advisor.
- It does not scan uploads for malware (see the upload section).
- It does not support xAPI, cmi5, or AICC.
- It does not implement its own MFA; that is delegated to the identity provider.
- Public certificate verification is **disabled by default** and reveals only
  certificate number, name, course, dates, and validity when an administrator
  explicitly enables it.

---

## Reporting a vulnerability

Report suspected vulnerabilities to FSW Group IT. Include what you observed,
how to reproduce it, and the potential impact. Do not post details in shared
channels or test against production data.
