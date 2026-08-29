# ADR-0001: Backend language and framework — TypeScript on Node 22, Fastify, TypeBox

- Status: Accepted (provisional — decided under delegated authority 2026-08-29; awaiting owner confirmation)
- Date: 2026-08-29
- Supersedes: none

## Context

Layer 0 must survive a decade and be maintainable by a small internal team, a single
hire, or a contractor. The choice of language is the least reversible decision in the
project: everything else in this repository can be replaced incrementally, but a
language change is a rewrite.

Evidence available at decision time:

- The owner's other active repository (`FSWGroup/foundersgames`) is TypeScript/Next.js,
  which is the only observed signal about the house language.
- No engineering team exists yet; the hiring pool matters more than any current skillset.
- The workload is IO-bound (database, HTTP to Pipedrive, file parsing), not CPU-bound.
- The domain demands strong typing at compile time and precise numeric handling at
  runtime.

## Decision

TypeScript in `strict` mode on Node.js 22 LTS, with:

- **Fastify 5** as the HTTP framework
- **TypeBox** for schema definition — one artifact serves runtime validation (Ajv),
  static TypeScript types, OpenAPI generation, and JSON Schema for the event catalogue
- **Kysely** for type-safe SQL (see ADR-0005)
- **Vitest** for tests
- **Pino** for structured logging (Fastify's default)
- **decimal.js** for exact decimal arithmetic where floating point is unacceptable

Numeric discipline: all money, all quantity values, and all conversion factors are
`NUMERIC` in PostgreSQL and are never round-tripped through JavaScript `number` in a
path that persists a value. They travel as strings and are computed with `decimal.js`.

## Alternatives considered

| Option                            | Why not                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Python + FastAPI + SQLAlchemy** | Strong contender: excellent for data work, mature migrations (Alembic), first-class decimal handling. Rejected because typing is opt-in and erodes under maintenance pressure, and because it would be a second language in an otherwise TypeScript house. |
| **C# / .NET 8**                   | Arguably the best pure fit: real static typing, `decimal` primitive, superb PostgreSQL driver, strong tooling. Rejected on hiring reality for a small Pennsylvania distributor and on the absence of any existing .NET footprint at FSW.                   |
| **Go**                            | Excellent operational profile. Rejected: weak generics ergonomics for a metadata-driven domain, verbose data mapping, and a smaller hiring pool for line-of-business work.                                                                                 |
| **Java / Spring**                 | Rejected as disproportionate operational and cognitive weight for a small team.                                                                                                                                                                            |
| **Ruby on Rails**                 | Rejected: dynamic typing is the wrong default for a system whose entire value is data correctness.                                                                                                                                                         |

## Why this wins

One language across backend, tooling, future admin UI, and future consuming
applications. TypeBox gives a single source of truth for the four schema surfaces we
need anyway, which removes an entire class of drift between the OpenAPI contract, the
runtime validator, and the event catalogue. Fastify is boring, fast, well-maintained,
and schema-first by design rather than by convention.

## Consequences

- `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`
  are non-negotiable; disabling them is a breaking change to this ADR.
- JavaScript's `number` is a hazard. Lint rules and code review must catch numeric
  values crossing the persistence boundary as `number`.
- Node's ecosystem churn is a real long-term risk, mitigated by ADR-0033 (dependency
  discipline) and a deliberately small dependency set.

## Risks

- **Numeric precision.** Mitigated by NUMERIC columns, string transport, and property
  tests over conversion (see ADR-0015).
- **Ecosystem churn.** Mitigated by preferring the standard library and pinning.

## Reversal cost

Very high — a rewrite. Treat as effectively permanent.

## Revisit if

FSW hires an engineering lead with a strong, well-argued preference before Phase 3
completes, or the numeric-precision mitigations prove insufficient in practice.
