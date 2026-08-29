# ADR-0003: Modular monolith, with PostgreSQL schemas as module boundaries

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

The specification requires a modular monolith whose internal boundaries are strong
enough that a module could later become a service without redesigning its domain. In
practice, monoliths decay because module boundaries exist only in folder names, and
because any module can query any other module's tables.

## Decision

Modules are enforced at three levels:

1. **Source layout.** `src/modules/<module>/` with a mandatory `index.ts` that is the
   module's only public surface. Nothing outside a module may import a path deeper than
   `src/modules/<module>/index.ts`. Enforced by an ESLint `no-restricted-imports` rule
   and a test that walks the import graph.
2. **Database schemas.** Each module owns a PostgreSQL schema and owns every table in
   it. `kernel`, `iam`, `party`, `pim`, `ingest`, `events`, `audit`.
3. **Cross-module access.** A module may read another module's tables **only** through
   that module's published TypeScript interface, never by writing SQL against another
   schema. Foreign keys across schemas are permitted and encouraged — referential
   integrity is a database concern and must not be sacrificed for boundary purity.

Modules for v1:

| Schema | Owns |
|---|---|
| `kernel` | shared primitives: id generation, source systems, operating companies, correlation |
| `audit` | the change log |
| `events` | domain event ledger, delivery, subscriptions, consumer inbox |
| `iam` | principals, identities, service accounts, roles, permissions, assignments |
| `party` | organizations, persons, sites, locations, roles, affiliations, matching, merges |
| `pim` | units, vocabularies, attributes, product types, products, variants, facets, relationships, quality |
| `ingest` | connectors, runs, landed files, source records, quarantine, schema fingerprints |

## Alternatives considered

- **Microservices now.** Rejected per specification and per team size.
- **One schema (`public`) with table prefixes.** Rejected: no enforcement, and it
  forfeits per-module database roles later.
- **Separate databases per module.** Rejected: forfeits foreign keys, transactions, and
  the outbox pattern — i.e. everything that makes the monolith worth having.

## Why this wins

Cross-schema foreign keys plus a single transaction give correctness for free. The
import rule plus schema ownership give the extraction path. If `pim` ever becomes a
service, the work is replacing its published interface with an HTTP client and severing
a small, already-enumerated set of foreign keys.

## Consequences

- Extracting a module later requires severing its cross-schema FKs. The FK inventory
  is therefore the honest measure of coupling and is reported by a test.
- Per-module database roles become possible later without schema changes.

## Risks

Discipline erosion. Mitigated by the automated import-graph test, which fails CI.

## Reversal cost

Low in the direction of extraction. Effectively infinite in the direction of
re-merging distributed services, which is why we start merged.

## Revisit if

A module develops materially different scaling, availability, or deployment-cadence
requirements from the rest of the system.
