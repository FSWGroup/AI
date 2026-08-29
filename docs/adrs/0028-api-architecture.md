# ADR-0028: REST with OpenAPI 3.1, Problem Details errors, ETag concurrency, and idempotency keys

- Status: Accepted (provisional)
- Date: 2026-08-29
- Covers: specification §56–§61

## Context

Every capability must be available through an API before a UI depends on it, with
consistent conventions and a machine-readable contract. §58 requires optimistic
concurrency, §59 idempotency, §60 job semantics for bulk work, and §61 that both
function-level and object-level authorization are tested.

## Decision

### Style and contract

REST over HTTP/JSON. **OpenAPI 3.1** (which is a proper JSON Schema dialect, so one
TypeBox definition produces the route validator and the specification document with no
translation layer). The document is generated from the running route table, served at
`/v1/openapi.json`, and CI fails if the committed copy is stale. A typed TypeScript
client is generated from it.

GraphQL was considered and rejected: it makes object-level authorization harder to reason
about, makes rate limiting and query-cost control a project of its own, and provides
little value for the coarse, well-known access patterns Layer 0 serves.

### Conventions, applied uniformly

- Resource paths are plural nouns: `/v1/organizations`, `/v1/products/{id}/variants`.
- All timestamps are RFC 3339 UTC with an offset. All durations are ISO 8601.
- **Cursor pagination** everywhere (`?cursor=&limit=`), returning an opaque cursor.
  Offset pagination is not offered — it is wrong under concurrent writes and it degrades.
- Filtering uses explicit, documented query parameters. There is no generic query
  language in v1.
- Sparse field selection via `?fields=`, with a documented default that never includes
  sensitive identifiers (§47) — tax IDs and DUNS require an explicit request and a
  permission, and never appear in logs.
- Every response carries `X-Correlation-Id`, echoed from the request when supplied.

### Errors

**RFC 9457 Problem Details** (`application/problem+json`) with `type`, `title`, `status`,
`detail`, `instance`, plus FSW extensions `code` (a stable machine-readable string),
`correlationId`, and `errors[]` for field-level validation failures. Stack traces, SQL,
secrets, and filesystem paths are never returned; a generic problem document is returned
and the detail goes to the logs with the correlation ID.

### Concurrency

Every mutable resource returns a **strong `ETag`** derived from a monotonic `version`
column. Updates require `If-Match`; a mismatch returns `412 Precondition Failed` with the
current version. Requests without `If-Match` on a mutable resource are rejected with
`428 Precondition Required` — a missing precondition is an error, not a licence to
overwrite. Merge and review workflows require it absolutely (AC25).

### Idempotency

Mutating endpoints accept an `Idempotency-Key` header. `kernel.idempotency_key` stores
key, principal, endpoint, request fingerprint, response status, response body, and
expiry (24 h default). A replay with the same key and same fingerprint returns the stored
response; the same key with a _different_ fingerprint returns `422`. This covers AC's
requirement that a retry never creates two products, two merges, or two source mappings.
Required (not optional) on: create-product, merge, unmerge, create-relationship,
create-source-mapping, and ingestion-run start.

### Bulk operations

Anything that could exceed a few seconds is a **job**, not a request. `POST` returns
`202 Accepted` with a job resource; `GET /v1/jobs/{id}` reports status, progress, counts,
errors, and a result reference. No HTTP request is held open for an import.

### Security

Payloads are validated against schemas with `additionalProperties: false` — no mass
assignment. Responses are serialised through explicit response schemas, so a new internal
column cannot leak (excessive property exposure). Rate limits are per principal and per
endpoint class, with the limits themselves configuration. Third-party payloads
(webhooks, connector responses) are validated as hostile input before anything touches
them.

## Alternatives considered

- **GraphQL** — rejected above. **gRPC** — rejected: poor browser story, and no
  consumer needs it. **JSON:API** — a reasonable convention set, rejected as more
  ceremony than value for a small internal API surface.
- **Version in a header or media type** rather than the path. Rejected: path versioning
  is boring, obvious in logs, and trivially routable.

## Consequences

- `If-Match` discipline is a real ergonomic cost for API clients and is the right one.
- The generated client keeps consumers honest about the contract.

## Reversal cost

Moderate; conventions are pervasive but mechanical to change before consumers exist.

## Revisit if

A consumer's access pattern genuinely needs graph traversal, which would argue for a
narrow, purpose-built endpoint before it argued for GraphQL.
