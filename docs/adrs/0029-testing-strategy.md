# ADR-0029: Tests run against real PostgreSQL; no live third-party systems, ever

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§65 makes testing architecture, not hygiene, and enumerates unit, integration, contract,
property, migration, replay, idempotency, authorization, and performance tests. It
requires real PostgreSQL behaviour rather than mocks, and forbids the normal suite
depending on a live Pipedrive or Prophet 21 environment.

## Decision

### Layers

| Layer | Runner | Against |
|---|---|---|
| Unit | Vitest | Pure domain logic: conversions, scoring, parsing, rule evaluation, survivorship |
| Integration | Vitest | **A real PostgreSQL database**, migrated from zero, per test file, in a uniquely named schema-set or database |
| API contract | Vitest + Fastify `inject` | Routes against the OpenAPI document, asserting request and response conformance |
| Adapter contract | Vitest | Connectors against recorded, sanitized fixtures |
| Property / table-driven | Vitest + fast-check | Units, model numbers, matching, temporal logic, supersession, attribute validation |
| Migration | Vitest | Clean database → all migrations → schema assertions → seed load |
| Replay | Vitest | Create data → wipe a read model → replay from sequence 0 → assert equivalence |
| Idempotency | Vitest | Same command, webhook, file, source record, and event, twice |
| Authorization | Vitest | Positive **and negative** cases per route and per object |
| Performance | Vitest (tagged, excluded from the default run) | Generated catalogue at the agreed size |

**Mocks are not used for the database.** Test doubles exist only at the true system
boundary: HTTP to third parties, object storage, the clock, and ID generation.

### Third-party isolation

No test may reach Pipedrive, Epicor, or an IdP. Connector tests run against fixtures in
`tests/fixtures/<connector>/`, captured from real systems once, sanitized, and committed.
A separate, explicitly tagged `live` suite exists for credentialed manual verification and
never runs in CI.

Fixture coverage is mandated for the failure modes §68 lists: field added, field missing,
null, duplicate source ID, malformed row, unknown enum, changed address, deleted source
record, duplicate webhook, out-of-order webhook, API retry, pagination boundary,
interrupted import, and rerun.

### Determinism

The clock and the ID generator are injected. `Date.now()` and direct UUID generation are
banned in domain code by lint rule, because a test that fails at midnight or once in a
thousand runs destroys trust in the whole suite.

### Seed data

§66 and §67 seeds are treated as a tested artefact, not a fixture dump: multiple
manufacturers; ball, butterfly, control and solenoid valves plus actuators; multiple
sizes, materials, connections and pressure classes; PSI and bar quantities; certifications;
superseded models; cross-references; deliberately incomplete and deliberately invalid
products; messy real-world model-number strings. On the account side: corporate parents,
divisions, plants, ship-tos, contacts, cross-company relationships, and the
`Acme Pharma LLC` / `ACME Pharmaceutical` / `Acme Pharma - West Chester` /
`Acme Pharma Inc.` cluster engineered to exercise deterministic match, fuzzy match,
review, rejection, merge, and unmerge.

### Coverage

Line coverage is reported but is not a gate. The gates that matter are: every acceptance
criterion has a named test; every route has a negative authorization test; every event
schema has a compatibility test; every connector has a drift and a quarantine test.
`docs/testing.md` maps each of the 27 acceptance criteria to the test that demonstrates it.

## Alternatives considered

- **Testcontainers.** The natural choice, and the intended production CI mechanism.
  Not usable in this build environment (no Docker daemon), so the harness targets a
  connection string and provisions per-run databases, working identically against a local
  cluster, a Testcontainers instance, or a CI service container.
- **In-memory PostgreSQL substitutes (pg-mem).** Rejected: they do not implement
  exclusion constraints, `btree_gist`, `pg_trgm`, or real planner behaviour — precisely
  the things this schema depends on.
- **Mocked repositories.** Rejected by §65 and by the fact that the database holds the
  invariants.

## Consequences

- The integration suite needs a database, so `make dev` provisions one and CI runs a
  PostgreSQL service.
- Tests are slower than pure unit tests and are worth it.

## Reversal cost

Low.

## Revisit if

Suite runtime becomes an obstacle, which is addressed by parallel databases before it is
addressed by weakening tests. Tests are never weakened to make them pass (§86).
