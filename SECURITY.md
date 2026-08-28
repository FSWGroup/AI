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
