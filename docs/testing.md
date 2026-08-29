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

| #   | Criterion                                                                       | Test                                                                 | Status                                                    |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| 17  | Every canonical mutation emits a schema-valid event                             | `datacore/unit-of-work.test.ts`                                      | ✅                                                        |
| 18  | Wipe a read model, replay from zero, reconstruct it                             | `datacore/projection.test.ts`                                        | ✅                                                        |
| 19  | Duplicate event delivery leaves consumer state correct                          | `datacore/projection.test.ts`                                        | ✅                                                        |
| 24  | Every write traces to actor, operation, time, entity, correlation, before/after | `datacore/unit-of-work.test.ts`                                      | ✅                                                        |
| 1   | One identity, two API contexts, one person ID                                   | `iam/identity.test.ts`                                               | ⬜                                                        |
| 2   | ValveMan-only principal denied a Welsford-only resource                         | `iam/object-level-authz.test.ts`                                     | ⬜                                                        |
| 3   | New product type and attributes, no code change, no migration                   | `pim/metadata-loader.test.ts`, `pim/catalog.test.ts`                 | ✅                                                        |
| 4   | Combination filter meets the SLO                                                | `perf/product-filter.perf.ts`                                        | ◐ met at 25k; not met at the provisional 250k — see below |
| 5   | A product is filterable immediately after commit                                | `pim/catalog.test.ts`                                                | ✅                                                        |
| 6   | Enter bar, preserve it, return PSI, match a PSI range                           | `pim/units.test.ts`, `pim/catalog.test.ts`                           | ✅                                                        |
| 7   | Class 150 is not 150 PSI; NPS 1 is not 25.4 mm                                  | `pim/engineering-semantics.test.ts`, `pim/catalog.test.ts`           | ✅                                                        |
| 8   | Two sources, explainable match, approve, both records preserved                 | `party/entity-resolution.test.ts`                                    | ⬜                                                        |
| 9   | Undo the merge, restore relationships, lose nothing                             | `party/unmerge.test.ts`                                              | ⬜                                                        |
| 10  | Two sources disagree: both values, winner, reason, origin                       | `pim/catalog.test.ts` (PIM); `party/survivorship.test.ts` (accounts) | ◐                                                         |
| 11  | Interrupted Pipedrive backfill restarts without duplicates                      | `ingest/pipedrive-backfill.test.ts`                                  | ⬜                                                        |
| 12  | The same webhook twice is harmless                                              | `ingest/pipedrive-webhook.test.ts`                                   | ⬜                                                        |
| 13  | A missed webhook is found by reconciliation                                     | `ingest/pipedrive-reconcile.test.ts`                                 | ⬜                                                        |
| 14  | P21 import preserves lineage; re-import creates no duplicates                   | `ingest/p21-import.test.ts`                                          | ✅                                                        |
| 15  | P21 schema drift fails safely                                                   | `ingest/p21-drift.test.ts`                                           | ✅                                                        |
| 16  | A malformed record is quarantined with a useful reason                          | `ingest/quarantine.test.ts`                                          | ✅                                                        |
| 20  | A → B → C resolves to C; cycles rejected                                        | `pim/relationships.test.ts`                                          | ✅                                                        |
| 21  | Exact equivalent vs. functional alternate are distinguished                     | `pim/relationships.test.ts`                                          | ✅                                                        |
| 22  | Missing required Cv excludes a variant from the publishable view                | `pim/catalog.test.ts`                                                | ✅                                                        |
| 23  | Model-number parsing with version, confidence, warnings                         | deferred — assumption A-031                                          | ⬜                                                        |
| 25  | A stale write is rejected, not silently applied                                 | `pim/catalog.test.ts` (domain); `api/concurrency.test.ts` (HTTP)     | ◐                                                         |
| 26  | Canonical services depend on the abstract ingestion contract                    | `ingest/adapter-independence.test.ts`                                | ✅                                                        |
| 27  | Clean environment restored from backup and verified                             | `docs/runbooks/restore.md` drill                                     | ⬜                                                        |

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
- **Nominal size `1/2` normalized to the same lookup key as `12`**, because alias
  normalization stripped every non-alphanumeric character. A half-inch valve would have
  resolved to a twelve-inch designation. Caught by the metadata loader's own
  cross-validation before any data was loaded; fixed by migration `0008` and pinned by
  `pim/engineering-semantics.test.ts`.
- **A bare `PSI` alias made gauge and absolute pressure interchangeable**, and a
  case-insensitive `kv` alias made kilovolt and flow coefficient interchangeable. Both
  caught by the loader's ambiguity check. Neither is resolvable now; the connector
  mapping must declare which is meant.
- **A wrong digit in the inch-pound-force conversion factor** (`0.112984829027616706`
  instead of `0.1129848290276167`) made 1 ft·lbf convert to 11.999999999999999 in·lbf.
  Caught by the round-trip property test, not by any single conversion.
- **The metadata loader applied changed unit definitions silently**, reporting only
  inserts. An operator would not have seen a conversion factor change. Fixed by guarding
  the upsert so an unchanged row returns nothing and a changed one is reported.

- **The event registry reported every schema as modified on the second run**, because it
  compared `JSON.stringify` of a value round-tripped through `jsonb` — which does not
  preserve key order — against the original object. Left unfixed it would have blocked
  every deployment, or trained people to bypass the check. Fixed with a canonical
  key-sorted comparison.
- **`refreshVariantFacets` selected `av.*` alongside the target variant id**, and
  `pim.attribute_value` has its own `variant_id`, making every later reference ambiguous.
  Fixed by listing columns explicitly.
- **`setVariantLifecycle` wrote `NULL` into a `NOT NULL` column** when no effective date
  was supplied. Caught by the optimistic-concurrency test, which exercised a path the
  happy-path tests did not.
- **Re-presenting the same full extract marked every record deleted in source.** A file
  whose content was already held was skipped, so nothing in it was touched, and absence
  detection then found every record stale. Sending the same export twice — an ordinary
  operator mistake — would have flagged the entire customer base as gone. Caught by
  `ingest/p21-import.test.ts › creates no duplicate business facts`, which asserts the
  counters rather than only the row count. Fixed by touching the records a skipped file
  asserts, and by limiting absence detection to object types the run actually saw.
- **Only the second half of a duplicate key was quarantined.** The code carried a
  comment saying both rows were rejected rather than one silently overwriting the
  other; it processed rows in order and kept the first, which is the same silent choice
  with a different winner. Fixed by finding duplicated identifiers before staging
  anything, so every row sharing one is quarantined and no existing value moves.
- **Recording structural drift rolled back with the write it blocked.** The observed
  fingerprint was inserted in the same transaction that then threw, so the row a
  reviewer needs in order to approve the new structure never survived. The run halted
  correctly and left nothing to act on. Fixed by committing the observation in its own
  transaction before the halt; pinned by `ingest/p21-drift.test.ts › records the
observed structure so a reviewer has something to approve`.

## What the benchmark actually measures

An early benchmark run reported a **280 ms p95** for a filter whose `EXPLAIN ANALYZE`
execution time was **9 ms**. The gap was not the query. It was fifty concurrent
PostgreSQL backends on a four-core sandbox — twelve times oversubscribed — and, in the
first run, a five-connection client pool serving fifty concurrent callers.

Reporting that as an architecture failure would have been wrong. Quietly lowering the
target until it passed would have been worse. So `tests/perf/product-filter.perf.ts`
asserts two different things:

- **Server-side execution time** against the SLO, unconditionally. That is the number
  ADR-0014's design controls, and a larger instance preserves it.
- **End-to-end latency** at a concurrency the host can actually serve (two per core),
  with the oversubscribed figure reported but not asserted.

At **25,000 variants** on 4 vCPU, the five-criterion acceptance-criterion filter runs in
**5.9 ms server-side**, using bitmap index scans on `variant_facet_term_idx` exactly as
ADR-0014 intends, and **11.2 ms p95 end-to-end** at concurrency 8.

### What 250,000 variants changed

The benchmark was then re-run at **250,000 variants / 2.25 million facet rows**, on the
same host with PostgreSQL retuned (`shared_buffers` raised, `random_page_cost` lowered
to reflect SSD storage). Two things came out of it, and the second is uncomfortable.

**The best plan shape reverses with scale.** At 25,000 the join plan won. At 250,000 it
loses, and by enough to matter:

| Plan (three term criteria, 500 matches) | server-side | p95 end-to-end |
| --------------------------------------- | ----------- | -------------- |
| join                                    | 85.7 ms     | 118.8 ms       |
| **intersect**                           | **57.1 ms** | **114.0 ms**   |
| aggregate                               | 52.9 ms     | 144.5 ms       |

`DEFAULT_PLAN` is `'intersect'` on this evidence. Aggregate is marginally cheaper in the
server and consistently worse end to end, which is why both numbers are measured.

**The SLO is not met at this size, and that is a real result, not sandbox noise.** The
figures below are server-side execution — the number a bigger machine preserves — so
the gap is not concurrency or client overhead:

| Query                                  | server-side | p50      | p95      | SLO (p50 / p95) |
| -------------------------------------- | ----------- | -------- | -------- | --------------- |
| AC4 five-criterion filter              | 117.4 ms    | 119.2 ms | 139.9 ms | 25 / 100 ms     |
| Range in bar against PSI-stored values | 175.8 ms    | 199.2 ms | 224.3 ms | 25 / 100 ms     |
| Single common criterion (worst case)   | 0.18 ms     | 2.1 ms   | 3.4 ms   | 25 / 100 ms     |

The shape of the cost is understood: each individual criterion in the acceptance filter
matches tens of thousands of variants, so intersecting five of them reads on the order
of 150,000 index entries to return 500 rows. The design is doing what ADR-0014 says it
does; there is simply more of it at ten times the size.

What this does **not** justify is relaxing the SLO to match the measurement. Both the
250,000 figure and the 25 ms target are provisional stand-ins for discovery questions
**F1** (real catalogue size) and **F2** (real latency requirement), recorded as
assumption **A-014**. Either could move by an order of magnitude, in either direction.
The honest position is:

- **Acceptance criterion 4 is not met at the provisional numbers** and is recorded as ◐.
- The remedies are known and none of them changes the architecture: order the intersect
  by measured selectivity instead of by the order criteria arrive; add covering indexes
  for the criteria that are actually common; consider a partial index over the
  publishable subset. All are Phase 13 work, and all are cheap to reverse.
- Doing that work before F1 and F2 are answered would be tuning against a number nobody
  has confirmed.

**Acceptance criterion 4 is complete only when the end-to-end figure is measured at the
real target concurrency, on production-class hardware, against the real catalogue size.**

### A benchmark bug worth recording

Generating the catalogue originally used a `CROSS JOIN LATERAL ... ORDER BY md5(...)
LIMIT 1` to pick each variant's term — a correlated sort per row. Fine at 25,000
variants, past the statement timeout at 250,000. An earlier version was worse:
per-attribute strides over a single row number correlated every attribute with every
other, and the acceptance-criterion filter matched **zero rows** while the benchmark
reported healthy timings for it. The suite now asserts that every measured filter
matches more than zero variants, because a fast query over an empty result set is not
evidence of anything.
