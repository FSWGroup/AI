# ADR-0020: OIDC authentication, multi-issuer by construction, no local passwords

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§12 requires external OIDC authentication, one canonical person per human, explicit
IdP-subject mapping, and a prohibition on using a mutable email address as identity.
Whether FSW standardises on Microsoft Entra ID or Google Workspace is unanswered
(question G1), and Welsford and ValveMan may not share a directory (G2).

## Decision

**Build multi-issuer support from the start.** It is a small amount of extra work now and
a painful retrofit later, and the uncertainty is real.

- `iam.identity(person_id, issuer, subject, tenant_id, email_at_link, display_name_at_link,
linked_at, last_seen_at, disabled_at)` with `UNIQUE (issuer, subject)`.
  The `(issuer, subject)` pair is the permanent identity. Email is stored only as a
  human-readable hint of what it was when linked, and is never used for lookup.
- `iam.issuer` registers each trusted issuer: issuer URL, JWKS URI, audience, allowed
  tenant IDs, whether JIT provisioning is permitted, and the default operating company.
- Tokens are validated against the issuer's JWKS with cached keys, checking `iss`, `aud`,
  `exp`, `nbf`, and signature. No token is trusted because it parses.
- **No password storage, no password reset, no MFA implementation.** MFA is the IdP's job.
- A person may hold several identities (one per issuer), which is exactly how one human
  who exists in both a Welsford tenant and a ValveMan tenant stays one person — the
  mechanism acceptance criterion 1 requires.

### Provisioning

**Administrative provisioning with optional JIT, no SCIM in v1.**

- JIT: on first successful authentication from an issuer with `jit_enabled`, if no
  identity matches, Layer 0 creates a person **only** if the token's verified email
  domain is on the issuer's allow-list; otherwise it creates a _pending link request_ for
  an administrator. New persons get no roles — authentication without authorization.
- Deprovisioning is explicit: disabling in the IdP stops authentication, and a documented
  runbook ends affiliations and revokes role assignments in Layer 0.
- SCIM is deferred (§12 warns against implementing it merely because it exists). At FSW's
  headcount, administrative provisioning plus a quarterly access review is proportionate.
  The `iam.identity` shape is SCIM-compatible if that changes.

### Service accounts and machine credentials

- `iam.service_account` is a principal with no person. Connectors, the dispatcher, and
  future applications each get one, so every automated write has an accountable identity.
- `iam.api_credential` stores an Argon2id hash of the secret, never the secret; carries
  `expires_at`, `last_used_at`, `rotated_from_id`; and supports overlapping rotation so a
  credential can be replaced without downtime.
- API keys are for machines only and never satisfy a human authentication requirement.
- Credentials expiring within 30 days raise a metric and an alert.

## Alternatives considered

- **Single-issuer now, generalise later.** Rejected: `UNIQUE(subject)` would be baked
  into the schema and into every consumer's assumptions.
- **Layer 0 as its own IdP.** Rejected by §80 and by good sense.
- **Email as the join key.** Rejected by §12; people change names and domains, and
  addresses get reused.
- **SCIM now.** Deferred as above.

## Consequences

- Adding Google Workspace alongside Entra later is a configuration row.
- The `/v1/me` bootstrap resolves `(issuer, subject)` → person → principal → permissions
  in one call, which is the whole of AC1.

## Risks

JIT provisioning on a misconfigured issuer could admit unintended people. Mitigated by
domain allow-lists, by granting no roles on creation, and by an audit event on every
person creation.

## Reversal cost

Low to moderate.

## Revisit if

FSW adopts SCIM-capable directory tooling and joiner/mover/leaver volume justifies it.
