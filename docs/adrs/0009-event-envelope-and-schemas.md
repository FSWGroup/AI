# ADR-0009: Event envelope, JSON Schema from TypeBox, and no PII in payloads

- Status: Accepted (provisional)
- Date: 2026-08-29
- Resolves: specification §16, §18, and conflict item 4 (erasure vs. immutability)

## Context

Events outlive the code that produced them. They must be self-describing, versioned,
validated in CI, and documented. They must also not become the reason a lawful erasure
request is impossible to satisfy: an immutable, checksummed ledger cannot be selectively
rewritten without destroying the guarantee that makes it worth having.

## Decision

### Envelope

Every event carries: `event_id` (UUIDv7), `event_type` (`fsw.<module>.<Aggregate><PastTenseVerb>`,
e.g. `fsw.pim.ProductAttributeValueChanged`), `schema_version` (integer, starts at 1),
`aggregate_type`, `aggregate_id`, `occurred_at`, `recorded_at`, `actor_id`, `actor_type`,
`correlation_id`, `causation_id`, `operating_company`, `source` (which connector or
interface caused it), and `payload`.

Field names follow CloudEvents where they map cleanly (`id`, `type`, `source`, `time`,
`subject`), and a CloudEvents-conformant rendering is available at the feed boundary,
but the stored envelope is our own and does not carry CloudEvents ceremony we do not use.

### Schemas

Payload schemas are authored in **TypeBox** in `src/modules/<module>/events/`, which
yields a TypeScript type and a JSON Schema from one definition. CI:

- validates every registered schema against JSON Schema draft 2020-12;
- validates every event emitted in the test suite against its registered schema;
- runs a **compatibility test** comparing each schema against the committed snapshot in
  `docs/events/schemas/`, failing on any backwards-incompatible change to an existing
  version (removed field, narrowed type, new required field);
- regenerates `docs/events/catalog.md` and an AsyncAPI 3 document, failing if the
  committed copy is stale.

### Evolution rules

Additive optional fields are a compatible change within a version. Anything else
requires a new `schema_version`, and both versions are then produced until every known
consumer has migrated. Stored bytes are **never** reinterpreted under a newer schema;
where an old event must be consumed through a newer model, an explicit upcaster is
registered and tested.

### No PII in payloads

Event payloads carry **identifiers and non-personal facts only** — never names, email
addresses, phone numbers, or postal addresses of natural persons. A consumer that needs
a contact's name resolves it from the API using the ID in the event.

This is the mechanism that makes lawful erasure and an immutable ledger coexist: erasing
the canonical person record erases them from every downstream consumer's view, because
no consumer ever received their PII through the ledger. Raw source payloads, which do
contain PII by necessity, are handled by crypto-shredding instead (ADR-0027).

A CI check parses every registered payload schema and fails if a property name matches
the PII deny-list (`*email*`, `*phone*`, `first_name`, `last_name`, `full_name`,
`address*`, `dob`, `ssn`, `tax_id`) unless the schema explicitly marks it
`x-fsw-pii-reviewed` with a justification.

## Alternatives considered

- **Avro + a schema registry server.** Rejected: the specification forbids a registry
  server without demonstrated need, and JSON Schema is adequate at our volume.
- **Protobuf.** Better wire efficiency, worse human readability in a `jsonb` column, and
  a code-generation step. Rejected.
- **Full CloudEvents adoption.** Adopted as an influence and a rendering, not as the
  stored format.
- **Allowing PII in payloads with ledger rewriting for erasure.** Rejected: it makes the
  ledger mutable in exactly the case where auditors most need it not to be.

## Consequences

- Consumers must call back for personal data. This is a real ergonomic cost and it is
  the price of the erasure guarantee.
- Event payloads are small, which helps ledger growth.

## Risks

A well-meaning developer adds a `contactEmail` field for convenience. Mitigated by the
CI deny-list check, which is cheap and mechanical.

## Reversal cost

High. Payload shape is a published contract.

## Revisit if

Legal advice establishes that FSW has no erasure obligation whatsoever — which would not
change the recommendation, because callback-for-PII is good practice regardless.
