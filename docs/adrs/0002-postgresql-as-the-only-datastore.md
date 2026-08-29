# ADR-0002: PostgreSQL 16 baseline, and PostgreSQL is the only datastore

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

The specification prohibits Kafka, Redis, Elasticsearch, and a separate policy engine
"unless there is demonstrated need". Every one of those needs would be satisfied
initially by PostgreSQL. The question is which PostgreSQL version to target and whether
any second datastore is justified in v1.

## Decision

**PostgreSQL 16 is the compatibility baseline.** Production may run 16, 17, or later;
the schema and code must not use features unavailable in 16. Required extensions:
`pgcrypto`, `pg_trgm`, `btree_gist`, `btree_gin`, `citext`, `unaccent`, `fuzzystrmatch`.

**PostgreSQL is the only datastore in Layer 0 v1.** No Redis, no message broker, no
search engine, no document store. Object storage (ADR-0026) holds binaries only and is
not a datastore for structured data.

Specifically, PostgreSQL provides:

- canonical master data (relational, constrained)
- the domain event ledger and delivery outbox (ADR-0008)
- full-text and trigram search, and faceted filtering (ADR-0014)
- fuzzy entity-resolution scoring (ADR-0025)
- background job/queue state for ingestion runs
- the audit log

## Alternatives considered

- **Target PostgreSQL 17/18 to get built-in `uuidv7()`.** Rejected: the function is
  ten lines of PL/pgSQL on 16 (see migration `0002`), and pinning to a very recent major
  narrows managed-hosting options for no material gain.
- **Add Redis for caching and job queues.** Rejected: no measured need, and it adds a
  second durability model, a second failure mode, and a second thing to back up.
- **Add Elasticsearch for product search.** Rejected until PostgreSQL demonstrably
  fails the agreed SLO on the agreed dataset (§35, ADR-0014).

## Why this wins

One datastore means one backup story, one restore runbook, one consistency model, one
set of credentials, one thing to monitor. For a small team this is worth more than any
individual performance win a specialised store would deliver.

## Consequences

- Anything that would be "obvious" in Redis (rate limiting, ephemeral locks) uses
  PostgreSQL advisory locks or tables. This is acceptable at our scale and must be
  re-measured before it is assumed acceptable at ten times our scale.
- Cross-module transactions are ordinary database transactions. This is a deliberate
  advantage of the monolith and is why the outbox pattern works without distributed
  transactions.

## Risks

Single point of failure. Mitigated by managed hosting with automated failover, PITR,
and a tested restore runbook (ADR-0029, `docs/runbooks/restore.md`).

## Reversal cost

Adding a datastore later is a normal, moderate change. Removing one is not. Starting
with one is the reversible direction.

## Revisit if

A benchmark (not an anecdote) shows PostgreSQL missing the agreed product-search SLO,
or event-feed consumers exceed what polling can serve.
