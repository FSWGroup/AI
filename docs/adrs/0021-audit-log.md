# ADR-0021: The audit log is written by the application, not by triggers

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§13 requires audit to answer who changed a record, when, through what interface, from
where, and exactly what changed — and warns against using one table as a lazy substitute
for both audit and domain events. §14 warns against hiding business workflows in
triggers.

Database triggers can capture *what* changed but cannot know the actor, the interface,
the correlation ID, the reason, or the originating source record, because those live in
the request context.

## Decision

`audit.change_log` is written by the **UnitOfWork** in the same transaction as the change:

`id`, `occurred_at`, `actor_principal_id`, `actor_type`, `actor_label`, `interface`
(`HTTP`, `CONNECTOR`, `JOB`, `CLI`, `MIGRATION`), `client_ip`, `user_agent`,
`correlation_id`, `causation_id`, `operating_company`, `entity_schema`, `entity_table`,
`entity_id`, `operation` (`INSERT`/`UPDATE`/`DELETE`/`MERGE`/`UNMERGE`/`ERASE`),
`before` (jsonb), `after` (jsonb), `changed_fields` (text[]), `reason`,
`source_record_id`.

- **Immutability is enforced by grants**, not by convention: the application role has
  `INSERT` only. `UPDATE` and `DELETE` on `audit.*` are revoked and belong to a separate
  maintenance role used only by documented retention jobs.
- **Redaction is mandatory.** A field-classification registry marks columns as
  `SECRET` (never recorded), `PII` (recorded, subject to erasure), or `PUBLIC`. Secrets
  — credential hashes, API tokens, webhook signing keys — are replaced with `"[redacted]"`
  in `before`/`after` by a serializer that operates from the registry, so a new secret
  column is redacted by classifying it rather than by remembering to.
- **Audit and events are different things and both are written.** Audit answers
  "who did this to this row"; events answer "what did the business assert". A row-level
  audit entry is not a domain event, and `DatabaseRowUpdated` is not an event we emit.
- Connector writes record the service principal *and* the originating
  `ingest.source_record_id`, so any imported value traces back to the file or API payload
  that carried it.
- Authorization **denials** are audited too (AC2), with the permission, scope, and
  resource requested.

## Alternatives considered

- **Trigger-based audit (`pgaudit`, hand-written triggers).** Rejected as the primary
  mechanism: no actor, no reason, no interface. `pgaudit` may still be enabled at the
  infrastructure level for DBA-level statement auditing, which is a different and
  complementary concern.
- **Reconstructing audit from the event ledger.** Rejected: events are domain-level and
  deliberately omit PII (ADR-0009); they cannot answer "which column changed".
- **Temporal tables / `system_versioning`.** Not available natively in PostgreSQL, and
  ADR-0018 already declines general system-time modelling.

## Consequences

- Every write path must go through the UnitOfWork. A direct repository write that
  bypasses it is a defect; a test asserts that every mutating repository method records
  an audit entry.
- Audit volume will exceed canonical row volume. Retention is a policy decision (K2);
  the provisional default is seven years, with partitioning by month once volume warrants.

## Risks

A developer writes SQL outside the UnitOfWork. Mitigated by the repository seam, code
review, and the coverage test.

## Reversal cost

Low.

## Revisit if

Audit write cost becomes material on bulk paths, where batch-level audit entries
referencing an ingestion run replace per-row entries.
