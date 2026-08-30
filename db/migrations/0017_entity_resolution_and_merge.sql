-- Entity resolution, the review queue, and reversible merge (ADR-0025, ADR-0012,
-- spec §49, §50, acceptance criteria 8 and 9).
--
-- Two rules shape everything here.
--
-- FIRST: no opaque matching. Every candidate pair stores the feature vector that
-- produced its score, so a review screen shows WHICH SIGNALS FIRED AND WHAT EACH
-- CONTRIBUTED, not a bare number. An unexplainable merge of two customer accounts is
-- not defensible to the salesperson whose account disappeared, and "the model said so"
-- is not an answer. Specification §80 forbids ML matching outright, and it is right to.
--
-- SECOND: merge moves links, it never rewrites canonical values. Because canonical
-- values are derived (ADR-0011), unmerging and recomputing reproduces what each
-- organization should say — without restoring a snapshot, and without reconstructing
-- anything from audit logs, which §50 explicitly forbids.

-- ---------------------------------------------------------------------------
-- Aliases: other names an organization is known by
-- ---------------------------------------------------------------------------
CREATE TABLE party.organization_alias (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  organization_id   uuid NOT NULL REFERENCES party.organization (id) ON DELETE CASCADE,
  alias             text NOT NULL,
  -- The normalized form, produced by the versioned normalizer. Stored so blocking and
  -- exact-alias matching are index lookups rather than per-comparison work.
  normalized_alias  text NOT NULL,
  normalization_version integer NOT NULL DEFAULT 1,
  alias_type        text NOT NULL DEFAULT 'TRADING'
    CHECK (alias_type IN ('TRADING','FORMER','ABBREVIATION','MISSPELLING','DIVISION','LOCAL')),
  source_system_code kernel.code_key REFERENCES kernel.source_system (code),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT organization_alias_unique UNIQUE (organization_id, normalized_alias)
);
CREATE INDEX organization_alias_normalized_idx ON party.organization_alias (normalized_alias);
CREATE INDEX organization_alias_trgm_idx
  ON party.organization_alias USING gin (normalized_alias gin_trgm_ops);

COMMENT ON TABLE party.organization_alias IS
  'Other names an organization goes by. A misspelling recorded here is how "Acme '
  'Pharmaceutcal" stops being a new organization every time that spreadsheet arrives.';

-- ---------------------------------------------------------------------------
-- Matching configuration (ADR-0025, ADR-0017)
--
-- Weights and thresholds are configuration, tuned against a labelled fixture set with
-- precision and recall reported — not adjusted by intuition until the queue looks
-- shorter. Versioned, because changing a weight changes every score.
-- ---------------------------------------------------------------------------
CREATE TABLE party.match_config (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  entity_type       text NOT NULL CHECK (entity_type IN ('ORGANIZATION','PERSON','SITE')),
  version           integer NOT NULL,

  -- Signal weights, keyed by signal name. A signal absent from this object contributes
  -- nothing, so removing one is an edit here rather than a code change.
  weights           jsonb NOT NULL,

  -- At or above this, a link is created automatically. It is STILL recorded as a merge
  -- with full evidence, so it is as reversible as any other.
  --
  -- Defaulted above 1.0 on purpose: automatic merging is effectively disabled until
  -- precision has been measured on real FSW data. A bad automatic merge is expensive
  -- to notice and cheap to avoid, and no threshold chosen before seeing the data is
  -- worth the risk (ADR-0025).
  auto_link_threshold numeric(4,3) NOT NULL DEFAULT 1.010,
  -- At or above this, a pair goes to the review queue. Below it, nothing is created.
  review_threshold  numeric(4,3) NOT NULL DEFAULT 0.650,

  -- The name-normalization version these scores were produced under. A change here
  -- invalidates stored scores, which is why it is recorded rather than assumed.
  normalization_version integer NOT NULL DEFAULT 1,

  is_active         boolean NOT NULL DEFAULT true,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT match_config_version_unique UNIQUE (entity_type, version),
  CONSTRAINT thresholds_ordered CHECK (auto_link_threshold >= review_threshold)
);
CREATE UNIQUE INDEX match_config_active_idx
  ON party.match_config (entity_type) WHERE is_active;

INSERT INTO party.match_config (entity_type, version, weights, note) VALUES
  ('ORGANIZATION', 1, jsonb_build_object(
      'name_similarity',      0.30,
      'name_token_overlap',   0.10,
      'alias_exact',          0.15,
      'address_similarity',   0.15,
      'postal_exact',         0.10,
      'city_region_exact',    0.05,
      'domain_exact',         0.10,
      'phone_exact',          0.05,
      'shared_parent',        0.05
   ),
   'Initial weights from ADR-0025. Provisional until measured against a labelled set '
   'of real FSW duplicates; auto-linking is disabled by the default threshold.');

-- ---------------------------------------------------------------------------
-- Candidate pairs and the review queue
-- ---------------------------------------------------------------------------
CREATE TABLE party.match_candidate (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  entity_type       text NOT NULL CHECK (entity_type IN ('ORGANIZATION','PERSON','SITE')),

  -- Ordered so a pair is stored once however it was discovered. Enforced by the CHECK
  -- below rather than by convention, because "we always put the smaller one first" is
  -- exactly the sort of convention that decays.
  left_entity_id    uuid NOT NULL,
  right_entity_id   uuid NOT NULL,

  score             numeric(5,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  -- What each signal contributed. This is the explainability requirement met
  -- literally: [{signal, value, weight, contribution, detail}].
  features          jsonb NOT NULL,
  -- DETERMINISTIC pairs skip scoring entirely and record which rule fired.
  method            text NOT NULL
    CHECK (method IN ('DETERMINISTIC','PROBABILISTIC','MANUAL')),
  deterministic_rule text,
  blocking_keys     text[] NOT NULL DEFAULT '{}',

  match_config_version integer,
  normalization_version integer NOT NULL DEFAULT 1,

  status            text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','DEFERRED','KNOWN_DIFFERENT',
                      'AUTO_LINKED','SUPERSEDED')),
  -- A hash over the evidence that produced this pair. A rejected pair does not
  -- resurface unless the evidence MATERIALLY changes: without this the queue fills
  -- with the same twelve pairs a steward has already said no to, and stops being read.
  evidence_fingerprint text NOT NULL,

  decided_at        timestamptz,
  decided_by        uuid,
  decision_reason   text,
  -- Set when a decision produced a merge, so the queue links to what it caused.
  merge_id          uuid,

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT match_pair_ordered CHECK (left_entity_id < right_entity_id),
  CONSTRAINT match_pair_distinct CHECK (left_entity_id <> right_entity_id),
  CONSTRAINT decided_candidate_has_stamp CHECK (
    status IN ('PENDING','DEFERRED') OR decided_at IS NOT NULL),
  CONSTRAINT deterministic_names_its_rule CHECK (
    method <> 'DETERMINISTIC' OR deterministic_rule IS NOT NULL)
);
CREATE UNIQUE INDEX match_candidate_pair_idx
  ON party.match_candidate (entity_type, left_entity_id, right_entity_id, evidence_fingerprint);
CREATE INDEX match_candidate_queue_idx
  ON party.match_candidate (entity_type, status, score DESC) WHERE status = 'PENDING';
CREATE INDEX match_candidate_entity_idx
  ON party.match_candidate (entity_type, left_entity_id);
CREATE INDEX match_candidate_entity_right_idx
  ON party.match_candidate (entity_type, right_entity_id);

COMMENT ON TABLE party.match_candidate IS
  'Pairs that may be the same thing, with the evidence that says so. The feature '
  'vector is the point: a reviewer sees which signals fired and what each contributed '
  '(ADR-0025). The queue needs a named owner or it becomes a landfill — that is a '
  'people problem the schema cannot solve, and it is open question B5.';
COMMENT ON COLUMN party.match_candidate.evidence_fingerprint IS
  'Hash of the evidence. A pair a steward rejected returns only when the evidence '
  'materially changes, which is what keeps the queue worth reading.';

-- ---------------------------------------------------------------------------
-- Merge, and the movement ledger that makes it reversible
-- ---------------------------------------------------------------------------
CREATE TABLE party.organization_merge (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  surviving_organization_id uuid NOT NULL REFERENCES party.organization (id),
  merged_organization_id    uuid NOT NULL REFERENCES party.organization (id),

  -- Always required, human or service. A merge with no stated reason is one nobody
  -- can evaluate later.
  reason            text NOT NULL,
  method            text NOT NULL
    CHECK (method IN ('MANUAL','DETERMINISTIC','AUTO_LINKED')),
  score             numeric(5,4),
  evidence          jsonb,
  match_candidate_id uuid REFERENCES party.match_candidate (id),

  merged_at         timestamptz NOT NULL DEFAULT now(),
  merged_by         uuid,
  correlation_id    uuid,

  reversed_at       timestamptz,
  reversed_by       uuid,
  reversal_reason   text,

  CONSTRAINT merge_distinct CHECK (surviving_organization_id <> merged_organization_id),
  CONSTRAINT reversal_has_reason CHECK (
    (reversed_at IS NULL) = (reversal_reason IS NULL)),
  CONSTRAINT reversal_has_actor CHECK (reversed_at IS NOT NULL OR reversed_by IS NULL)
);
CREATE INDEX organization_merge_surviving_idx
  ON party.organization_merge (surviving_organization_id, merged_at DESC);
CREATE UNIQUE INDEX organization_merge_live_idx
  ON party.organization_merge (merged_organization_id) WHERE reversed_at IS NULL;

COMMENT ON TABLE party.organization_merge IS
  'One merge. Kept forever, reversed or not: a merge that happened is a fact about '
  'what people believed, and the reversal is another fact beside it.';

CREATE TABLE party.merge_link_move (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  merge_id          uuid NOT NULL REFERENCES party.organization_merge (id) ON DELETE CASCADE,

  -- Which table the moved row lives in, and which row. Not a foreign key: the ledger
  -- spans a dozen tables, and a per-table ledger would be a dozen near-identical
  -- tables whose merge code drifts apart.
  entity_table      text NOT NULL,
  row_id            uuid NOT NULL,
  column_name       text NOT NULL,
  from_value        uuid NOT NULL,
  to_value          uuid NOT NULL,

  -- Set when the move was reversed, so a chained merge reverses only its own moves.
  reversed_at       timestamptz,
  moved_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT move_changes_something CHECK (from_value <> to_value)
);
CREATE INDEX merge_link_move_merge_idx ON party.merge_link_move (merge_id);
CREATE INDEX merge_link_move_row_idx ON party.merge_link_move (entity_table, row_id);

COMMENT ON TABLE party.merge_link_move IS
  'Every row a merge re-pointed, and what it pointed at before. Unmerge replays this '
  'in reverse. It is load-bearing: the alternative — reconstructing the previous state '
  'from audit logs — is what §50 forbids, and rightly, because an audit log is '
  'evidence rather than a backup.';

-- ---------------------------------------------------------------------------
-- The merge manifest
--
-- Everything a merge must move. Enumerated as DATA so that the consistency test can
-- compare it against the catalogue and fail when a new organization-owned table is
-- added and forgotten. An unregistered child table would otherwise be silently left
-- behind on merge, pointing at an organization that no longer takes new facts, and
-- nobody would notice until someone asked why a site had disappeared.
-- ---------------------------------------------------------------------------
CREATE TABLE party.merge_manifest (
  entity_table      text NOT NULL,
  column_name       text NOT NULL,
  -- MOVE re-points the row at the survivor. Everything is MOVE today; the column
  -- exists because a future child table may need different handling, and discovering
  -- that by adding a value beats discovering it by adding an if-statement.
  strategy          text NOT NULL DEFAULT 'MOVE' CHECK (strategy IN ('MOVE')),
  -- Applied in this order. Roles and relationships last, because they can conflict
  -- with rows the survivor already has and the conflict handling assumes the rest has
  -- already landed.
  apply_order       integer NOT NULL DEFAULT 100,
  note              text,
  PRIMARY KEY (entity_table, column_name)
);

INSERT INTO party.merge_manifest (entity_table, column_name, apply_order, note) VALUES
  ('party.source_link',           'entity_id',            10,
   'The links themselves. Moving these is what a merge fundamentally IS (ADR-0012).'),
  ('party.field_candidate',       'entity_id',            20,
   'The survivor gains the loser''s candidates, which is the ONLY way its canonical '
   'values change during a merge.'),
  ('party.site',                  'organization_id',      30, 'Facilities.'),
  ('party.commercial_account',    'organization_id',      40, 'Accounting constructs.'),
  ('party.person_affiliation',    'organization_id',      50, 'Who works there.'),
  ('party.organization_alias',    'organization_id',      60, 'Other names it goes by.'),
  ('party.organization_role',     'organization_id',      70,
   'Last but one: the survivor may already hold the same role, so duplicates are '
   'dropped rather than moved.'),
  ('party.organization_relationship','from_organization_id',80, 'Outgoing relationships.'),
  ('party.organization_relationship','to_organization_id',  90, 'Incoming relationships.');

COMMENT ON TABLE party.merge_manifest IS
  'Every table a merge must move, as data rather than as code. A test compares this '
  'against every foreign key referencing party.organization and FAILS when a new one '
  'is unregistered (ADR-0012). Adding a child table is therefore a change to this '
  'table and to the merge tests, by construction.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA party TO fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA party TO fsw_readonly;
  END IF;
END;
$$;
