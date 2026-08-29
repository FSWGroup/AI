# ADR-0019: Data-driven RBAC with explicit scopes, one decision point, default deny

- Status: Accepted (provisional)
- Date: 2026-08-29
- Resolves: conflict item 1

## Context

Acceptance criteria 1 and 2 require that one canonical identity is recognised by two
distinct consuming contexts without minting a second person, and that a ValveMan-only
user is denied a Welsford-only resource. Hidden inside those is the real architectural
question: **how does a future FSW application obtain an authorization decision?**

Three answers are possible and they have very different consequences. §5 also forbids
introducing a separate policy engine.

## Decision

### Delivery model: directory + claims, with an optional decision endpoint

1. Layer 0 is the **authoritative directory** of principals, roles, permissions and
   scopes. `GET /v1/me` returns the caller's canonical person ID, principal ID, roles,
   permissions and scopes.
2. For Layer 0's own API, authorization is enforced **inside Layer 0** at a single
   decision point.
3. Consuming applications receive the principal's permission set from `/v1/me` (cacheable
   with a short TTL and an ETag) and enforce locally for their own resources. They do
   **not** get to invent permissions: a consuming app's permissions are registered in
   Layer 0's permission catalogue.
4. A `POST /v1/authz/check` batch decision endpoint exists for cases where a consumer
   cannot cache — deliberately minimal, not a general policy service.

We are not building a policy engine, a policy language, or an OPA sidecar. The model is
deliberately just rich enough for FSW's actual shape.

### Model

```
PRINCIPAL ──< PRINCIPAL_ROLE_ASSIGNMENT >── ROLE ──< ROLE_PERMISSION >── PERMISSION
                        │
                    SCOPE (scope_type, scope_id)
```

- **Principal** is the unified subject: a person-principal (backed by `party.person`) or a
  service account. Everything that acts has exactly one principal.
- **Permission** is `<resource>.<action>` — `product.read`, `product.write`,
  `account.read`, `account.merge`, `account.unmerge`, `identity.admin`,
  `ingest.run`, `pii.erase`. Permissions are rows, seeded from configuration (ADR-0017).
- **Scope** is `FSW_GROUP` (all), `OPERATING_COMPANY:<WELSFORD|VALVEMAN>`, or
  `DOMAIN:<name>` for narrow administrative carve-outs. Assignments are per (principal,
  role, scope), so one person can be a product editor at ValveMan and a reader at
  Welsford.
- **Default deny.** Every route declares its required permission; a route with no
  declaration fails a startup assertion, so forgetting is impossible rather than silent.

### Object-level authorization

Function-level permission is never sufficient. Every canonical entity that is
company-specific carries an `operating_company` (or resolves one through its
relationships), and the repository layer applies a **mandatory scope predicate** derived
from the principal, so an out-of-scope row is not merely rejected — it is not returned.
This is enforced by making scoped reads go through a repository helper that requires a
`ScopeFilter` argument; a lint rule and a test forbid raw scoped queries elsewhere.

`tests/iam/object-level-authz.test.ts` covers acceptance criterion 2 explicitly,
including the negative case, and every denial is audited.

### The unresolved question this ADR cannot settle

After entity resolution merges a ValveMan customer with a Welsford customer into one
organization, what does a ValveMan-only user see? The provisional rule implemented is:
**organization identity and sites are visible group-wide; commercial accounts, ship-tos,
contacts' commercial relationships, and role assignments are visible only within their
owning operating company.** This is assumption A-021 and open question I6.

## Alternatives considered

- **Layer 0 mints its own JWTs containing permissions.** Attractive, and rejected for v1:
  it makes Layer 0 a token issuer with key rotation and revocation obligations, when the
  IdP already does that job. Consumers validate the IdP's token; Layer 0 supplies claims
  data separately.
- **A decision endpoint per request (pure PDP).** Rejected: a network hop on every
  authorization check, and it makes Layer 0 a hard availability dependency for every
  future app's read path.
- **ABAC / policy language (OPA, Cedar).** Rejected per §5; genuinely more powerful and
  genuinely more operational surface than FSW needs.
- **Permissions in code.** Rejected per §12 — the specification's named anti-pattern.

## Consequences

- Consumers cache permissions and are therefore up to one TTL stale on revocation.
  Mitigated by a short TTL (60 s default) and by `fsw.iam.PrincipalPermissionsChanged`
  events for consumers that want immediacy.
- Adding a permission is a configuration change, not a deployment.

## Risks

Scope predicate omission in a hand-written query. Mitigated by the repository helper,
the lint rule, and the authorization test suite's negative cases.

## Reversal cost

Moderate. The permission catalogue is data; the delivery model is a published contract.

## Revisit if

A consuming application needs row-level rules that scope cannot express (e.g. "only
accounts in my territory"), which would argue for adding a narrow, tested predicate
extension — not a policy engine.
