# ADR-0010: No message broker in v1; an HTTP event feed plus an outbound webhook dispatcher

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

The specification requires reliable at-least-once delivery to future consumers, forbids
introducing Kafka merely to satisfy that, and does not otherwise say how a consuming
application receives events. Without an answer, every future FSW application will
poll REST endpoints on a timer, which is the outcome Layer 0 exists to prevent.

## Decision

Two delivery mechanisms, both backed by `events.domain_event` (ADR-0008), no broker:

1. **Pull — the event feed.** `GET /v1/events?after=<sequence>&limit=<n>&type=<filter>`
   returns events in commit order with an opaque cursor. Authenticated and permission-
   scoped like any other API. This is the primary integration mechanism: it is trivially
   resumable, trivially replayable from zero, requires no infrastructure on either side,
   and cannot lose an event.
2. **Push — outbound webhooks.** `events.subscription` registers a consumer URL,
   an event-type filter, and a signing secret. A background dispatcher claims
   `events.event_delivery` rows with `FOR UPDATE SKIP LOCKED`, posts with an HMAC-SHA256
   signature and a replay-guard timestamp, retries with exponential backoff and jitter,
   and moves rows to `FAILED` after the configured attempt ceiling. A failed row is
   visible, alertable, and manually re-drivable — never silently dropped.

In-process consumers (internal projections, read models, facet rebuilds) subscribe
through the same ledger and record progress in `events.consumer_inbox`, so an internal
projection and an external consumer are the same shape of thing.

## Alternatives considered

| Option | Why not now |
|---|---|
| Kafka / Redpanda | Operationally heavy; a broker for a system emitting thousands of events per day is unjustifiable for a small team. |
| RabbitMQ | Lighter than Kafka but still a second durable system with its own backup and failure model. |
| PostgreSQL `LISTEN`/`NOTIFY` | Fire-and-forget with an 8 kB payload cap and no durability if no listener is connected. Useful only as a *wake-up hint* for the dispatcher, which is how we use it. |
| Amazon SQS / EventBridge | Reasonable, but couples Layer 0 to one cloud and adds a delivery path we cannot replay from. |

## Why this wins

The pull feed makes replay (acceptance criterion 18) a normal API call rather than a
special operational procedure, and it gives every future FSW application a
zero-infrastructure way to stay in sync.

## Consequences

- Consumers that need low latency use webhooks; consumers that value simplicity poll.
- The dispatcher is a background worker in the same deployable, not a separate service.
- Feed reads hit the primary database. If that becomes a problem the feed moves to a
  read replica, which is a configuration change (ADR-0030).

## Risks

A slow or hostile webhook endpoint could consume dispatcher capacity. Mitigated by
per-subscription concurrency caps, per-request timeouts, and circuit-breaking a
subscription after sustained failure.

## Reversal cost

Low. A broker can be added later as one more subscription that republishes the feed;
no producer code changes.

## Revisit if

A consumer needs sub-second fan-out at high volume, or the number of external
subscriptions makes per-subscription delivery rows a bottleneck.
