-- Kernel: the shared primitives every module depends on (ADR-0003, spec §6).
-- Deliberately small. This is not a dumping ground.

CREATE SCHEMA IF NOT EXISTS kernel;
COMMENT ON SCHEMA kernel IS
  'Shared primitives: identifiers, registries, idempotency. Owned by no domain module.';

-- ---------------------------------------------------------------------------
-- UUIDv7 (ADR-0004)
--
-- PostgreSQL 16 has no built-in uuidv7(); this is the 48-bit-timestamp form from
-- RFC 9562 with a random suffix. Replace with the built-in when the baseline
-- moves to PostgreSQL 18. Stored values are unaffected by that change.
--
-- Note: the random suffix means two values generated inside the same millisecond
-- have no guaranteed order relative to each other. That is permitted by RFC 9562
-- and is irrelevant here, because ordering that matters (the event ledger) uses
-- an explicit sequence, not the identifier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kernel.uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  ts_ms bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b     bytea;
BEGIN
  -- 48-bit big-endian millisecond timestamp, then 80 random bits.
  b := substring(int8send(ts_ms) FROM 3 FOR 6) || gen_random_bytes(10);
  -- Byte 6 high nibble = version 7.
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);
  -- Byte 8 top two bits = RFC 4122 variant.
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);
  RETURN encode(b, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION kernel.uuid_generate_v7() IS
  'RFC 9562 UUIDv7. Canonical identifiers are generated in the application by '
  'default; this exists for migrations, seeds and set-based backfills (ADR-0004).';

-- ---------------------------------------------------------------------------
-- Naming domains: machine keys are lowercase snake_case everywhere, enforced
-- once rather than in forty CHECK constraints.
-- ---------------------------------------------------------------------------
CREATE DOMAIN kernel.machine_key AS text
  CONSTRAINT machine_key_format CHECK (VALUE ~ '^[a-z][a-z0-9_]{0,62}$');
COMMENT ON DOMAIN kernel.machine_key IS
  'Stable lowercase snake_case key. A secondary natural key, never a primary identity.';

CREATE DOMAIN kernel.code_key AS text
  CONSTRAINT code_key_format CHECK (VALUE ~ '^[A-Z][A-Z0-9_]{0,62}$');
COMMENT ON DOMAIN kernel.code_key IS 'Stable uppercase code used for enumerated registries.';

-- ---------------------------------------------------------------------------
-- Operating companies. The authorization scope boundary (ADR-0019).
-- ---------------------------------------------------------------------------
CREATE TABLE kernel.operating_company (
  code        kernel.code_key PRIMARY KEY,
  name        text        NOT NULL,
  is_group    boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE kernel.operating_company IS
  'FSW Group and its operating businesses. Used as the authorization scope and as '
  'the visibility boundary for company-specific data.';
COMMENT ON COLUMN kernel.operating_company.is_group IS
  'True only for FSW_GROUP, which is the scope that spans all companies.';

-- ---------------------------------------------------------------------------
-- Source systems. Every fact in Layer 0 is attributable to one of these
-- (spec §11, ADR-0011).
-- ---------------------------------------------------------------------------
CREATE TABLE kernel.source_system (
  code              kernel.code_key PRIMARY KEY,
  name              text        NOT NULL,
  kind              text        NOT NULL
    CHECK (kind IN ('ERP','CRM','ECOMMERCE','CATALOG','SPREADSHEET','MANUAL','DERIVED','INTERNAL')),
  description       text,
  -- Whether payloads from this source may contain personal data. Drives
  -- per-subject encryption of raw payloads (ADR-0027).
  contains_pii      boolean     NOT NULL DEFAULT false,
  -- Default survivorship precedence; per-field rules override this (ADR-0011).
  default_priority  integer     NOT NULL DEFAULT 100,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE kernel.source_system IS
  'Registry of systems that assert facts, including MANUAL (a human editing through '
  'the admin UI) and DERIVED (a parser or rule). A human edit is a candidate value '
  'from MANUAL, not a direct write to a canonical row. See ADR-0011.';
COMMENT ON COLUMN kernel.source_system.default_priority IS
  'Lower wins. Used only when a field has no explicit survivorship rule.';

-- ---------------------------------------------------------------------------
-- Idempotency keys (ADR-0028, spec §59).
-- ---------------------------------------------------------------------------
CREATE TABLE kernel.idempotency_key (
  id                    uuid        PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  idempotency_key       text        NOT NULL,
  principal_id          uuid        NOT NULL,
  endpoint              text        NOT NULL,
  -- Hash of the request body, so the same key with different content is an error
  -- rather than a silently returned stale response.
  request_fingerprint   text        NOT NULL,
  response_status       integer,
  response_body         jsonb,
  state                 text        NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (state IN ('IN_PROGRESS','COMPLETED','FAILED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  expires_at            timestamptz NOT NULL,
  CONSTRAINT idempotency_key_unique UNIQUE (principal_id, endpoint, idempotency_key)
);
CREATE INDEX idempotency_key_expires_idx ON kernel.idempotency_key (expires_at);
COMMENT ON TABLE kernel.idempotency_key IS
  'Replay protection for mutating endpoints. A retry with the same key and the same '
  'request fingerprint returns the stored response; a different fingerprint is a 422.';

-- ---------------------------------------------------------------------------
-- Database roles (ADR-0030). Group roles only; login roles are provisioned per
-- environment outside migrations. Created idempotently so this migration is
-- safe on a managed instance where some may already exist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    CREATE ROLE fsw_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    CREATE ROLE fsw_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_maintenance') THEN
    CREATE ROLE fsw_maintenance NOLOGIN;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping role creation: insufficient privilege. Provision roles out of band.';
END;
$$;
