# ADR-0022: One reusable ingestion pipeline with explicit stages and raw preservation

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§8 requires a reusable pipeline — LAND → PARSE → VALIDATE → STAGE → NORMALIZE → MATCH →
SURVIVE → CANONICALIZE → RECONCILE — with raw preservation, run records, quarantine, and
reconciliation, and forbids bespoke ingestion infrastructure per source. Much of the
initial canonical dataset arrives this way, so this is first-class, not a script.

## Decision

### Stages as explicit, separately testable steps

Each connector implements a narrow interface and the shared pipeline runs the stages.
A connector supplies: discovery (what is available since the watermark), fetch, parse,
and a **mapping** from source shape to a canonical _command_. A connector never writes to
a canonical table. That is the anti-corruption boundary (§77) and it is enforced by
module boundaries: connectors live in `ingest` and may call only the published interfaces
of `party` and `pim`.

### Tables

- `ingest.connector` — registry: key, source system, kind, mapping version, enabled.
- `ingest.run` — id, connector, mode (`FULL`/`INCREMENTAL`/`RECONCILE`), started/ended,
  status, `watermark_before`/`watermark_after`, counters (discovered, downloaded, added,
  changed, unchanged, rejected, matched, needs_review), error count, manifest, actor.
- `ingest.landed_file` — id, run, filename, bytes, `sha256`, object-storage reference,
  received_at, parser version, `schema_fingerprint`.
- `ingest.source_record` — the durable identity of a record in a source system:
  `(source_system_id, object_type, source_id)` unique; `first_seen_at`, `last_seen_at`,
  `source_updated_at`, `payload_hash`, `payload` (jsonb), `deleted_in_source_at`,
  `mapping_status`, `sync_status`, `validation_status`.
- `ingest.source_record_version` — immutable history: every distinct `payload_hash` ever
  seen, with the run that saw it. **Never mutated to make canonical data look clean.**
- `ingest.quarantine` — failure category, validation messages, the raw record, the
  attempted mapping, retry state, status, resolver, resolution.
- `ingest.schema_fingerprint` — per (connector, object type): the hash of the observed
  structure, the column list, first-seen run, and approval state.

### Guarantees

- **Idempotent and restartable.** Records are keyed by `(source_system, object_type,
source_id)`; content changes are detected by `payload_hash`. Re-ingesting an identical
  file or payload changes nothing and is recorded as `unchanged`. A run interrupted
  mid-way resumes from its watermark; a re-run of a completed run is a no-op.
- **Nothing is silently discarded.** Every rejected record lands in quarantine with a
  category, the original payload, and the attempted mapping.
- **Schema drift is detected, not absorbed.** A structural fingerprint that does not match
  an approved one halts the run before any canonical write. A newly added column can
  never shift column interpretation, because parsing is by header name against an
  approved fingerprint, never by position.
- **Reconciliation is a first-class mode**, not an afterthought: counts by object type,
  source-ID set difference, and payload-hash comparison over a window, producing a
  discrepancy report and, where safe, corrective work.
- **Bulk paths do not emit per-row events.** A run emits run-level events plus
  aggregate change events; per-row canonical events are emitted for genuinely new or
  changed business facts only, in chunked transactions (ADR-0008).

## Alternatives considered

- **An ETL platform (Airbyte, Meltano, dbt).** Genuinely good tools for warehouse
  loading. Rejected here because the hard part is not moving bytes — it is mapping,
  matching, survivorship, quarantine, and lineage, none of which those tools own. They
  remain candidates for the analytics path (ADR-0031).
- **A connector per source with its own tables.** The specification's named anti-pattern.
- **Landing straight into canonical tables with a `source` column.** Rejected: destroys
  the ability to answer what the source actually said, and makes re-mapping impossible.

## Consequences

- Writing a new connector means implementing discovery/fetch/parse/map plus fixtures. The
  pipeline, run bookkeeping, quarantine, and reconciliation come for free.
- Storage grows with raw retention. Retention is configurable per connector (K2).

## Risks

Mapping bugs are the highest-consequence defect class here. Mitigated by mapping versions
recorded per source record, by golden-file mapping tests, and by the ability to re-run
mapping from preserved raw payloads without re-extracting from the source.

## Reversal cost

Moderate.

## Revisit if

A source's volume exceeds what single-node batch processing handles comfortably.
