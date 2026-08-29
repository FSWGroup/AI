-- Source integration and master-data ingestion (spec §8, ADR-0022).
--
-- This is not a side script. Much of the initial canonical dataset will be created
-- from Prophet 21 and Pipedrive, so ingestion is a first-class part of Layer 0 with
-- the same standards of evidence as anything else:
--
--   * what the source actually said is preserved verbatim, checksummed, and never
--     mutated to make canonical data look clean
--   * every run is restartable and idempotent
--   * bad records are quarantined visibly, never silently discarded
--   * structural drift halts a run rather than shifting data into the wrong fields
--
-- The connector interface is source-neutral. When Prophet 21 API access appears, the
-- adapter's fetch and parse are replaced and the canonical model does not move.

CREATE SCHEMA IF NOT EXISTS ingest;
COMMENT ON SCHEMA ingest IS
  'Source integration: connectors, runs, landed files, raw source records, quarantine '
  'and schema fingerprints. The anti-corruption boundary (spec §77): no canonical '
  'table outside this schema carries a source-system identifier.';

-- ---------------------------------------------------------------------------
-- Connectors
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.connector (
  key                kernel.machine_key PRIMARY KEY,
  name               text NOT NULL,
  description        text NOT NULL,
  source_system_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  -- How data physically arrives. FILE covers everything from a scheduled Epicor
  -- report to a person exporting a spreadsheet on a Friday; the pipeline does not
  -- care which, and the freshness guarantee is published separately.
  kind               text NOT NULL CHECK (kind IN ('FILE','API','WEBHOOK','MANUAL')),
  -- Bumped when the mapping changes meaning. Recorded on every source record, so a
  -- value can always be traced to the rules in force when it was interpreted.
  mapping_version    integer NOT NULL DEFAULT 1,
  parser_version     integer NOT NULL DEFAULT 1,
  is_enabled         boolean NOT NULL DEFAULT true,
  -- How stale data from this connector may be before it is worth alerting on.
  expected_interval  interval,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Runs (spec §8)
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.run (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  connector_key     kernel.machine_key NOT NULL REFERENCES ingest.connector (key),
  mode              text NOT NULL CHECK (mode IN ('FULL','INCREMENTAL','RECONCILE','REPLAY')),
  status            text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','HALTED','CANCELLED')),

  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,

  -- Where the connector had reached before this run, and where it reached after. A
  -- restart resumes from watermark_before; a completed run advances it.
  watermark_before  text,
  watermark_after   text,

  -- Counters the specification enumerates. Kept as columns rather than a jsonb blob
  -- because they are queried, charted and alerted on.
  discovered        integer NOT NULL DEFAULT 0,
  downloaded        integer NOT NULL DEFAULT 0,
  added             integer NOT NULL DEFAULT 0,
  changed           integer NOT NULL DEFAULT 0,
  unchanged         integer NOT NULL DEFAULT 0,
  rejected          integer NOT NULL DEFAULT 0,
  matched           integer NOT NULL DEFAULT 0,
  needs_review      integer NOT NULL DEFAULT 0,
  error_count       integer NOT NULL DEFAULT 0,

  -- What the source claimed was available, for reconciliation against what arrived.
  manifest          jsonb,
  -- Why a run halted, in language an operator can act on.
  halt_reason       text,

  actor_principal_id uuid,
  correlation_id    uuid NOT NULL,
  mapping_version   integer NOT NULL DEFAULT 1,
  parser_version    integer NOT NULL DEFAULT 1,

  CONSTRAINT run_ended_when_finished CHECK (status = 'RUNNING' OR ended_at IS NOT NULL),
  CONSTRAINT halted_run_has_reason CHECK (status <> 'HALTED' OR halt_reason IS NOT NULL)
);
CREATE INDEX run_connector_idx ON ingest.run (connector_key, started_at DESC);
CREATE INDEX run_status_idx ON ingest.run (status) WHERE status = 'RUNNING';

COMMENT ON TABLE ingest.run IS
  'One import or synchronisation attempt. Restartable and idempotent: re-running a '
  'completed run changes nothing, and an interrupted run resumes from its watermark.';

-- ---------------------------------------------------------------------------
-- Landed files (ADR-0023)
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.landed_file (
  id                  uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  run_id              uuid NOT NULL REFERENCES ingest.run (id),
  connector_key       kernel.machine_key NOT NULL REFERENCES ingest.connector (key),
  filename            text NOT NULL,
  byte_size           bigint NOT NULL CHECK (byte_size >= 0),
  -- The file's identity. Re-presenting the same bytes is recognised and produces no
  -- duplicate business facts, which is most of acceptance criterion 14.
  sha256              text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Where the original is preserved, immutably (ADR-0026). A reference, not the bytes.
  object_ref          text NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  -- The declared encoding actually used to decode it. Epicor exports are commonly
  -- windows-1252, and guessing is how a degree symbol becomes a replacement character.
  encoding            text NOT NULL DEFAULT 'utf-8',
  -- The source time zone used to interpret naive timestamps in this file.
  source_timezone     text NOT NULL DEFAULT 'UTC',
  object_type         kernel.machine_key NOT NULL,
  schema_fingerprint  text NOT NULL,
  row_count           integer,
  parser_version      integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX landed_file_content_idx
  ON ingest.landed_file (connector_key, object_type, sha256);
CREATE INDEX landed_file_run_idx ON ingest.landed_file (run_id);

COMMENT ON TABLE ingest.landed_file IS
  'Every file the system has ingested, identified by content hash. The unique index '
  'on (connector, object type, sha256) is what makes re-presenting the same export a '
  'no-op rather than a duplicate import.';

-- ---------------------------------------------------------------------------
-- Structural fingerprints (acceptance criterion 15)
--
-- Parsing is by header NAME against an approved structure, never by position, so a
-- newly added column cannot silently shift data one field to the left. An unapproved
-- structure halts the run before any canonical write.
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.schema_fingerprint (
  id             uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  connector_key  kernel.machine_key NOT NULL REFERENCES ingest.connector (key),
  object_type    kernel.machine_key NOT NULL,
  -- SHA-256 over the normalized, sorted column list.
  fingerprint    text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  columns        text[] NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  first_seen_run uuid REFERENCES ingest.run (id),
  approved_at    timestamptz,
  approved_by    uuid,
  -- What changed relative to the previously approved structure, in plain language.
  change_summary text,
  CONSTRAINT fingerprint_unique UNIQUE (connector_key, object_type, fingerprint)
);
CREATE INDEX schema_fingerprint_approved_idx
  ON ingest.schema_fingerprint (connector_key, object_type) WHERE approved_at IS NOT NULL;

COMMENT ON TABLE ingest.schema_fingerprint IS
  'Approved structures per connector and object type. An unrecognised structure halts '
  'the run: a P21 export that gains a column is a change someone must look at, not '
  'something to absorb silently (acceptance criterion 15).';

-- ---------------------------------------------------------------------------
-- Source records: what the source actually said (spec §8)
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.source_record (
  id                  uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  source_system_code  kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  object_type         kernel.machine_key NOT NULL,
  -- The source's own identifier for this record. Never becomes a canonical key.
  source_id           text NOT NULL,

  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  first_seen_run      uuid REFERENCES ingest.run (id),
  last_seen_run       uuid REFERENCES ingest.run (id),
  -- When the SOURCE says it last changed, where the source tells us.
  source_updated_at   timestamptz,

  -- The current payload and its hash. The hash is how "unchanged" is decided without
  -- comparing every field.
  payload             jsonb NOT NULL,
  payload_hash        text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  -- Set when the record stops appearing in a full extract, or the source says it was
  -- deleted. Never a hard delete: the record was real and referenced things.
  deleted_in_source_at timestamptz,

  mapping_version     integer NOT NULL DEFAULT 1,
  parser_version      integer NOT NULL DEFAULT 1,
  mapping_status      text NOT NULL DEFAULT 'UNMAPPED'
    CHECK (mapping_status IN ('UNMAPPED','MAPPED','NEEDS_REVIEW','REJECTED','IGNORED')),
  validation_status   text NOT NULL DEFAULT 'VALID'
    CHECK (validation_status IN ('VALID','INVALID','WARNING')),
  landed_file_id      uuid REFERENCES ingest.landed_file (id),

  CONSTRAINT source_record_identity UNIQUE (source_system_code, object_type, source_id)
);
CREATE INDEX source_record_hash_idx
  ON ingest.source_record (source_system_code, object_type, payload_hash);
CREATE INDEX source_record_mapping_idx
  ON ingest.source_record (source_system_code, object_type, mapping_status);
CREATE INDEX source_record_updated_idx
  ON ingest.source_record (source_system_code, object_type, source_updated_at DESC);
CREATE INDEX source_record_live_idx
  ON ingest.source_record (source_system_code, object_type)
  WHERE deleted_in_source_at IS NULL;

COMMENT ON TABLE ingest.source_record IS
  'The durable identity of a record in a source system, with what it currently says. '
  'Matching a source record to a canonical entity ADDS a relationship; it never '
  'pretends the source record did not exist (spec §48).';

CREATE TABLE ingest.source_record_version (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  source_record_id  uuid NOT NULL REFERENCES ingest.source_record (id) ON DELETE CASCADE,
  run_id            uuid REFERENCES ingest.run (id),
  observed_at       timestamptz NOT NULL DEFAULT now(),
  payload           jsonb NOT NULL,
  payload_hash      text NOT NULL,
  source_updated_at timestamptz,
  landed_file_id    uuid REFERENCES ingest.landed_file (id),
  CONSTRAINT source_record_version_unique UNIQUE (source_record_id, payload_hash, observed_at)
);
CREATE INDEX source_record_version_record_idx
  ON ingest.source_record_version (source_record_id, observed_at DESC);

COMMENT ON TABLE ingest.source_record_version IS
  'Every distinct payload a source record has ever had. Append-only and never mutated: '
  'raw source history is not edited to make canonical data look clean (spec §8). Also '
  'what allows re-mapping from preserved payloads without re-extracting from a source '
  'we may no longer be able to query.';

-- ---------------------------------------------------------------------------
-- Quarantine (acceptance criterion 16)
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.quarantine (
  id                 uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  run_id             uuid NOT NULL REFERENCES ingest.run (id),
  connector_key      kernel.machine_key NOT NULL REFERENCES ingest.connector (key),
  source_system_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  object_type        kernel.machine_key NOT NULL,
  -- Present when the record at least had an identifier. A row so malformed that even
  -- the key could not be read is still quarantined, with the raw text.
  source_id          text,

  failure_category   text NOT NULL CHECK (failure_category IN (
                       'PARSE_ERROR','MISSING_REQUIRED_FIELD','INVALID_VALUE',
                       'UNKNOWN_ENUM','DUPLICATE_KEY','MAPPING_ERROR',
                       'REFERENTIAL_ERROR','ENCODING_ERROR','AMBIGUOUS_MATCH')),
  -- One message per problem, in language that says what to do about it.
  messages           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The record exactly as it arrived, so nothing is lost by rejecting it.
  raw                jsonb NOT NULL,
  attempted_mapping  jsonb,
  row_number         integer,
  landed_file_id     uuid REFERENCES ingest.landed_file (id),

  status             text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','RESOLVED','IGNORED','SUPERSEDED')),
  retry_count        integer NOT NULL DEFAULT 0,
  resolved_by        uuid,
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quarantine_resolution_has_note CHECK (
    status IN ('OPEN','SUPERSEDED') OR resolution_note IS NOT NULL)
);
CREATE INDEX quarantine_open_idx
  ON ingest.quarantine (connector_key, failure_category) WHERE status = 'OPEN';
CREATE INDEX quarantine_run_idx ON ingest.quarantine (run_id);
CREATE INDEX quarantine_source_idx
  ON ingest.quarantine (source_system_code, object_type, source_id);

COMMENT ON TABLE ingest.quarantine IS
  'Records that could not be processed, with the reason, the original payload and the '
  'attempted mapping. Nothing is silently discarded: a malformed record is a visible '
  'item of work, and the import continues (acceptance criterion 16).';

-- ---------------------------------------------------------------------------
-- Custom field definitions (spec §10)
--
-- Pipedrive custom-field identifiers are opaque hashes that change between accounts.
-- They are ingested as data and referenced through a versioned mapping, so no magic
-- identifier appears in application code.
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.source_field_definition (
  id                 uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  source_system_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  object_type        kernel.machine_key NOT NULL,
  -- The source's own key: a Pipedrive custom field hash, a P21 column name.
  source_key         text NOT NULL,
  label              text NOT NULL,
  data_type          text,
  -- Enumerated options where the source defines them, so an unknown value can be
  -- detected rather than stored blindly.
  options            jsonb,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  removed_at         timestamptz,
  CONSTRAINT source_field_identity UNIQUE (source_system_code, object_type, source_key)
);

COMMENT ON TABLE ingest.source_field_definition IS
  'Field definitions as the source declares them. A custom field that disappears or '
  'changes type is schema drift, handled the same way a changed P21 column is.';

-- ---------------------------------------------------------------------------
-- Reconciliation (acceptance criterion 13)
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.reconciliation (
  id                 uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  run_id             uuid NOT NULL REFERENCES ingest.run (id),
  connector_key      kernel.machine_key NOT NULL REFERENCES ingest.connector (key),
  object_type        kernel.machine_key NOT NULL,
  method             text NOT NULL CHECK (method IN (
                       'COUNT','ID_SET_DIFFERENCE','UPDATED_WINDOW','PAYLOAD_HASH','FULL_SCAN')),
  source_count       integer,
  local_count        integer,
  missing_locally    integer NOT NULL DEFAULT 0,
  extra_locally      integer NOT NULL DEFAULT 0,
  diverged           integer NOT NULL DEFAULT 0,
  repaired           integer NOT NULL DEFAULT 0,
  -- Identifiers of what diverged, capped so a bad day does not write a novel.
  sample             jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_connector_idx
  ON ingest.reconciliation (connector_key, created_at DESC);

COMMENT ON TABLE ingest.reconciliation IS
  'Divergence checks. Incremental synchronisation alone is insufficient: a lost '
  'webhook must not create permanent silent divergence, so reconciliation runs on a '
  'schedule regardless of webhook health (spec §8).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT USAGE ON SCHEMA ingest TO fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ingest TO fsw_app;
    -- Raw source history is append-only: it is evidence of what a source said.
    REVOKE UPDATE, DELETE ON ingest.source_record_version FROM fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT USAGE ON SCHEMA ingest TO fsw_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA ingest TO fsw_readonly;
  END IF;
END;
$$;
