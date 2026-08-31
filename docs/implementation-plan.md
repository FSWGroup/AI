# Implementation plan

Narrow vertical slices. Every phase ends in a working, tested, documented, demonstrable
state. No phase is "backend complete".

Each phase lists migrations, events, APIs, data-quality checks, security considerations,
and explicit exit criteria. The acceptance criteria (AC1–AC27) from the specification are
mapped to the phase that demonstrates them.

| Phase | Delivers                                                                   | Demonstrates                  | Status     |
| ----- | -------------------------------------------------------------------------- | ----------------------------- | ---------- |
| 0     | Repository, tooling, migration runner, CI, docs                            | `make dev` from a clean clone | ⬜ planned |
| 1     | Kernel, audit, event ledger, outbox, unit of work                          | AC17, AC18, AC19, AC24        | ⬜ planned |
| 2     | IAM: principals, OIDC, roles, permissions, scopes                          | AC1, AC2                      | ⬜ planned |
| 3     | PIM metadata: units, vocabularies, attributes, types, config loader        | AC3, AC6, AC7                 | ⬜ planned |
| 4     | PIM products: hierarchy, typed values, inheritance, facet search, quality  | AC3, AC4, AC5, AC22           | ⬜ planned |
| 5     | PIM relationships: cross-references, supersession, certifications, assets  | AC20, AC21                    | ⬜ planned |
| 6     | Party: organizations, sites, locations, accounts, candidates, survivorship | AC10, AC25                    | ⬜ planned |
| 7     | Ingestion framework + Prophet 21 file connector                            | AC14, AC15, AC16, AC26        | ⬜ planned |
| 8     | Entity resolution, review queue, merge, unmerge                            | AC8, AC9                      | ⬜ planned |
| 9     | Pipedrive connector: backfill, incremental, webhooks, reconciliation       | AC11, AC12, AC13              | ⬜ planned |
| 10    | Event feed API, webhook dispatcher, replay tooling                         | AC18, AC19 (external)         | ⬜         |
| 11    | Minimal admin UI                                                           | operational review workflows  | ⬜         |
| 12    | Erasure, retention, restore drill, threat model                            | AC27                          | ⬜         |
| 13    | Performance benchmark at agreed scale                                      | AC4 at real numbers           | ⬜         |

---

## Phase 0 — Foundation ✅

**Delivers.** Repository layout, TypeScript strict configuration, Fastify bootstrap,
Kysely wiring, the checksum-enforcing migration runner, the test harness against real
PostgreSQL, `make dev`, CI, and the documentation skeleton.

**Migrations.** `0001` extensions and `kernel.schema_migration`.

**Exit criteria.** A clean clone runs `make dev` and gets a migrated database, a running
API, and a passing test suite. Editing an applied migration fails the runner.

## Phase 1 — Data core ✅

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

> **Sequencing note.** Phase 3 was built before Phase 2. The PIM metadata layer carries
> the project's highest technical risk (ADR-0013 and ADR-0016), it is testable without an
> HTTP surface, and proving it early is worth more than proving conventional
> authentication early. Identity and access remain a prerequisite for the API layer and
> for acceptance criteria 1 and 2.

## Phase 2 — Identity and access

**Delivers.** `party.person` as the single canonical human; `iam.principal` unifying
people and service accounts; `iam.issuer` and `iam.identity` for multi-issuer OIDC with
`(issuer, subject)` identity; JWKS validation; JIT provisioning with domain allow-lists;
service accounts with Argon2id credentials and overlapping rotation; roles, permissions,
scopes and assignments as data; the central authorization decision point; the mandatory
scope predicate in the repository layer; `/v1/me`; `POST /v1/authz/check`.

**Migrations.** `0019`.

**Events.** `fsw.iam.PersonRegistered`, `IdentityLinked`, `PrincipalRoleAssigned`,
`PrincipalRoleRevoked`, `ServiceAccountCreated`, `CredentialRotated`.

**APIs.** `GET /v1/me`, `POST /v1/authz/check`, principal and role administration —
**deferred to Phase 11 with the rest of the HTTP layer.** `describePrincipal` is the
whole of what `/v1/me` returns and is tested; the route that serves it is not written,
because there is no Fastify application yet and building one for two endpoints would
front-run the API decisions in ADR-0028.

**Security.** Default deny; a route without a declared permission fails at startup;
authorization denials are audited; credentials are never returned after creation.

**Status: the domain is delivered.** Multi-issuer OIDC with real JWKS verification,
identity as `(issuer, subject)`, JIT provisioning behind domain allow-lists, pending
link requests, service accounts, Argon2id credentials with overlapping rotation, the
data-driven permission catalogue, the single decision point, the mandatory scope
predicate, and the denial record.

Two notes:

- **`jose` and `@node-rs/argon2` are new dependencies** (ADR-0034 requires that to be a
  deliberate act). Hand-rolling JWT verification is the wrong call at any size, and
  Node has no built-in Argon2. Both are exact-pinned and both ship prebuilt, so
  neither adds a compiler to the build.
- **Argon2id is used for machine credentials that are already 256 bits of CSPRNG
  output**, so the memory hardness is defence in depth rather than the primary control.
  It is kept because the cost of being wrong about that assumption is total and the
  cost of being right anyway is a few milliseconds per authentication.

**Exit criteria.** AC1 — one identity recognised by two API audiences without a
second person ID. AC2 — a ValveMan-only principal is denied a Welsford-only resource,
with a negative test and an audit entry.

## Phase 3 — PIM metadata ✅

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

## Phase 5 — Relationships and certifications ✅

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

**Migrations.** `0015` (party core) and `0016` (survivorship).

**Events.** `fsw.party.OrganizationCreated`, `OrganizationFieldValueChanged`,
`OrganizationRoleGranted`, `OrganizationRelationshipChanged`, `SiteCreated`,
`CommercialAccountLinked`, `PersonAffiliationStarted`, `PersonAffiliationEnded`.

**Status: the survivorship core is delivered** — the candidate model, the configurable
engine with four strategies, the field-ownership register, the divergence view,
organizations with roles and cycle-checked relationships, locations with raw
preservation and conservative normalization, and optimistic concurrency on the write
path. Sites, commercial accounts, ship-tos and person affiliations have their schema
and their events, and the services over them follow with entity resolution in Phase 8,
which is where they acquire their first real caller.

Two design notes worth recording, because both looked like they could go the other way:

- **One candidate table, not four.** `party.field_candidate` carries `entity_type` and
  `entity_id` rather than there being an `organization_field_candidate`, a
  `person_field_candidate` and so on. Referential integrity is not given up to get it:
  stored generated columns (`CASE WHEN entity_type = 'ORGANIZATION' THEN entity_id END`)
  carry a real foreign key per entity type, enforced only for rows of that type. The
  alternative was four near-identical tables and either four code paths or dynamic
  table names in the engine.
- **The mastered-field registry is a table, not a TypeScript constant.** Unlike a
  product attribute, adding a mastered field means adding a column, so it is a
  migration either way and the "no code change" argument does not apply. The registry
  earns its place by being the single declaration the engine, the audit classifier and
  the admin UI all read, and the migration verifies every row against the catalogue so
  a typo fails at migration time.

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

**Migrations.** `0014` (single migration; the phase needed one schema, not three).

**Events.** `fsw.ingest.RunStarted`, `RunCompleted`, `RunHalted`, `SourceRecordChanged`,
`RecordQuarantined`, `SchemaDriftDetected`. `RunFailed` was folded into `RunCompleted`
carrying a status, and `SourceRecordObserved` was dropped: an event for every unchanged
record on every run is volume without a consumer, and "nothing changed" is already
visible in the run counters.

**Status: delivered**, except reconciliation modes, which belong with Pipedrive in
Phase 9 — reconciliation exists to catch missed webhooks, and there are none yet. The
run table and `ingest.reconciliation` are in place for it.

Three defects this phase's own tests found are recorded in
[`testing.md`](testing.md#bugs-this-suite-has-already-caught): a re-presented full
extract marking every record deleted, only one half of a duplicate key being
quarantined, and drift detection rolling back the record a reviewer needs.

One limitation is worth stating rather than leaving implied: the single-byte code pages
are total, so a file declared `windows-1252` that is really UTF-8 decodes to mojibake
and no decoder can detect it. The reverse — a wrong `utf-8` declaration — does fail
loudly. The declared encoding is therefore a configuration decision a person has to get
right, and it is recorded on every landed file so a later correction is possible.

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

**Migrations.** `0017` (resolution and merge) and `0018` (manifest exclusions).

**Events.** `fsw.party.MatchCandidateRaised`, `MatchDecided`, `OrganizationsMerged`,
`OrganizationMergeReversed`.

**Status: delivered for organizations.** Three-stage resolution — deterministic rules,
explainable weighted scoring, human review — with the feature vector persisted on every
candidate; merge and unmerge by link movement; the merge manifest and its tripwire test.
Person and site resolution reuse the same scorer and queue and follow when those
services acquire callers.

Automatic linking ships **disabled**: the default `auto_link_threshold` is 1.010, above
any achievable score. A bad automatic merge is expensive to notice and cheap to avoid,
and no threshold chosen before seeing real FSW data is worth the risk. Turning it on is
a configuration change once precision has been measured against a labelled set.

Two notes on how the stages interact, both learned from the tests:

- **The deterministic name floor is high (0.85 trigram) and that makes the composite
  rules fire rarely.** "Acme Pharma" against "Acme Pharmaceutical" scores 0.52, so the
  domain-and-name rule does not fire even though both records share a website — the
  weighted stage catches it at 0.76 and sends it to a person. This is the intended
  behaviour: a deterministic rule bypasses scoring entirely, so it must not fire on a
  plausible coincidence. Two subsidiaries can share a corporate website.
- **The trigram implementation is duplicated, deliberately.** Scoring is a pure
  function so the combinatorial rule behaviour can be tested without a fixture per case,
  which means reimplementing `pg_trgm`'s definition in TypeScript. A test compares the
  two against a corpus, because a silent drift would let a pair block in SQL and score
  differently in the application.

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
