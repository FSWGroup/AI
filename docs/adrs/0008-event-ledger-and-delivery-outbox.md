# ADR-0008: Immutable event ledger and mutable delivery outbox are two tables

- Status: Accepted (provisional)
- Date: 2026-08-29
- Resolves: specification §17, §81 conflict item 3

## Context

The specification requires both a permanently replayable domain-event history and a
transactional outbox with mutable delivery state, and explicitly warns against
conflating them. It also requires that a downstream read model be rebuildable from
event zero, which is impossible if delivered outbox rows are pruned.

Separately, replay correctness requires a **total order that matches commit order**. A
plain `BIGSERIAL` does not provide this: sequence values are handed out at insert time,
so a transaction that takes sequence 100 may commit after one that took 101, and a
reader tailing by sequence will skip the gap and never come back for it.

## Decision

Three tables with sharply different mutability:

1. **`events.domain_event`** — append-only, immutable. `INSERT` only; `UPDATE` and
   `DELETE` are revoked from the application role. Holds the full envelope (ADR-0009)
   and a `sequence bigint` used for replay ordering.
2. **`events.event_delivery`** — one row per (event, subscription). Fully mutable:
   `status`, `attempts`, `claimed_at`, `claimed_by`, `delivered_at`, `next_attempt_at`,
   `last_error`. Prunable after successful delivery without affecting replay.
3. **`events.consumer_inbox`** — `(consumer_key, event_id)` primary key, recording
   events a consumer has already applied. This is what makes at-least-once delivery
   safe (§17) and makes duplicate delivery a no-op.

**Commit-ordered sequence.** Domain events are buffered in the UnitOfWork during the
transaction and flushed as the last statement before commit. The flush takes
`pg_advisory_xact_lock(kernel.EVENT_SEQUENCE_LOCK)` and then draws sequence values. The
lock is held until commit, so no later transaction can obtain a sequence number until
the earlier one has committed. Sequence order therefore equals commit order, and a
reader tailing `sequence > cursor` provably cannot skip a committed event.

**The ledger is not the persistence model.** Canonical tables remain current-state
source of truth. This is not event sourcing (§17).

## Alternatives considered

- **One table with a `delivered_at` column.** The specification's named anti-pattern.
  Rejected: pruning delivered rows destroys replayability; not pruning them makes the
  dispatcher's hot path scan a table that grows forever.
- **Logical replication / `pg_logical_slot` change data capture.** Produces row-change
  events, not domain events, which §16 explicitly rejects.
- **`BIGSERIAL` plus a "safe horizon" reader** that only reads up to the oldest
  in-flight transaction. Correct, but pushes subtle visibility reasoning into every
  consumer. Rejected in favour of making the order correct at write time.
- **Timestamp ordering.** Rejected: clock skew and identical timestamps.

## Why this wins

Two tables, each with one job. Replay is `SELECT ... WHERE sequence > $1 ORDER BY
sequence LIMIT $2` with no caveats, which is exactly what acceptance criterion 18
demands.

## Consequences

- **Event-emitting transactions serialise on one advisory lock at flush time.** The lock
  is taken as late as possible, so the contended window is one batched `INSERT`. This is
  the cost of correct ordering and it is measured, not assumed:
  `tests/perf/event-throughput.perf.ts` records achievable events/second and fails if it
  regresses below the documented floor.
- Bulk ingestion must not emit one event per row inside one long transaction. Bulk paths
  emit batch-level events and chunk their transactions (ADR-0022).
- `events.domain_event` grows forever. Retention is an archive-to-cold-storage decision,
  not a delete decision (open question K2).

## Risks

Long-running transactions that emit events would block all other event emission.
Mitigated by a statement timeout, by the late-flush design, and by an alert on advisory
lock wait time.

## Reversal cost

Moderate before consumers exist; high afterwards, because the sequence contract is part
of the public feed API.

## Revisit if

Measured event throughput approaches the documented floor, at which point per-partition
sequences (one lock per aggregate type) are the next step, before any broker.
