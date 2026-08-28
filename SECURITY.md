# Security — FSW People

FSW People holds some of the most sensitive data FSW Group has: government identifiers,
bank details, compensation, medical-adjacent leave information, disciplinary records and
performance history. This document describes how that data is protected and what a
deployment team must do to keep it that way.

---

## Authentication

**Passwords** are hashed with bcrypt at cost factor 12 (`src/lib/auth/passwords.ts`). A
minimum bar is enforced on activation and reset: 10+ characters, mixed case, and a number
or symbol, with an explicit block on obvious choices.

**Sessions** are opaque 256-bit random tokens. Only the SHA-256 hash is stored
(`Session.tokenHash`), so a database disclosure does not yield usable sessions. The cookie
is `httpOnly`, `sameSite=lax`, `secure` in production, and expires after 12 hours. Sessions
can be revoked individually or in bulk, and are revoked automatically on password reset,
account suspension and termination.

**MFA** is TOTP (RFC 6238), implemented directly on `node:crypto` with no external
dependency. Secrets are stored encrypted. Verification accepts one 30-second step either
side of the current time to absorb clock drift, and no further — a code more than 90
seconds old is rejected (covered by test).

**Login throttling**: after 8 consecutive failures an account is locked for 15 minutes.
Failed logins are audited with the attempted email and source IP.

**User enumeration** is avoided: sign-in returns one generic "Incorrect email or password"
for unknown accounts, wrong passwords and disabled accounts alike, and password reset always
returns the same "if that email belongs to an account…" message.

**Activation and reset tokens** are single-use, hashed at rest, and time-limited (7 days for
activation, 2 hours for reset). Using one marks it consumed.

### Planned SSO

The model is designed for Microsoft Entra ID, Google Workspace, SAML and SCIM. `User` is
already separate from `Worker`, roles are data, and the session layer is isolated behind
`src/lib/auth/session.ts` — adding an OIDC provider means adding a callback that creates a
session, not restructuring the app.

---

## Encryption

**In transit**: TLS is terminated by the platform. `Strict-Transport-Security` is set with
a two-year max-age and `includeSubDomains`.

**At rest**: managed PostgreSQL and object storage provide volume-level encryption. That
alone is not sufficient for the highest-risk fields, so:

**Field-level encryption** (`src/lib/crypto.ts`) protects SSN, ITIN, EIN, Philippine TIN /
SSS / PhilHealth / Pag-IBIG, passport numbers and bank account/routing numbers. These live
in dedicated tables (`WorkerIdentifier`, `BankAccount`), never as columns on `Worker`.

- Algorithm: AES-256-GCM with a random 96-bit IV per value and an authentication tag.
- Envelope: `enc:v1:<iv>:<ciphertext>:<tag>`. The version prefix exists so a `v2` key can be
  introduced and values re-encrypted lazily rather than in one migration.
- Only a plaintext `last4` is stored alongside, for display.
- Tampering is detected: modifying any byte of the ciphertext causes decryption to throw
  (covered by test).

A test asserts with raw SQL that a stored SSN's plaintext appears nowhere in the table.

### Key management

`FIELD_ENCRYPTION_KEY` must come from a secrets manager, never from a file in the repo.
**Losing it means losing every encrypted identifier — there is no recovery.** Back it up
separately from the database, so that a database backup alone is not sufficient to read the
encrypted fields.

To rotate: add the new key as `v2` in `encryptField`, keep `v1` decryption, re-encrypt
values in a background pass, then retire `v1`.

---

## Authorization

One module — `src/lib/authz/index.ts` — is the only place authorization decisions are made.
Every server action, page and route handler calls it.

**Permission catalog** (`src/lib/authz/catalog.ts`) defines ~45 named permissions. Ten
system roles map to sets of them; the mapping is editable in Settings → Permissions and
stored in `RolePermission`, so a permission change is configuration, not a deploy.

**Enforcement layers**:

| Layer | Mechanism |
|---|---|
| Module | `assertPermission(ctx, 'comp.read')` on the page/action |
| Record | `workerAccess(ctx, workerId)` → `{ self, manager, hr, pii, comp }` |
| Field | Restricted fields render as "Restricted" unless `access.pii` |
| Reveal | Decrypting an identifier requires `pii.reveal` (or self) and writes an audit event |
| Scope | `RolePermission.scope` narrows a grant by legal entity, department or country |

**The manager boundary is real.** A manager sees a report's title, work contact, goals, PTO
and performance. They do **not** see SSN, date of birth, home address, personal email, bank
details or compensation. This is asserted directly in
`tests/integration/permissions.test.ts`, along with IT having no PII or compensation access
and Finance having compensation but no PII reveal.

**Frontend hiding is never the control.** Every restriction visible in the UI is also
enforced in the server action or server component that produces the data.

---

## Document security

There are no public object URLs anywhere in the system.

1. A user requests a download; the server action re-checks authorization and mints a
   short-lived (5-minute) HMAC token bound to **both** the document version and that user.
2. `/api/documents/[versionId]` requires a valid session, verifies the HMAC, and then runs
   the authorization check again before streaming bytes.
3. Every download writes an audit event naming the document and the actor.

A token minted for one user cannot be replayed by another, and an expired token is rejected
(both covered by test).

**Uploads** are validated by extension, declared MIME type, and magic bytes for PDF/PNG/JPEG,
capped at 15 MB, and stored under randomly generated keys outside any web-served directory.
The storage interface accepts a malware-scanning hook for production
(`src/lib/storage.ts`).

---

## Export security

Employee-data exports are high-risk, so `/api/exports`:

- requires the `reports.export` permission **and** the individual report's permission, so a
  manager cannot obtain compensation data by calling the export endpoint directly;
- writes an audit event with the report key, row count and filter parameters;
- returns `Cache-Control: no-store`;
- escapes CSV formula injection (`=`, `+`, `-`, `@` prefixes) so an exported field cannot
  execute in a spreadsheet.

---

## Audit logging

`AuditEvent` records the actor, action, target, before/after values, IP, session and
timestamp for: sign-in, failed sign-in, MFA events, account activation, password reset,
permission and role changes, worker creation and changes, compensation changes, PII reveals,
document access/upload/signature/deletion, exports, terminations, retention destruction,
workflow changes and system maintenance runs.

**Audit rows are append-only at the database level.** A trigger (`fsw_prevent_mutation`)
raises an exception on any `UPDATE` or `DELETE` against `AuditEvent` and
`DocumentSignature`. This holds even against someone using the application's own database
credentials, and is asserted by test. `before`/`after` payloads carry masked values only —
decrypted PII is never written to the audit trail.

---

## Application security controls

| Control | Implementation |
|---|---|
| SQL injection | Prisma parameterizes everything; the few raw queries use tagged templates |
| XSS | React escapes by default. The three `dangerouslySetInnerHTML` uses (policies, announcements) render text that was HTML-escaped at write time |
| CSRF | Next.js server actions verify Origin against Host; session cookie is `sameSite=lax` |
| Clickjacking | `X-Frame-Options: DENY` and `frame-ancestors 'none'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| CSP | `default-src 'self'`, no external scripts, `form-action 'self'`, `base-uri 'self'` |
| Referrer leakage | `strict-origin-when-cross-origin` |
| Device APIs | `Permissions-Policy` denies camera, microphone and geolocation |
| Version disclosure | `poweredByHeader: false` |
| Input validation | Zod schemas in server actions; enum values checked against allowlists |
| Mass assignment | Profile edits use explicit field allowlists (`SELF_EDITABLE` / `HR_EDITABLE`) that differ by permission |
| Error disclosure | Users see friendly messages and a digest; stack traces stay in server logs |
| PII in logs | Application logs carry ids and actions, never decrypted identifiers |

---

## Data integrity as a security property

- Audit events and document signatures cannot be altered (DB trigger).
- Signatures reference a specific `DocumentVersion` — re-uploading a document cannot
  retroactively change what someone signed.
- Circular management structures are rejected by a DB trigger.
- Approval decisions are immutable; a decided request cannot be re-decided.
- Termination closes employment records but never deletes history.
- PTO is a balanced ledger; cancelling an approved request writes a compensating entry
  rather than deleting the original.

---

## Privacy

Data classifications (`PUBLIC_INTERNAL`, `INTERNAL`, `CONFIDENTIAL`, `HIGHLY_RESTRICTED`)
are applied to documents and drive access rules.

**Philippine workers**: data is treated as sensitive personal information consistent with
Data Privacy Act principles — legitimate purpose, minimal collection, transparency, limited
access, retention limits and auditability. The PH onboarding template includes a privacy
notice acknowledgment step, and a seeded compliance rule tracks it with the National Privacy
Commission as its cited source.

**Retention and destruction**: retention policies are configurable per record type,
jurisdiction and worker type. The system calculates destruction *eligibility* but never
destroys anything on its own. Destruction requires an explicit, documented approval by a
`retention.admin`, anonymizes restricted personal data, and preserves employment history so
historical reporting stays honest. Every destruction is audited.

**Survey anonymity**: anonymous survey responses store a one-way keyed hash of the worker id
rather than the id, so duplicates are prevented without identifying the respondent. Results
stay hidden until a configurable minimum number of responses arrive, so small-group results
cannot defeat anonymity.

---

## AI assistant boundaries

The AI assistant architecture (disabled unless `AI_PROVIDER` is configured) is constrained:
it runs under the requesting user's permissions and can never see more than that user can;
retrieval is permission-filtered before any prompt is built; whole personnel records are
never shipped to a provider; usage is logged. AI may summarize, draft and compare against
explicit job requirements. AI may **not** autonomously reject a candidate, terminate a
worker, change pay, or make a legal determination — every such action requires a human
decision recorded in the audit trail.

`src/lib/ai/client.ts` is the only place the application talks to an external model. It
holds no credentials of its own beyond the configured API key and is never reachable
without a prior permission check by the caller.

### AI interview questions

The one AI feature shipped today generates five suggested interview questions for an
application. Its boundaries, in order of how they are enforced:

1. **Authorization first.** `generateInterviewQuestionsAction` calls
   `requirePermission('recruiting.write')` before reading anything. A user who cannot open
   the pipeline cannot invoke the generator by any route.
2. **Minimal input.** Only the candidate's *first* name, their résumé text, and the job's
   description and requirements are sent — all of which the caller can already read on the
   page they invoked it from. No personnel record, no pipeline history, no notes, no
   scorecards, no surname, no email, no phone number.
3. **Redaction before egress.** `src/lib/ai/redact.ts` strips email addresses, phone
   numbers, US SSNs, Philippine government identifiers (SSS, TIN, PhilHealth, Pag-IBIG),
   bank and card numbers, street addresses, stated dates of birth, and URLs from the résumé
   before it leaves the process. What was removed is recorded on the stored set and shown
   in the UI. This is data minimisation, not a security boundary — the résumé body is still
   candidate data, sent because a recruiter asked for it.
4. **Protected characteristics are refused twice.** The system prompt forbids asking about
   or inferring age, race, ethnicity, national origin, citizenship, disability, health,
   religion, political belief, union membership, sexual orientation, gender identity,
   pregnancy, children, marital or family status, criminal history, and salary history.
   Every returned question, rationale and listen-for note is then screened in code against
   the same list. **A model instruction is a request; the screen is the enforcement.** If
   screening leaves fewer than five usable questions the whole set is discarded and nothing
   is stored.
5. **Output is inert.** A question set carries no score, no ranking and no recommendation,
   and the action has no code path that touches application status. Rejection remains
   `rejectApplicationAction`: `recruiting.write`, a mandatory written reason, and an audit
   event.
6. **Audit trail.** Each set stores who generated it, the model that produced it, and what
   the model was shown, and writes a `recruiting.ai_questions_generated` audit event. The
   UI labels the output AI-assisted wherever it appears.

Unverified: a successful live generation has not been exercised against the Anthropic API,
because no API key was available in this environment. The permission check, redaction,
guardrail screen, error handling and UI wiring were verified end to end — a click with an
invalid key surfaces "The AI service rejected our credentials" rather than failing silently
(`scripts/verify-ai-questions.ts`).

---

## Job board integration (Indeed)

Two endpoints face the outside world. Neither trusts anything it is given.

**The job feed** (`/api/indeed/feed`) is a credential-protected URL, because Indeed's
crawler cannot present a session. `INDEED_FEED_TOKEN` is compared with a constant-time
comparison; a request with a missing or wrong token gets **404, not 403**, so an
unauthenticated caller learns nothing about whether a feed exists. Denied attempts are
audited. The feed carries only fields a jobseeker would see: never the hiring manager,
recruiter, headcount, replacement flag or approval history, and never the salary range
unless a recruiter explicitly published it. Descriptions are wrapped in CDATA with `]]>`
split across sections, so no requisition text can break out of the document.

The feed URL embeds the token and is therefore a credential. It is never rendered by
default — an admin must click **Reveal feed URL**, which requires `settings.admin` and
writes an `integration.secret_revealed` audit event.

**The Indeed Apply webhook** (`/api/indeed/apply`) verifies an HMAC-SHA256 signature over
the **raw request bytes**, never a re-serialized object, so an attacker cannot vary
whitespace or key ordering to reuse a signature. An unverified body is not parsed beyond
its shape and nothing derived from it is stored. Bodies are size-capped before parsing;
résumé files are capped at 8 MB and pass the same extension/MIME/magic-byte validation as
any upload.

Applications are only accepted for a requisition that is *currently published and open* —
knowing an old job id is not enough. Idempotency is a database guarantee:
`Application.sourceRef` is unique, so a webhook retry cannot create a second application
even if two deliveries race.

`JobBoardDelivery` records every exchange, accepted or refused, and carries the same
append-only database trigger as `AuditEvent` — rows cannot be updated or deleted. It stores
a digest (which job, which fields were present) rather than a second copy of the applicant's
email, phone, résumé or cover letter.

**The public careers pages** (`/careers`) are the only unauthenticated content in the
application. They render published postings only, share nothing with the authenticated app,
and reaching any other path without a session still bounces to `/login`.

**Not implemented, deliberately:** pushing hire/reject dispositions back to Indeed. That
requires Indeed's partner Disposition API and credentials FSW Group does not hold. Rather
than ship a control that appears to notify Indeed and does not, the limitation is stated in
the admin UI and in `ADMIN_GUIDE.md`.

---

## Deployment responsibilities

1. Set all secrets from a secrets manager. Never commit `.env`.
2. Back up `FIELD_ENCRYPTION_KEY` separately from the database.
3. Force TLS; verify security headers reach the browser through your CDN/proxy.
4. Use a least-privilege database role — the application does not need `SUPERUSER` or
   `CREATEDB` in production.
5. Keep the object storage bucket private with public access explicitly blocked.
6. Enable dependency scanning (`npm audit`, Dependabot) in CI.
7. Restrict who holds `SUPER_ADMIN`, `pii.reveal` and `retention.admin`, and review the
   audit log for those actions periodically.

---

## Incident handling

1. **Contain** — suspend affected accounts in Settings → Users (this revokes their sessions
   immediately); rotate `SESSION_SECRET` to invalidate all sessions if needed.
2. **Assess** — the audit log is the authoritative record. Filter Admin → Audit Log to
   high-risk events (`pii.reveal`, `export.run`, `document.downloaded`,
   `compensation.change`, `auth.login_failed`) for the period in question.
3. **Rotate** — replace any exposed credential: session secret, encryption key (with
   re-encryption), storage keys, SMTP and integration credentials.
4. **Notify** — engage counsel on breach-notification obligations. FSW People deliberately
   does not attempt to determine these itself.
5. **Recover** — restore from backup per the runbook in `DEPLOYMENT.md`.
6. **Review** — record findings and the corrective actions taken.

To report a suspected vulnerability in this application, contact the FSW IT Administrator
directly rather than filing it in a shared tracker.

---

## Internal security review

A structured review was performed against this codebase covering: missing authorization in
server actions, IDOR in route handlers and server components, data leakage, XSS, secrets and
PII in logs, mass assignment, and authentication weaknesses.

**Nine issues were found and fixed.** Each has a regression test in
`tests/integration/security-regressions.test.ts`.

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **Critical** | MFA bypass. `getSession()` does not check `mfaPassed` (correctly — the `/mfa` page needs it), but the account-security page and all four MFA-management actions used it, so a session holding only a stolen password could open that page and turn MFA off, or enroll an attacker-controlled secret. | Added `getFullSession()`, which rejects a session that has not cleared MFA, and switched every MFA-management action and both account pages to it. Disabling MFA now also requires re-entering the password. Verified live with `scripts/verify-mfa-fix.ts`. |
| 2 | High | Goal hijack. `saveGoalAction` authorized the *submitted* fields, not the stored goal, so any employee could pass a company goal's id with their own worker id and take it over. Company goal ids were rendered into every user's alignment dropdown. | Editing now loads the stored goal and authorizes against it (owner, their manager, or `talent.admin`). |
| 3 | High | Task read IDOR. The task detail drawer fetched by id with no ownership check and serialized the task and its full comment thread — including offboarding and disciplinary detail — to any signed-in user who knew an id. | The read path now uses the same `loadOwnedTask()` guard as the mutations. |
| 4 | Medium | Emergency contact IDOR. The update was keyed on `contactId` alone while authorization was on the submitted `workerId`, so any user could overwrite another worker's emergency contact, with the audit entry misattributed. | The update is scoped by `workerId` as well as `id`, and a zero-row result raises. |
| 5 | Medium | No MFA throttling. Failed TOTP verification had no attempt limit, and the three-window tolerance made a six-digit code brute-forceable given a password and a session. | MFA failures now increment the same counter as password sign-in and trigger the same 15-minute lockout. |
| 6 | Medium | Activation tokens (7-day life) could re-activate a live account, reset its password, and issue a session with `mfaPassed: true` regardless of whether MFA was enabled. | Activation now requires `status === 'INVITED'`, revokes existing sessions, and only marks MFA passed when the account has none. `resendInviteAction` refuses non-invited users. |
| 7 | Medium-low | Date of birth is `pii.view`-gated, but the dashboard and calendar exposed birthday month/day for every worker to every user, including contractors, and the calendar's month parameter allowed enumerating the whole company. | Celebration display is now an explicit per-worker opt-out (`Worker.showBirthday`, self-editable), and the year never leaves the server — only month/day reach the component tree. |
| 8 | Low | Login user enumeration. The account-not-found path skipped bcrypt (a ~250 ms timing oracle), and a locked account returned a distinct message. | Both paths now perform an equivalent bcrypt comparison against a fixed dummy hash and return the same generic message. |
| 9 | Low | PTO requests accepted a client-supplied `hours` value with no upper bound, so a worker could book two weeks off while debiting half an hour. | Declared hours are now clamped to the working hours actually in the range; under-declaring (half days) is still allowed. |

Three lower-severity items were also addressed: `docs.write` actions now perform a
per-document access check so the permission stays safe to delegate more narrowly; the
onboarding list is scoped to a manager's own reports rather than showing every instance
org-wide; and `saveFeedbackAction` restricts `visibility` to a known set. Raw Prisma error
objects are no longer logged from profile edits, where the payload can contain a home
address or date of birth.

**Categories found clean:** mass assignment (explicit allowlists throughout), XSS (both
`dangerouslySetInnerHTML` sites render text escaped at write time by permission-gated
actions), route-handler IDOR (document downloads and exports enforce every documented
layer), and secrets in logs.
