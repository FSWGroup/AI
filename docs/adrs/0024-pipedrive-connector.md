# ADR-0024: Pipedrive — the API is authoritative, webhooks are only hints

- Status: Accepted (provisional) — depends on unanswered questions D1–D6
- Date: 2026-08-29

## Context

§10 requires current Pipedrive APIs, v2 endpoints where available, Webhooks v2 where
useful, and explicitly forbids relying on webhooks as the sole consistency mechanism. A
lost webhook must not create permanent silent divergence.

**Documentation caveat, stated as §86 requires:** this ADR is written from the
specification's own description of Pipedrive's current API generation. The exact v2
endpoint coverage, pagination style, rate-limit budget, and webhook payload shape **have
not been verified against Pipedrive's live documentation or a live account in this
session**, because no credentials or network access to Pipedrive were available. Every
endpoint-specific detail below is provisional and must be confirmed against official
documentation before Phase 5 implementation. What is *not* provisional is the shape of
the connector, which is deliberately insensitive to those details.

## Decision

### Three mechanisms, one truth

1. **Backfill** — full enumeration via cursor pagination, checkpointed per object type so
   an interrupted import resumes without duplicating (AC11).
2. **Incremental sync** — driven by source updated timestamps and a watermark, with a
   deliberate overlap window to tolerate clock skew and late writes.
3. **Webhooks** — treated strictly as *"something changed, go look"*. The webhook payload
   is recorded for lineage but **the API is then called to fetch authoritative state**.
   This makes duplicate webhooks (AC12), out-of-order webhooks, and replayed webhooks
   harmless by construction rather than by careful handling.

**Reconciliation** (AC13) runs on a schedule regardless of webhook health: it compares
source-ID sets and updated-timestamp windows, finds records the incremental path missed,
and processes them. A simulated missed webhook is a test case, not a hope.

### Idempotency and safety

- Webhook receipt is authenticated (signature or HTTP basic per Pipedrive's supported
  mechanism), timestamp-checked against a replay window, and recorded by delivery ID for
  duplicate suppression.
- Every webhook is enqueued and processed asynchronously; the endpoint returns quickly
  and never does canonical work inline.
- Retries use exponential backoff with jitter and respect rate-limit headers; a 429 is a
  scheduling input, not an error.
- Token storage supports rotation and refresh; credentials live in the secret store, never
  in the database or the repository.

### Custom fields are data, not constants

Pipedrive custom-field definitions are **ingested into `ingest.source_field_definition`**
and referenced by their stable key through a versioned mapping. No custom-field hash ID
appears in application code (§10). A custom field that disappears or changes type is a
schema-drift event handled exactly like a P21 column change (ADR-0022).

### Anti-corruption

A Pipedrive **organization** is not an FSW organization. It is a source record that
*proposes* one. In practice Pipedrive organizations at FSW are expected to be an
inconsistent mix of legal entities and plants (question D5), so the mapping produces a
candidate organization **and** a candidate site, with the site link left for entity
resolution rather than asserted.

Deals are **not** ingested in v1 (§80 places pipelines out of scope), with one exception
under consideration: deal-to-person-to-organization links are sometimes the only evidence
connecting a contact to a plant, and may be ingested as *evidence for matching* without
creating canonical deal entities. Pending question D7.

### Direction

Read-only from Pipedrive in v1 (question B4). Two-way sync doubles complexity and
introduces echo loops; it is a separate, later decision.

## Alternatives considered

- **Webhook-driven only.** Rejected by §10 and by operational reality.
- **Polling only.** Correct but needlessly stale; webhooks reduce latency at no
  correctness cost given the fetch-on-hint design.
- **A third-party iPaaS (Zapier, Workato).** Rejected: no lineage, no quarantine, no
  reconciliation, and it would own the mapping.

## Consequences

- Every change costs an API call even when the webhook carried the data. Accepted: it
  buys immunity to an entire class of ordering and duplication bugs.
- Rate-limit budget becomes a real design constraint at backfill scale, mitigated by
  checkpointing and adaptive concurrency.

## Risks

The unverified API details above. Mitigated by isolating them in `fetch`/`parse` and by
building against recorded fixtures that will be regenerated from a real account.

## Reversal cost

Low.

## Revisit if

Live documentation contradicts anything here, or two-way sync is approved.
