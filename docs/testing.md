# Testing

Testing is architecture here, not hygiene (spec §65, ADR-0029).

## Running the suite

```bash
make db-up     # PostgreSQL via Docker, or a system install if no Docker daemon
make test      # everything except performance benchmarks
make test-perf # benchmarks, which need a generated catalogue
make check     # exactly what CI runs
```

The integration suite needs a real PostgreSQL. It creates a migrated **template**
database once, then clones it per test file, so migration cost is paid once per run and
each file is fully isolated. Databases are dropped in `afterAll`; a run leaves nothing
behind.

`DATABASE_TEST_URL` (or `DATABASE_URL`) points at any PostgreSQL 16+. It works
identically against a local cluster, Docker Compose, Testcontainers, or a CI service
container.

## What is tested where

| Directory             | Concern                                                |
| --------------------- | ------------------------------------------------------ |
| `tests/kernel/`       | Pure primitives: identifiers, clock, conversion        |
| `tests/platform/`     | Migration engine, database plumbing                    |
| `tests/datacore/`     | UnitOfWork, audit, event ledger, ordering, projections |
| `tests/architecture/` | Module boundaries, import graph, cross-schema coupling |
| `tests/iam/`          | Authentication, authorization — including every denial |
| `tests/pim/`          | Units, vocabularies, attributes, facets, quality       |
| `tests/party/`        | Survivorship, matching, merge and unmerge              |
| `tests/ingest/`       | Pipeline, connectors, drift, quarantine, idempotency   |
| `tests/perf/`         | Benchmarks. Excluded from the default run              |

## Rules

**Never mock the database.** This schema depends on exclusion constraints, `btree_gist`,
`pg_trgm` and real planner behaviour. A substitute that implements none of them proves
nothing. Test doubles exist only at the true system boundary: outbound HTTP, object
storage, the clock, and the identifier generator.

**Never contact a third party.** No test reaches Pipedrive, Epicor or an identity
provider. Connector tests run against sanitized fixtures in `tests/fixtures/`. A
credentialed `live` suite exists for manual verification and never runs in CI.

**Never weaken a test to make it pass** (spec §86). If a test is wrong, fix the test and
say why in the commit. If the code is wrong, fix the code.

**Every route needs a negative authorization test.** "The happy path works" is not
evidence that the resource is protected.

## Acceptance criteria map

The 27 acceptance criteria from the specification, and the test that demonstrates each.
Rows fill in as phases land.

| #   | Criterion                                                                       | Test                                  | Status |
| --- | ------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| 17  | Every canonical mutation emits a schema-valid event                             | `datacore/unit-of-work.test.ts`       | ✅     |
| 18  | Wipe a read model, replay from zero, reconstruct it                             | `datacore/projection.test.ts`         | ✅     |
| 19  | Duplicate event delivery leaves consumer state correct                          | `datacore/projection.test.ts`         | ✅     |
| 24  | Every write traces to actor, operation, time, entity, correlation, before/after | `datacore/unit-of-work.test.ts`       | ✅     |
| 1   | One identity, two API contexts, one person ID                                   | `iam/identity.test.ts`                | ⬜     |
| 2   | ValveMan-only principal denied a Welsford-only resource                         | `iam/object-level-authz.test.ts`      | ⬜     |
| 3   | New product type and attributes, no code change, no migration                   | `pim/metadata-loader.test.ts`         | ⬜     |
| 4   | Combination filter meets the SLO                                                | `perf/product-filter.perf.ts`         | ⬜     |
| 5   | A product is filterable immediately after commit                                | `pim/search-consistency.test.ts`      | ⬜     |
| 6   | Enter bar, preserve it, return PSI, match a PSI range                           | `pim/units.test.ts`                   | ⬜     |
| 7   | Class 150 is not 150 PSI; NPS 1 is not 25.4 mm                                  | `pim/engineering-semantics.test.ts`   | ⬜     |
| 8   | Two sources, explainable match, approve, both records preserved                 | `party/entity-resolution.test.ts`     | ⬜     |
| 9   | Undo the merge, restore relationships, lose nothing                             | `party/unmerge.test.ts`               | ⬜     |
| 10  | Two sources disagree: both values, winner, reason, origin                       | `party/survivorship.test.ts`          | ⬜     |
| 11  | Interrupted Pipedrive backfill restarts without duplicates                      | `ingest/pipedrive-backfill.test.ts`   | ⬜     |
| 12  | The same webhook twice is harmless                                              | `ingest/pipedrive-webhook.test.ts`    | ⬜     |
| 13  | A missed webhook is found by reconciliation                                     | `ingest/pipedrive-reconcile.test.ts`  | ⬜     |
| 14  | P21 import preserves lineage; re-import creates no duplicates                   | `ingest/p21-import.test.ts`           | ⬜     |
| 15  | P21 schema drift fails safely                                                   | `ingest/p21-drift.test.ts`            | ⬜     |
| 16  | A malformed record is quarantined with a useful reason                          | `ingest/quarantine.test.ts`           | ⬜     |
| 20  | A → B → C resolves to C; cycles rejected                                        | `pim/supersession.test.ts`            | ⬜     |
| 21  | Exact equivalent vs. functional alternate are distinguished                     | `pim/cross-reference.test.ts`         | ⬜     |
| 22  | Missing required Cv excludes a variant from the publishable view                | `pim/quality.test.ts`                 | ⬜     |
| 23  | Model-number parsing with version, confidence, warnings                         | deferred — assumption A-031           | ⬜     |
| 25  | A stale write is rejected, not silently applied                                 | `api/concurrency.test.ts`             | ⬜     |
| 26  | Canonical services depend on the abstract ingestion contract                    | `ingest/adapter-independence.test.ts` | ⬜     |
| 27  | Clean environment restored from backup and verified                             | `docs/runbooks/restore.md` drill      | ⬜     |

## Determinism

The clock and the identifier generator are injected. Domain code may not call
`Date.now()` or generate identifiers directly; a lint rule enforces it. Use
`FixedClock` and `testDeps()` from `tests/support/context.ts`.

## Bugs this suite has already caught

Worth recording, because they are the reason the tests are shaped this way.

- **Feed ordering was lexicographic, not numeric.** `SELECT sequence::text AS sequence
... ORDER BY sequence` made PostgreSQL order by the _text_ output column, so sequence
  10 sorted before 9 and a tailing consumer could move its cursor backwards and
  re-deliver events. Caught by the concurrent tailing-reader test, not by any
  single-writer test. Regression test:
  `datacore/event-ordering.test.ts › orders the feed numerically`.
- **Audit `before`/`after` were double-encoded**, stored as JSON strings rather than
  JSON objects, which would have made every provenance query in the admin UI silently
  return nothing. Caught by asserting on a field _inside_ the recorded row rather than
  on the row's existence.
- **The UnitOfWork imported past two module indexes**, violating ADR-0003 the day the
  rule was written. Caught by `architecture/boundaries.test.ts`.
