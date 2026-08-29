# ADR-0032: OpenTelemetry for traces, metrics and logs; no vendor coupling

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§63 requires structured logs, correlation, OpenTelemetry or a comparable abstraction, and
metrics that help operate the system rather than decorate a dashboard. §64 requires
explicit data-quality metrics.

## Decision

- **Structured JSON logs** via Pino, with a mandatory correlation ID on every log line,
  automatic redaction of a configured secret/PII field list, and no free-text logging of
  request bodies.
- **OpenTelemetry SDK** for traces and metrics, exporting OTLP. The collector endpoint is
  configuration; no vendor SDK is imported into application code, so switching backends is
  an environment variable.
- One **correlation ID** flows request → transaction → domain event (`correlation_id`) →
  audit entry → outbound webhook header, so a single identifier links an API call to the
  events it produced and the downstream deliveries they caused.

### Metrics that earn their place

**API** — request latency by route, error rate by class, authorization denials by
permission and scope.
**Database** — pool utilisation and saturation, slow-query count, advisory-lock wait time
(the ADR-0008 serialisation point).
**Events** — publication lag (`recorded_at` → delivered), pending delivery depth, failed
delivery count by subscription, replay progress.
**Integrations** — time since last successful run per connector, source lag, records
processed/rejected/quarantined, reconciliation discrepancy count, rate-limit encounters.
**Account master** — unresolved match-queue depth and age, auto-links, merges, unmerges.
**PIM** — incomplete products by product type, publishability failures by channel and
rule, parser failures, conflicting attribute values, facet-projection drift.
**Data quality** (§64) — completeness percentages, mapping coverage, orphaned source
records, invalid units, stale sources.

Alerts are defined for a deliberately short list where a human must act: connector not
succeeded within its expected window, delivery failures above threshold, quarantine depth
growing, replica lag, credential expiring, restore drill overdue, facet drift detected.

## Alternatives considered

- **A vendor SDK directly (Datadog, New Relic).** Faster to start, and it couples the
  code to a contract. Rejected.
- **Logs only.** Insufficient for delivery lag and queue depth.
- **Prometheus scrape without OTel.** Workable for metrics; loses unified tracing and a
  common correlation model.

## Consequences

- A collector must be deployed or a managed OTLP endpoint used.
- Instrumentation is written once at the platform layer (HTTP, database, UnitOfWork,
  connector runner), not scattered through domain code.

## Reversal cost

Low.

## Revisit if

Telemetry volume or cost requires sampling strategy changes.
