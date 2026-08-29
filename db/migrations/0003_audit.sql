-- Audit trail (ADR-0021, spec §13).
--
-- Written by the application UnitOfWork inside the same transaction as the change,
-- because the actor, interface, correlation ID and reason live in the request
-- context and a database trigger cannot see them.
--
-- Audit answers "who changed this row, when, through what, and exactly what changed".
-- Domain events answer "what did the business assert". Both are written. Neither
-- substitutes for the other.

CREATE SCHEMA IF NOT EXISTS audit;
COMMENT ON SCHEMA audit IS 'Immutable change log. INSERT only for the application role.';

CREATE TABLE audit.change_log (
  id                  uuid        PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  occurred_at         timestamptz NOT NULL DEFAULT now(),

  -- Who
  actor_principal_id  uuid,
  actor_type          text        NOT NULL
    CHECK (actor_type IN ('USER','SERVICE_ACCOUNT','SYSTEM','MIGRATION')),
  actor_label         text        NOT NULL,

  -- Through what
  interface           text        NOT NULL
    CHECK (interface IN ('HTTP','CONNECTOR','JOB','CLI','MIGRATION','TEST')),
  client_ip           inet,
  user_agent          text,
  correlation_id      uuid        NOT NULL,
  causation_id        uuid,
  operating_company   kernel.code_key REFERENCES kernel.operating_company (code),

  -- To what
  entity_schema       text        NOT NULL,
  entity_table        text        NOT NULL,
  entity_id           text        NOT NULL,
  operation           text        NOT NULL
    CHECK (operation IN ('INSERT','UPDATE','DELETE','MERGE','UNMERGE','ERASE','DENY')),

  -- What changed. Secret-classified fields are redacted by the serializer before
  -- they ever reach this table (ADR-0021).
  before              jsonb,
  after               jsonb,
  changed_fields      text[],

  -- Why
  reason              text,

  -- For imported changes: the source record that carried the value (spec §13).
  source_record_id    uuid
);

CREATE INDEX change_log_entity_idx
  ON audit.change_log (entity_schema, entity_table, entity_id, occurred_at DESC);
CREATE INDEX change_log_actor_idx
  ON audit.change_log (actor_principal_id, occurred_at DESC);
CREATE INDEX change_log_correlation_idx
  ON audit.change_log (correlation_id);
CREATE INDEX change_log_occurred_idx
  ON audit.change_log (occurred_at DESC);
CREATE INDEX change_log_source_record_idx
  ON audit.change_log (source_record_id) WHERE source_record_id IS NOT NULL;

COMMENT ON TABLE audit.change_log IS
  'Who changed what, when, through which interface. Immutability is enforced by '
  'grants, not by convention: the application role has INSERT only.';
COMMENT ON COLUMN audit.change_log.operation IS
  'DENY records an authorization denial (spec §81 criterion 2), which is auditable '
  'even though nothing changed.';
COMMENT ON COLUMN audit.change_log.before IS
  'Prior column values, with SECRET-classified fields replaced by [redacted] and '
  'PII-classified fields subject to erasure (ADR-0027).';

-- Immutability. The owner is not restricted by these grants; production connects
-- as fsw_app, which is.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT USAGE ON SCHEMA audit TO fsw_app;
    GRANT INSERT, SELECT ON audit.change_log TO fsw_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit.change_log FROM fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_maintenance') THEN
    GRANT USAGE ON SCHEMA audit TO fsw_maintenance;
    -- Retention and erasure jobs only (ADR-0027).
    GRANT SELECT, UPDATE, DELETE ON audit.change_log TO fsw_maintenance;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT USAGE ON SCHEMA audit TO fsw_readonly;
    GRANT SELECT ON audit.change_log TO fsw_readonly;
  END IF;
END;
$$;
