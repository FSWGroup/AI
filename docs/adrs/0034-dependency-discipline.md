# ADR-0034: A small, justified dependency set with pinned versions

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§85 requires each dependency to justify itself on maintenance, adoption, licence, and
the consequences of abandonment. The Node ecosystem makes accumulating a dependency zoo
effortless, and a ten-year system pays for every one of them.

## Decision

### The approved v1 runtime dependency set

| Package                                                      | Purpose                               | Why it survives the test                                                     |
| ------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| `fastify` + `@fastify/*` (cors, helmet, rate-limit, swagger) | HTTP                                  | Mature, widely adopted, MIT, actively maintained                             |
| `@sinclair/typebox`                                          | Schemas → types, JSON Schema, OpenAPI | Removes four separate schema definitions; MIT                                |
| `ajv`                                                        | JSON Schema validation                | Fastify's validator; the de facto standard                                   |
| `kysely`                                                     | Type-safe SQL                         | ADR-0005; small surface, replaceable                                         |
| `pg`                                                         | PostgreSQL driver                     | The standard driver                                                          |
| `decimal.js`                                                 | Exact decimal arithmetic              | Non-negotiable for units and money                                           |
| `pino`                                                       | Structured logging                    | Fastify's default                                                            |
| `@opentelemetry/*`                                           | Telemetry                             | ADR-0032                                                                     |
| `yaml`                                                       | Metadata configuration                | ADR-0017                                                                     |
| `argon2`                                                     | Credential hashing                    | Current best practice for secret hashing                                     |
| `@aws-sdk/client-s3`                                         | Object storage                        | Only S3-compatible client with real longevity; isolated behind `ObjectStore` |
| `fast-check`                                                 | Property testing                      | ADR-0029                                                                     |
| `vitest`, `typescript`, `eslint`, `prettier`                 | Development                           | Standard                                                                     |

Nothing else without an entry in `docs/decisions/dependency-log.md` recording the
justification, licence, maintenance status, and what happens if it disappears.

### Rules

- **Exact version pinning** in `package.json` (no `^`, no `~`) with a committed lockfile.
  Upgrades are deliberate, reviewed changes.
- **Licence allow-list** — MIT, Apache-2.0, BSD, ISC. Anything copyleft or bespoke is
  reviewed before adoption. Enforced in CI.
- **Dependency and secret scanning** in CI (`npm audit`, plus a secret scanner on every
  commit).
- **Automated dependency updates** grouped weekly, with the full test suite as the gate.
- Prefer the Node standard library and the framework's own facilities. No utility
  grab-bags (`lodash`, `moment`); no framework-adjacent kitchen sinks.
- No dependency is added to save fewer than roughly fifty lines of code we understand.

## Alternatives considered

- **Range versions with lockfile.** Rejected: the lockfile drifts across environments and
  regeneration silently changes transitive versions.
- **Vendoring critical dependencies.** Rejected as premature; revisit only for a
  dependency that becomes unmaintained and load-bearing.

## Consequences

- More code written in-house (the migration runner, the rule evaluator, the unit
  conversion service). Each is small, understood, and tested — and each is a deliberate
  choice recorded in its own ADR.

## Reversal cost

Low.

## Revisit if

A dependency becomes unmaintained, or the audit surface grows beyond what weekly review
can absorb.
