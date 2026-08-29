-- Domain events: an immutable ledger and a mutable delivery outbox (ADR-0008).
--
-- The ledger is NOT the persistence model. Canonical tables remain the current-state
-- source of truth. This is not event sourcing (spec §17).

CREATE SCHEMA IF NOT EXISTS events;
COMMENT ON SCHEMA events IS
  'Append-only domain event ledger plus mutable delivery state. Two concerns, two tables.';

-- ---------------------------------------------------------------------------
-- Commit-ordered sequence (ADR-0008).
--
-- A plain BIGSERIAL does not give an order a reader can safely tail: sequence
-- values are handed out at INSERT time, so a transaction holding sequence 100 may
-- commit after one holding 101, and a reader following `sequence > cursor` skips
-- the gap and never returns for it.
--
-- The UnitOfWork therefore buffers events and flushes them as the last statement
-- before COMMIT, holding an advisory transaction lock while it draws sequence
-- values. The lock is released only at commit, so no later transaction can obtain
-- a sequence number until the earlier one has committed. Sequence order is
-- therefore commit order, and the feed is safe to tail with no visibility caveats.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE events.domain_event_sequence AS bigint START 1;

CREATE OR REPLACE FUNCTION events.sequence_lock_key()
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 8317531::bigint $$;
COMMENT ON FUNCTION events.sequence_lock_key() IS
  'Advisory lock key serialising event sequence assignment with commit order.';

-- Registry of event types the system is allowed to emit. Populated at startup from
-- the TypeBox definitions in src/modules/*/events (ADR-0009). The foreign key from
-- domain_event makes emitting an unregistered event impossible.
CREATE TABLE events.event_type_version (
  event_type      text        NOT NULL,
  schema_version  integer     NOT NULL CHECK (schema_version >= 1),
  producer_module text        NOT NULL,
  description     text        NOT NULL,
  json_schema     jsonb       NOT NULL,
  aggregate_type  text        NOT NULL,
  introduced_at   timestamptz NOT NULL DEFAULT now(),
  deprecated_at   timestamptz,
  PRIMARY KEY (event_type, schema_version),
  CONSTRAINT event_type_naming CHECK (event_type ~ '^fsw\.[a-z]+\.[A-Za-z]+$')
);
COMMENT ON TABLE events.event_type_version IS
  'Every event type and version the system may emit, with its JSON Schema. '
  'Breaking changes create a new version; stored events are never reinterpreted '
  'under a newer schema (spec §18).';

CREATE TABLE events.domain_event (
  id                 uuid        PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  sequence           bigint      NOT NULL UNIQUE,

  event_type         text        NOT NULL,
  schema_version     integer     NOT NULL,

  aggregate_type     text        NOT NULL,
  aggregate_id       text        NOT NULL,

  occurred_at        timestamptz NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),

  actor_principal_id uuid,
  actor_type         text        NOT NULL
    CHECK (actor_type IN ('USER','SERVICE_ACCOUNT','SYSTEM','MIGRATION')),
  actor_label        text        NOT NULL,

  correlation_id     uuid        NOT NULL,
  causation_id       uuid,
  operating_company  kernel.code_key REFERENCES kernel.operating_company (code),
  source             text        NOT NULL,

  payload            jsonb       NOT NULL,

  FOREIGN KEY (event_type, schema_version)
    REFERENCES events.event_type_version (event_type, schema_version)
);

CREATE INDEX domain_event_type_idx      ON events.domain_event (event_type, sequence);
CREATE INDEX domain_event_aggregate_idx ON events.domain_event (aggregate_type, aggregate_id, sequence);
CREATE INDEX domain_event_correlation_idx ON events.domain_event (correlation_id);
CREATE INDEX domain_event_recorded_idx   ON events.domain_event (recorded_at);

COMMENT ON TABLE events.domain_event IS
  'Append-only, immutable, permanently replayable. UPDATE and DELETE are revoked '
  'from the application role. Payloads carry identifiers and non-personal facts '
  'only — never PII (ADR-0009), which is what allows lawful erasure to coexist '
  'with an immutable ledger.';
COMMENT ON COLUMN events.domain_event.sequence IS
  'Total order equal to commit order. Safe to tail: sequence > cursor cannot skip '
  'a committed event. See ADR-0008.';
COMMENT ON COLUMN events.domain_event.source IS
  'What caused this event: an interface (http), a connector (connector:p21), or a '
  'job (job:reconcile). Distinct from the actor, which is who.';

-- ---------------------------------------------------------------------------
-- Delivery: mutable, prunable, and explicitly not the ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE events.subscription (
  id                    uuid        PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  key                   kernel.machine_key NOT NULL UNIQUE,
  name                  text        NOT NULL,
  kind                  text        NOT NULL CHECK (kind IN ('WEBHOOK','INTERNAL')),
  -- Webhook only.
  endpoint_url          text,
  -- Name of the secret in the platform secret store. The secret itself is never
  -- stored in the database (spec §62).
  signing_secret_ref    text,
  -- Glob patterns matched against event_type, e.g. 'fsw.pim.*'.
  event_type_patterns   text[]      NOT NULL DEFAULT ARRAY['*'],
  is_active             boolean     NOT NULL DEFAULT true,
  max_attempts          integer     NOT NULL DEFAULT 8,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_needs_endpoint
    CHECK (kind <> 'WEBHOOK' OR (endpoint_url IS NOT NULL AND signing_secret_ref IS NOT NULL))
);
COMMENT ON TABLE events.subscription IS
  'Registered consumers. INTERNAL subscriptions are in-process projections; WEBHOOK '
  'subscriptions receive signed HTTP deliveries (ADR-0010).';

CREATE TABLE events.event_delivery (
  id               uuid        PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  event_id         uuid        NOT NULL REFERENCES events.domain_event (id),
  subscription_id  uuid        NOT NULL REFERENCES events.subscription (id) ON DELETE CASCADE,
  status           text        NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CLAIMED','DELIVERED','FAILED','SKIPPED')),
  attempts         integer     NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at       timestamptz,
  claimed_by       text,
  delivered_at     timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, subscription_id)
);
CREATE INDEX event_delivery_due_idx
  ON events.event_delivery (next_attempt_at)
  WHERE status IN ('PENDING','CLAIMED');
CREATE INDEX event_delivery_failed_idx
  ON events.event_delivery (subscription_id)
  WHERE status = 'FAILED';

COMMENT ON TABLE events.event_delivery IS
  'Mutable dispatch state. Prunable after successful delivery without affecting '
  'replay, because the ledger is a separate table (ADR-0008). A FAILED row is '
  'visible, alertable and manually re-drivable — never silently dropped.';

-- ---------------------------------------------------------------------------
-- Consumer-side idempotency (spec §17, acceptance criterion 19).
-- ---------------------------------------------------------------------------
CREATE TABLE events.consumer_inbox (
  consumer_key  kernel.machine_key NOT NULL,
  event_id      uuid        NOT NULL REFERENCES events.domain_event (id),
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_key, event_id)
);
COMMENT ON TABLE events.consumer_inbox IS
  'Events a consumer has already applied. Makes at-least-once delivery safe: a '
  'duplicate is a primary key conflict, which is a no-op, not corruption.';

CREATE TABLE events.consumer_cursor (
  consumer_key   kernel.machine_key PRIMARY KEY,
  last_sequence  bigint      NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE events.consumer_cursor IS
  'How far each in-process projection has read. Setting last_sequence to 0 and '
  'clearing the projection is how a read model is rebuilt from event zero.';

-- Immutability of the ledger, enforced by grants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT USAGE ON SCHEMA events TO fsw_app;
    GRANT SELECT, INSERT ON events.domain_event TO fsw_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON events.domain_event FROM fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON events.event_delivery TO fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON events.consumer_inbox TO fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON events.consumer_cursor TO fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON events.subscription TO fsw_app;
    GRANT SELECT, INSERT, UPDATE ON events.event_type_version TO fsw_app;
    GRANT USAGE ON SEQUENCE events.domain_event_sequence TO fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT USAGE ON SCHEMA events TO fsw_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA events TO fsw_readonly;
  END IF;
END;
$$;
