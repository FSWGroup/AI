# Architecture Decision Records

Every material decision in Layer 0 has an ADR. An ADR is short, dated, and states what
would make us change our mind.

**All ADRs are currently marked "Accepted (provisional)".** They were decided under
delegated authority on 2026-08-29 in the absence of answers to the Gate 1 discovery
questions. Each records the questions it depends on. They become "Accepted" when the
owner confirms them; several will change when real answers arrive, and the ADRs say
which.

| #                                                           | Decision                                                               | Reversal cost                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| [0001](0001-backend-language-and-framework.md)              | TypeScript on Node 22, Fastify, TypeBox                                | Very high                      |
| [0002](0002-postgresql-as-the-only-datastore.md)            | PostgreSQL 16 baseline; the only datastore                             | Low (adding), high (removing)  |
| [0003](0003-modular-monolith-with-schema-boundaries.md)     | Modular monolith; PostgreSQL schemas as boundaries                     | Low toward extraction          |
| [0004](0004-canonical-identifiers-uuidv7.md)                | UUIDv7 canonical identifiers                                           | Very high                      |
| [0005](0005-sql-first-data-access.md)                       | Kysely; SQL-first; no ORM                                              | Moderate                       |
| [0006](0006-sql-migrations-with-checksum-runner.md)         | SQL migrations, checksum-enforcing runner                              | Low                            |
| [0007](0007-single-party-model-with-roles.md)               | One Party model; organizations play roles                              | Extremely high                 |
| [0008](0008-event-ledger-and-delivery-outbox.md)            | Immutable ledger + mutable outbox; commit-ordered sequence             | Moderate→high                  |
| [0009](0009-event-envelope-and-schemas.md)                  | Envelope, TypeBox→JSON Schema, **no PII in payloads**                  | High                           |
| [0010](0010-no-message-broker-http-feed.md)                 | No broker; HTTP event feed + webhook dispatcher                        | Low                            |
| [0011](0011-field-level-provenance-and-survivorship.md)     | Canonical values are materialized survivorship outputs                 | Very high                      |
| [0012](0012-merge-and-unmerge-by-link-movement.md)          | Merge/unmerge move source links, never rewrite values                  | High                           |
| [0013](0013-pim-attribute-architecture.md)                  | **Typed EAV + fixed-schema facet table; no runtime DDL**               | High (canonical) / low (facet) |
| [0014](0014-product-search-in-postgresql.md)                | Faceted search in PostgreSQL, benchmarked first                        | Low                            |
| [0015](0015-units-and-quantities.md)                        | UCUM units, affine conversion, normalized base values                  | High                           |
| [0016](0016-engineering-designations-are-not-quantities.md) | **Nominal size and pressure class are designations, not measurements** | High, deliberately             |
| [0017](0017-metadata-as-versioned-configuration.md)         | Metadata is version-controlled YAML applied by a loader                | Low                            |
| [0018](0018-temporal-strategy.md)                           | Valid time where real; system time from audit + ledger                 | Moderate                       |
| [0019](0019-authorization-model.md)                         | Data-driven RBAC, explicit scopes, one decision point                  | Moderate                       |
| [0020](0020-authentication-oidc-multi-issuer.md)            | OIDC, multi-issuer, no passwords, no SCIM in v1                        | Low→moderate                   |
| [0021](0021-audit-log.md)                                   | Audit written by the application, not triggers                         | Low                            |
| [0022](0022-ingestion-pipeline.md)                          | One reusable ingestion pipeline; raw preservation                      | Moderate                       |
| [0023](0023-prophet21-connector.md)                         | P21 file adapter behind a source-neutral contract                      | Low                            |
| [0024](0024-pipedrive-connector.md)                         | Pipedrive API authoritative; webhooks are hints                        | Low                            |
| [0025](0025-entity-resolution.md)                           | Deterministic → explainable scoring → human review                     | Low                            |
| [0026](0026-object-storage.md)                              | S3-compatible object storage behind an interface                       | Low                            |
| [0027](0027-privacy-erasure.md)                             | Anonymization + crypto-shredding                                       | Moderate                       |
| [0028](0028-api-architecture.md)                            | REST, OpenAPI 3.1, Problem Details, ETag, idempotency keys             | Moderate                       |
| [0029](0029-testing-strategy.md)                            | Real PostgreSQL; never a live third-party system                       | Low                            |
| [0030](0030-hosting-deployment-and-recovery.md)             | Managed PostgreSQL + containers; tested restore                        | Low                            |
| [0031](0031-analytics-path.md)                              | Read replica + reporting schema; no warehouse                          | Low                            |
| [0032](0032-observability.md)                               | OpenTelemetry; no vendor coupling                                      | Low                            |
| [0033](0033-golden-copy-first-and-scope-boundaries.md)      | **Golden copy first; no write-back; pricing out**                      | Low                            |
| [0034](0034-dependency-discipline.md)                       | Small, justified, pinned dependency set                                | Low                            |

## Writing a new ADR

Copy the structure of any existing one: Context, Decision, Alternatives considered, Why
this wins, Consequences, Risks, Reversal cost, Revisit if. Number sequentially. Never
edit an accepted ADR's decision — supersede it with a new one and link both ways.
