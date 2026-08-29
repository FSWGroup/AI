# Implementation plan

Narrow vertical slices. Every phase ends in a working, tested, documented, demonstrable
state. No phase is "backend complete".

Each phase lists migrations, events, APIs, data-quality checks, security considerations,
and explicit exit criteria. The acceptance criteria (AC1–AC27) from the specification are
mapped to the phase that demonstrates them.

| Phase | Delivers | Demonstrates | Status |
|---|---|---|---|
| 0 | Repository, tooling, migration runner, CI, docs | `make dev` from a clean clone | ⬜ planned |
| 1 | Kernel, audit, event ledger, outbox, unit of work | AC17, AC18, AC19, AC24 | ⬜ planned |
| 2 | IAM: principals, OIDC, roles, permissions, scopes | AC1, AC2 | ⬜ planned |
| 3 | PIM metadata: units, vocabularies, attributes, types, config loader | AC3, AC6, AC7 | ⬜ planned |
| 4 | PIM products: hierarchy, typed values, inheritance, facet search, quality | AC3, AC4, AC5, AC22 | ⬜ planned |
| 5 | PIM relationships: cross-references, supersession, certifications, assets | AC20, AC21 | ⬜ planned |
| 6 | Party: organizations, sites, locations, accounts, candidates, survivorship | AC10, AC25 | ⬜ planned |
| 7 | Ingestion framework + Prophet 21 file connector | AC14, AC15, AC16, AC26 | ⬜ planned |
| 8 | Entity resolution, review queue, merge, unmerge | AC8, AC9 | ⬜ planned |
| 9 | Pipedrive connector: backfill, incremental, webhooks, reconciliation | AC11, AC12, AC13 | ⬜ planned |
| 10 | Event feed API, webhook dispatcher, replay tooling | AC18, AC19 (external) | ⬜ |
| 11 | Minimal admin UI | operational review workflows | ⬜ |
| 12 | Erasure, retention, restore drill, threat model | AC27 | ⬜ |
| 13 | Performance benchmark at agreed scale | AC4 at real numbers | ⬜ |

---

## Phase 0 — Foundation

**Delivers.** Repository layout, TypeScript strict configuration, Fastify bootstrap,
Kysely wiring, the checksum-enforcing migration runner, the test harness against real
PostgreSQL, `make dev`, CI, and the documentation skeleton.

**Migrations.** `0001` extensions and `kernel.schema_migration`.

**Exit criteria.** A clean clone runs `make dev` and gets a migrated database, a running
API, and a passing test suite. Editing an applied migration fails the runner.

## Phase 1 — Data core

**Delivers.** UUIDv7 in TypeScript and SQL; source-system and operating-company
registries; the UnitOfWork that owns transactions, audit entries and event flushing;
`audit.change_log` with grant-enforced immutability and registry-driven redaction;
`events.domain_event` with commit-ordered sequencing; `events.event_delivery`,
`events.subscription`, `events.consumer_inbox`; the TypeBox event registry with JSON
Schema export and compatibility snapshots; idempotency keys.

**Migrations.** `0002`–`0005`.

**Events introduced.** The envelope itself; `fsw.kernel.*` test events.

**Data-quality checks.** Ledger sequence continuity; audit coverage of every mutating
repository method.

**Security.** `UPDATE`/`DELETE` revoked on `audit.*` and `events.domain_event` for the
application role; secret redaction from the field-classification registry; the CI
PII-in-payload deny-list.

**Exit criteria.** AC17 — every canonical mutation emits a schema-valid event.
AC18 — a read model is wiped and rebuilt by replay from sequence zero. AC19 — duplicate
delivery leaves consumer state correct. AC24 — every write traces to actor, operation,
timestamp, entity, correlation, before/after.

## Phase 2 — Identity and access

**Delivers.** `party.person` as the single canonical human; `iam.principal` unifying
people and service accounts; `iam.issuer` and `iam.identity` for multi-issuer OIDC with
`(issuer, subject)` identity; JWKS validation; JIT provisioning with domain allow-lists;
service accounts with Argon2id credentials and overlapping rotation; roles, permissions,
scopes and assignments as data; the central authorization decision point; the mandatory
scope predicate in the repository layer; `/v1/me`; `POST /v1/authz/check`.

**Migrations.** `0006`–`0008`.

**Events.** `fsw.iam.PersonRegistered`, `IdentityLinked`, `PrincipalRoleAssigned`,
`PrincipalRoleRevoked`, `ServiceAccountCreated`, `CredentialRotated`.

**APIs.** `GET /v1/me`, `POST /v1/authz/check`, principal and role administration.

**Security.** Default deny; a route without a declared permission fails at startup;
authorization denials are audited; credentials are never returned after creation.

**Exit criteria.** AC1 — one identity recognised by two API audiences without a
second person ID. AC2 — a ValveMan-only principal is denied a Welsford-only resource,
with a negative test and an audit entry.

## Phase 3 — PIM metadata

**Delivers.** Quantity dimensions and UCUM units with affine conversion; the conversion
service with property and reference tests; controlled vocabularies with aliases that
distinguish normalization from asserted equivalence; nominal-size and pressure-class
designation vocabularies; attribute definitions with ten value types; product types with
inheritance; conditional applicability rules in a deliberately limited, versioned,
non-executable DSL; the YAML metadata loader with destructive-change protection.

**Migrations.** `0009`–`0011`.

**Events.** `fsw.pim.AttributeDefined`, `AttributeDeprecated`, `ProductTypeDefined`,
`VocabularyTermAdded`, `MetadataVersionApplied`.

**Data-quality checks.** Every attribute of type `QUANTITY` declares a dimension; every
`ENUM` declares a vocabulary; no designation vocabulary is reachable from conversion.

**Exit criteria.** AC3 (metadata half) — a new product type and new attributes are
created from configuration with no code change and no migration. AC6 — a pressure entered
in bar is preserved, normalized, and returned in PSI. AC7 — Class 150 cannot become
150 PSI and NPS 1 is not 25.4 mm, proven by tests that require the operations to fail.

## Phase 4 — PIM products and search

**Delivers.** Brand, product line, family, product, variant; external product
identifiers with namespaces; typed attribute values with provenance, valid time and
exclusion-constrained selection; inheritance resolution; the synchronous facet
projection; the filter query engine with unit-aware range matching; completeness and
publishability rules; the quality finding model.

**Migrations.** `0012`–`0015`.

**Events.** `fsw.pim.ProductCreated`, `VariantCreated`, `ProductAttributeValueChanged`,
`VariantLifecycleChanged`, `VariantQualityEvaluated`.

**APIs.** Product and variant CRUD with ETag concurrency and idempotency keys;
`POST /v1/variants/search` for faceted filtering; `GET /v1/variants/{id}/attributes`
returning resolved effective values **with provenance**.

**Data-quality checks.** Completeness score per variant per channel; blocking-rule
failures excluded from publishable views; facet-projection drift detection.

**Exit criteria.** AC3 (full) — products created using attributes that did not
exist when the application was built. AC4 — combination filtering meets the provisional
SLO on the generated catalogue. AC5 — a product created through the API is immediately
discoverable by filter, with no projection wait. AC22 — a variant missing a required Cv
is identified and excluded from the ValveMan publishable view.

## Phase 5 — Relationships, certifications, assets

**Delivers.** Typed product relationships with confidence, evidence, verification and
valid time; supersession chain resolution with cycle prevention; certifications as
entities with issuing body, standard revision, scope and applicability; assets with
content-addressed storage and revision history.

**Migrations.** `0016`–`0018`.

**Events.** `fsw.pim.ProductRelationshipAsserted`, `RelationshipVerified`,
`SupersessionChainChanged`, `CertificationApplied`, `AssetRevisionAdded`.

**APIs.** `GET /v1/variants/{id}/successor` resolving the active successor with the full
chain; `GET /v1/variants/{id}/cross-references` distinguishing relationship types.

**Exit criteria.** AC20 — A → B → C resolves to C with chain and evidence, and a
cycle is rejected. AC21 — an exact equivalent and a functional alternate are clearly
distinguished with confidence and verification exposed.

## Phase 6 — Party and survivorship

**Delivers.** Organizations with roles; sites; locations with raw preservation and
normalization; commercial accounts; ship-tos; organization relationships with cycle
prevention; person affiliations with history; the candidate-value model; the
configurable survivorship engine; the field-ownership register; divergence reporting.

**Migrations.** `0019`–`0022`.

**Events.** `fsw.party.OrganizationCreated`, `OrganizationFieldValueChanged`,
`SiteCreated`, `PersonAffiliationStarted`, `PersonAffiliationEnded`,
`CommercialAccountLinked`.

**Exit criteria.** AC10 — two sources disagree on one field; both values, the
winner, the reason and the origin are all visible; changing the rule re-evaluates safely.
AC25 — a stale write is rejected with a precondition failure rather than overwriting.

## Phase 7 — Ingestion and Prophet 21

**Delivers.** The staged pipeline; connector registry; run bookkeeping with watermarks
and counters; landed files with checksums and immutable preservation; source records with
full version history; quarantine with categories and retry state; structural
fingerprinting and drift halting; reconciliation modes; the P21 file connector with
header-name parsing, declared encoding, explicit null semantics, time-zone handling,
duplicate-key detection, snapshot-diff deletion detection and multi-file manifests.

**Migrations.** `0023`–`0025`.

**Events.** `fsw.ingest.RunStarted`, `RunCompleted`, `RunFailed`, `SourceRecordObserved`,
`SourceRecordChanged`, `RecordQuarantined`, `SchemaDriftDetected`.

**Exit criteria.** AC14 — a representative export is ingested with file identity,
record identity, source values, mapping version and lineage preserved; re-ingesting the
same file creates no duplicate business facts. AC15 — an unexpected structural change is
detected and the run fails safely without shifting data into the wrong fields. AC16 — a
malformed record is quarantined with a useful reason while the import continues.
AC26 — canonical services depend on the abstract ingestion contract, proven by a test
that builds a synthetic connector with no P21 or Pipedrive knowledge.

## Phase 8 — Entity resolution, merge, unmerge

**Delivers.** Blocking key generation; deterministic matching; the explainable weighted
scorer with a persisted feature vector; the review queue with decision persistence and
evidence fingerprints; merge by source-link movement with a full movement ledger;
unmerge by exact reversal; merged-ID redirect semantics; the child-table registration
test that fails when a new organization-owned table is not registered in the merge
manifest.

**Migrations.** `0026`–`0028`.

**Events.** `fsw.party.MatchCandidateRaised`, `MatchDecided`, `OrganizationsMerged`,
`OrganizationMergeReversed`.

**Exit criteria.** AC8 — records for the same plant from two independent sources
produce an explainable candidate, which is approved, creating the canonical relationship
while preserving both source records. AC9 — the merge is undone, canonical relationships
are restored, and neither source record is lost.

---

## Phase 9 — Pipedrive

**Delivers.** OAuth/token credential handling with rotation; cursor-paginated backfill
with per-object checkpoints; incremental sync with an overlap window; Webhooks v2 receipt
with signature verification, replay-window checking, delivery-ID de-duplication and
asynchronous processing; fetch-on-hint (the API is authoritative); reconciliation by
source-ID set difference and updated-window comparison; custom-field definition ingestion
with versioned mapping.

**Blocked on.** Question D1 — a read-only token for fixture capture. The connector can be
built and tested against synthetic fixtures without it, but the fixtures will not reflect
FSW's real Pipedrive schema until it arrives, and every endpoint detail in ADR-0024
remains unverified against live documentation.

**Exit criteria.** AC11 — an interrupted backfill restarts with no duplicate canonical
records. AC12 — the same webhook processed twice leaves canonical state and event output
correct. AC13 — a simulated missed webhook is discovered and processed by reconciliation.

## Phase 10 — Event feed and dispatcher ⬜

`GET /v1/events` cursor feed; subscription management; the HMAC-signed webhook dispatcher
with backoff, jitter, circuit breaking and a visible failed queue; replay tooling with a
documented runbook. Exit: an external consumer rebuilds its state from sequence zero
through the public API.

## Phase 11 — Admin UI ⬜

Server-rendered, deliberately plain. Inspect a canonical record and its source records
and provenance; review and decide match candidates; merge and unmerge with reason capture;
browse metadata read-only; inspect product completeness; inspect and re-drive ingestion
failures; read event and audit history. **Not** a CRM, **not** a PIM authoring
application, and metadata editing stays in pull requests (ADR-0017).

## Phase 12 — Privacy, retention, recovery ⬜

Erasure by anonymization and crypto-shredding; the erasure request register; retention
jobs; the restore runbook and an automated restore drill; the Layer 0 threat model.
Exit: AC27 — a clean environment is provisioned from backup and verified.

## Phase 13 — Performance ⬜

Reproducible load tests at the agreed catalogue size and concurrency, with query plans
recorded. Exit: AC4 met at real numbers, or an evidenced escalation proposal per
ADR-0014's ladder.
