# FSW Layer 0 — Architecture

Layer 0 is the shared data spine underneath FSW Group's operating businesses. It is
infrastructure, not an application. Its job is to hold the canonical truth about
**people, organizations, sites, products and their technical properties**, to know where
every fact came from, and to make all of it available to future applications through
stable contracts.

If Layer 0 succeeds, a developer in 2031 builds a new internal application and already
has trusted APIs for identity, permissions, organizations, plants, contacts, products,
attributes, certifications, equivalents, supersessions, lineage and audit. If it fails,
it is one more system containing another copy of bad data.

## Shape

One deployable. One database. Two process types.

```
                    ┌──────────────────────────────────────┐
   OIDC (Entra /    │            FSW Layer 0               │
   Google) ────────▶│                                      │
                    │  API process        Worker process   │
   Consuming apps   │  ┌───────────┐      ┌─────────────┐  │
   ───────────────▶ │  │  Fastify  │      │ dispatcher  │  │
   REST + event feed│  │  routes   │      │ ingestion   │  │
                    │  └─────┬─────┘      │ scheduled   │  │
                    │        │            └──────┬──────┘  │
                    │  ┌─────▼───────────────────▼──────┐  │
                    │  │   modules (see boundaries)     │  │
                    │  │  iam · party · pim · ingest    │  │
                    │  │  events · audit · kernel       │  │
                    │  └─────────────┬──────────────────┘  │
                    └────────────────┼─────────────────────┘
                                     │
                         ┌───────────▼───────────┐   ┌──────────────┐
                         │   PostgreSQL 16       │   │  S3-compatible│
                         │   (system of record)  │   │  object store │
                         └───────────┬───────────┘   └──────────────┘
                                     │ streaming replica
                         ┌───────────▼───────────┐
                         │  read replica         │
                         │  reporting schema     │
                         └───────────────────────┘
```

What is deliberately absent: Kubernetes, a service mesh, microservices, Kafka, Redis,
Elasticsearch, a policy engine, a schema registry, a workflow platform, and a warehouse.
Each has an ADR explaining the conditions under which it would become correct.

## Modules

Each module owns a PostgreSQL schema and exposes exactly one TypeScript entry point.
Nothing imports past another module's `index.ts` (ADR-0003).

| Module   | Owns                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `kernel` | Identifiers, clock, source-system registry, operating companies, unit of work, idempotency keys                                           |
| `audit`  | The change log — who changed what, when, through which interface                                                                          |
| `events` | Domain event ledger, delivery outbox, subscriptions, consumer inbox, the feed                                                             |
| `iam`    | Principals, IdP identity mapping, service accounts, credentials, roles, permissions, scopes                                               |
| `party`  | Organizations, persons, sites, locations, commercial accounts, ship-tos, roles, affiliations, candidates, survivorship, matching, merges  |
| `pim`    | Units, vocabularies, attributes, product types, hierarchy, variants, typed values, facets, relationships, certifications, assets, quality |
| `ingest` | Connectors, runs, landed files, source records, quarantine, schema fingerprints, reconciliation                                           |

## The five decisions that shape everything else

### 1. Canonical values are derived, not authored

A mastered field's value on `party.organization` is a **materialized output** of a
survivorship function over candidate values, each attributed to a source (ADR-0011).
Editing a value in the admin UI writes a candidate attributed to the `MANUAL` source; it
does not update the row directly.

This is what makes merge reversible (ADR-0012), provenance complete, and field ownership
configurable rather than hard-coded. It is the least obvious decision in the system and
the most load-bearing.

### 2. Attribute flexibility without runtime DDL

New product types and attributes are configuration, never code and never a migration
(ADR-0017). Canonical values live in one typed table whose columns are selected by the
attribute's declared value type, with database `CHECK` constraints enforcing that a
`QUANTITY` cannot hold a term and a `PRESSURE_CLASS` cannot hold a number (ADR-0013).

Fast filtering comes from `pim.variant_facet` — a fixed-schema, indexed projection that
stores the _resolved effective_ value after inheritance and is written **in the same
transaction** as the canonical change, so a product is filterable the instant it is
committed (ADR-0014).

No DDL is ever generated at runtime. The schema is exactly what the reviewed migrations
say it is.

### 3. Engineering semantics are enforced by the database, not by convention

**ASME Class 150 is not 150 PSI. NPS 1" is not 25.4 mm.** These are controlled
designations backed by vocabulary terms, structurally incapable of holding a numeric
value, with no code path to a quantity (ADR-0016). Real measured pressures are
`QUANTITY` attributes with a dimension, an original value, an original unit, and a
normalized base value, so a PSI range query matches a value entered in bar (ADR-0015).

This is the requirement in the specification with physical consequences, and it is
enforced three ways: by constraint, by a throwing conversion service, and by a named test.

### 4. The event ledger is immutable and commit-ordered; the outbox is not the ledger

`events.domain_event` is append-only with `UPDATE`/`DELETE` revoked. `events.event_delivery`
holds mutable dispatch state and is prunable. Sequence numbers are drawn under an advisory
lock held to commit, so **sequence order equals commit order** and a reader tailing the
feed provably cannot skip a committed event (ADR-0008).

Event payloads carry **identifiers, never PII** (ADR-0009). That single constraint is what
lets an immutable ledger and a lawful erasure obligation coexist (ADR-0027).

### 5. External systems never define the domain

A P21 customer is not an FSW organization. A P21 ship-to is not a plant. A Pipedrive
organization is not an FSW organization. Each is a _source record_ that **proposes**
canonical facts through a versioned mapping (ADR-0022). No source-system identifier
appears as a column on a canonical table; crosswalks live in `ingest`.

When P21 API access arrives, we replace the adapter's fetch and parse. The canonical
model does not move.

## Data flow

**Inbound** — a source file or API payload is landed (checksummed, preserved), parsed
against an approved structural fingerprint, validated, staged as a `source_record`,
normalized, matched to a canonical entity, contributed as candidate values, and survived
into canonical state. Anything that fails lands in a visible quarantine with a reason.
Nothing is silently discarded and nothing is silently overwritten.

**Outbound** — every successful canonical mutation writes an audit entry and emits one or
more domain events in the same transaction. Consumers pull from `GET /v1/events` or
receive signed webhooks. Read models rebuild by replaying from sequence zero.

## Where to look next

- Decisions and their alternatives: [`adrs/`](adrs/README.md)
- What every table and column means: [`data-dictionary.md`](data-dictionary.md)
- Event contracts: [`events/`](events/)
- How P21 and Pipedrive data enters: [`integrations/`](integrations/)
- What we assumed and why: [`assumptions.md`](assumptions.md)
- What we still need to know: [`open-questions.md`](open-questions.md)
- Phases and exit criteria: [`implementation-plan.md`](implementation-plan.md)
