# ADR-0006: Hand-written SQL migrations applied by a checksum-enforcing runner

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

The specification requires versioned, automated, tested, forward-safe migrations, and
forbids modifying an already-applied migration. Most migration tools enforce ordering
but not immutability, and most encourage authoring schema in a host-language DSL, which
conflicts with ADR-0005.

## Decision

Plain, numbered `.sql` files in `db/migrations/`, applied by a small in-repository
runner (`tools/migrate.ts`, roughly 150 lines) with these properties:

1. Files are named `NNNN_snake_case_description.sql` and applied in lexical order.
2. Each file is applied **inside a single transaction**, with the whole run wrapped so a
   failure leaves the database at the last good migration.
3. The runner records `version`, `name`, `sha256`, `applied_at`, `applied_by`,
   `execution_ms` in `kernel.schema_migration`.
4. **Checksum enforcement:** if a file's SHA-256 differs from what was recorded when it
   was applied, the runner refuses to start. This makes "never modify an applied
   migration" a mechanical guarantee rather than a convention.
5. A migration may opt out of the transaction wrapper with a leading
   `-- fsw:no-transaction` pragma, required for `CREATE INDEX CONCURRENTLY`.
6. There are no `down` scripts. Reversal is a new forward migration. High-risk changes
   use expand → backfill → validate → contract, with each stage as its own migration.

## Alternatives considered

- **node-pg-migrate / Umzug / Flyway.** All workable; Flyway is the closest in spirit
  and enforces checksums. Rejected: node-pg-migrate and Umzug do not enforce
  immutability by default, and Flyway adds a JVM to the toolchain.
- **Generated migrations from a schema DSL.** Rejected with ADR-0005; the constraints
  this schema depends on are not expressible in any mainstream DSL.

## Why this wins

A migration runner is genuinely ~150 lines. Writing it buys checksum immutability, a
transparent failure mode, no JVM, and no dependency that can be abandoned. This is one
of the few places where "build it" beats "adopt it" on dependency-discipline grounds
(ADR-0033), and it is justified only because the surface is this small.

## Consequences

- Every schema change is reviewed as SQL, which is the point.
- A developer who edits an applied migration gets a hard failure, not a silent
  divergence.
- Rollback is procedural, not magical, and is documented per high-risk migration in
  `docs/runbooks/migrations.md`.

## Risks

Home-grown tooling rots. Mitigated by keeping the runner minimal, testing it directly
(`tests/tools/migrate.test.ts`), and by the fact that its state table is trivial to
hand-repair.

## Reversal cost

Low. The `.sql` files are portable to Flyway or any other runner; only the state table
name would change.

## Revisit if

The runner grows past ~300 lines or needs features (repeatable migrations, baselines,
multi-tenant fan-out) that a mature tool already provides.
