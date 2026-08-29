# ADR-0005: SQL-first data access with Kysely; no ORM

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

The system's correctness lives in the database: constraints, temporal exclusions,
partial unique indexes, recursive hierarchy queries, set-based facet intersection. An
ORM's value is hiding SQL; here, hiding SQL is the failure mode.

## Decision

**Kysely** — a type-safe SQL query builder — over `pg`. No ORM, no lazy loading, no
identity map, no migration generation from model classes.

- The database schema is authored as SQL (ADR-0006). TypeScript types for tables are
  **generated from the live schema** by `kysely-codegen` into `src/platform/db/schema.d.ts`
  and committed, so schema drift between SQL and code fails the build.
- Complex analytical or recursive queries are written as raw SQL in `sql` template
  literals, reviewed as SQL, and tested against a real database.
- Repository objects are per-aggregate, hand-written, and small. They return domain
  types, not row types.

## Alternatives considered

- **Prisma** — schema-first in _its own_ DSL, which would make Prisma the owner of the
  schema. It cannot express exclusion constraints, partial unique indexes with
  expressions, or generated columns without escape hatches. Rejected.
- **TypeORM / MikroORM** — decorator-driven entity mapping; migration generation is
  unreliable for a schema this constraint-heavy. Rejected.
- **Raw `pg` only** — no type safety on column names or result shapes; every schema
  rename becomes a runtime error. Rejected.
- **Drizzle** — close second, and a reasonable substitute. Kysely chosen because it is
  a pure query builder that makes no attempt to own the schema, which suits a SQL-first
  design better.

## Why this wins

The SQL we write is the SQL that runs. Query plans are inspectable. The database keeps
the invariants. Types are derived from reality rather than asserted alongside it.

## Consequences

- More hand-written code than an ORM. Accepted deliberately.
- `npm run db:codegen` must be re-run after every migration; CI verifies the committed
  types match a freshly migrated database.

## Risks

Hand-written SQL invites injection if string concatenation creeps in. Mitigated by a
lint rule banning template concatenation into `sql.raw`, and by Kysely's parameter
binding everywhere else.

## Reversal cost

Moderate. Repositories are the only layer that touches Kysely; they are the seam.

## Revisit if

Hand-written repositories become a measured bottleneck on delivery speed rather than a
perceived one.
