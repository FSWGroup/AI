-- Field-level provenance and survivorship (ADR-0011, spec §11, §51).
--
-- The rule this schema exists to enforce: a canonical field value is the materialized
-- output of a deterministic function over candidate values. It is never authored.
--
-- That is not a stylistic preference. Reversible merge (§50, acceptance criterion 9)
-- is only achievable if canonical values are derived: if merging B into A overwrote
-- A's columns, unmerging would mean reconstructing A from audit logs, which the
-- specification explicitly forbids as an implementation of unmerge.
--
-- The consequence that must be stated plainly, because it surprises people: a human
-- editing a value in the admin UI does NOT update the canonical row. It writes a
-- candidate attributed to the MANUAL source, with an actor and a reason. Survivorship
-- then runs. MANUAL normally has the highest priority, so the human's value normally
-- wins -- but it wins through the same mechanism as every other source.

-- ---------------------------------------------------------------------------
-- The mastered-field registry
--
-- One declaration of which columns are survivorship outputs, what type they hold, and
-- whether they are personal data. The survivorship engine reads this rather than
-- carrying a hand-maintained list, and the admin UI reads it to know which fields to
-- show provenance for.
--
-- This is structural, so it lives in a migration rather than in the metadata
-- configuration (ADR-0017): unlike a product attribute, adding a mastered field means
-- adding a column, and adding a column is a migration by definition.
-- ---------------------------------------------------------------------------
CREATE TABLE party.mastered_field (
  entity_type   text NOT NULL
    CHECK (entity_type IN ('ORGANIZATION','SITE','LOCATION','PERSON')),
  field_key     kernel.machine_key NOT NULL,
  -- The column this field materializes into. Validated against the catalogue below,
  -- so a typo fails the migration rather than at three in the morning.
  column_name   text NOT NULL,
  value_type    text NOT NULL
    CHECK (value_type IN ('TEXT','ENUM','UUID_REF','DATE','BOOLEAN','NUMERIC')),
  -- Drives audit redaction and erasure (ADR-0021, ADR-0027).
  classification text NOT NULL DEFAULT 'PUBLIC'
    CHECK (classification IN ('PUBLIC','INTERNAL','PII','SECRET')),
  description   text NOT NULL,
  -- False where a field is deliberately not mastered from sources: identity columns,
  -- merge bookkeeping, row versions.
  is_mastered   boolean NOT NULL DEFAULT true,
  sort_ordinal  integer NOT NULL DEFAULT 100,

  PRIMARY KEY (entity_type, field_key)
);
COMMENT ON TABLE party.mastered_field IS
  'Which columns are survivorship outputs. The engine builds its UPDATE from this '
  'registry, so there is exactly one place that says a field is mastered.';

INSERT INTO party.mastered_field
  (entity_type, field_key, column_name, value_type, classification, description, sort_ordinal) VALUES
  ('ORGANIZATION','legal_name','legal_name','TEXT','PUBLIC','The registered or trading legal name.',10),
  ('ORGANIZATION','trade_name','trade_name','TEXT','PUBLIC','What the company calls itself, where it differs from the legal name.',20),
  ('ORGANIZATION','website_url','website_url','TEXT','PUBLIC','Primary web presence. A strong matching signal, so worth mastering carefully.',30),
  ('ORGANIZATION','main_phone','main_phone','TEXT','INTERNAL','Switchboard number.',40),
  ('ORGANIZATION','tax_identifier','tax_identifier','TEXT','SECRET','EIN or equivalent. Redacted from audit records and never returned by default.',50),
  ('ORGANIZATION','duns_number','duns_number','TEXT','INTERNAL','Dun & Bradstreet identifier, where a source supplies one.',60),
  ('ORGANIZATION','naics_code','naics_code','TEXT','PUBLIC','Industry classification.',70),
  ('ORGANIZATION','organization_type','organization_type','ENUM','PUBLIC','Company, municipality, utility, institution.',80),
  ('ORGANIZATION','primary_location_id','primary_location_id','UUID_REF','PUBLIC','The address a source treats as the main one.',90),
  ('SITE','name','name','TEXT','PUBLIC','What the facility is called.',10),
  ('SITE','site_type','site_type','ENUM','PUBLIC','Plant, refinery, treatment works, headquarters.',20),
  ('SITE','industry_note','industry_note','TEXT','PUBLIC','What the facility does. Free text: a controlled vocabulary here would be guessed.',30),
  ('SITE','location_id','location_id','UUID_REF','PUBLIC','Where the facility is.',40),
  ('LOCATION','line1','line1','TEXT','PUBLIC','First address line, normalized.',10),
  ('LOCATION','line2','line2','TEXT','PUBLIC','Second address line, normalized.',20),
  ('LOCATION','city','city','TEXT','PUBLIC','City, normalized.',30),
  ('LOCATION','region_code','region_code','TEXT','PUBLIC','State or province code.',40),
  ('LOCATION','postal_code','postal_code','TEXT','PUBLIC','Postal code as the source gives it.',50),
  ('LOCATION','country_code','country_code','TEXT','PUBLIC','ISO 3166-1 alpha-2.',60),
  ('PERSON','given_name','given_name','TEXT','PII','First name.',10),
  ('PERSON','family_name','family_name','TEXT','PII','Last name.',20),
  ('PERSON','display_name','display_name','TEXT','PII','What the person is actually called.',30),
  ('PERSON','job_title','job_title','TEXT','PII','Title as a source states it. Changes often and disagrees often.',40),
  ('PERSON','email','email','TEXT','PII','Primary email address.',50),
  ('PERSON','phone','phone','TEXT','PII','Primary telephone number.',60),
  ('PERSON','mobile_phone','mobile_phone','TEXT','PII','Mobile number.',70),
  ('PERSON','linkedin_url','linkedin_url','TEXT','PII','LinkedIn profile, where a source supplies one.',80);

-- Every registered field must name a column that actually exists, with the right
-- table. A typo here would otherwise surface as a runtime failure in the engine.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(format('%s.%s', f.entity_type, f.column_name), ', ')
    INTO missing
    FROM party.mastered_field f
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'party'
        AND c.table_name = lower(f.entity_type)
        AND c.column_name = f.column_name
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'party.mastered_field names columns that do not exist: %', missing;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Candidate values
--
-- One row per (entity, field, source record): what that source asserts, plus enough
-- provenance to answer "why does this field have this value" without interpretation.
--
-- One table rather than four near-identical ones, because the survivorship engine is
-- genuinely generic and four tables would mean four code paths or dynamic table names.
-- Referential integrity is not given up to get that: the generated columns below carry
-- a real foreign key per entity type, so a candidate cannot point at an entity that
-- does not exist.
-- ---------------------------------------------------------------------------
CREATE TABLE party.field_candidate (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),

  entity_type       text NOT NULL
    CHECK (entity_type IN ('ORGANIZATION','SITE','LOCATION','PERSON')),
  entity_id         uuid NOT NULL,
  field_key         kernel.machine_key NOT NULL,

  -- Real foreign keys, one per entity type, from a stored generated column. The FK is
  -- enforced only for rows of that type, because the expression is NULL otherwise.
  organization_id   uuid GENERATED ALWAYS AS
    (CASE WHEN entity_type = 'ORGANIZATION' THEN entity_id END) STORED
    REFERENCES party.organization (id) ON DELETE CASCADE,
  site_id           uuid GENERATED ALWAYS AS
    (CASE WHEN entity_type = 'SITE' THEN entity_id END) STORED
    REFERENCES party.site (id) ON DELETE CASCADE,
  location_id       uuid GENERATED ALWAYS AS
    (CASE WHEN entity_type = 'LOCATION' THEN entity_id END) STORED
    REFERENCES party.location (id) ON DELETE CASCADE,
  person_id         uuid GENERATED ALWAYS AS
    (CASE WHEN entity_type = 'PERSON' THEN entity_id END) STORED
    REFERENCES party.person (id) ON DELETE CASCADE,

  -- The asserted value. Text is the transport for every scalar type; the registry
  -- says how to interpret it, and the engine casts on the way into the column so a
  -- bad value fails there rather than being stored as a plausible-looking string.
  value_text        text,
  -- True where the source POSITIVELY asserts absence, which is not the same as the
  -- source having nothing to say. A CRM that clears a field is making a claim.
  asserts_absence   boolean NOT NULL DEFAULT false,

  source_system_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  source_record_id   uuid REFERENCES ingest.source_record (id),
  -- What the source calls this field, for the provenance display.
  source_field       text,
  source_updated_at  timestamptz,
  ingested_at        timestamptz NOT NULL DEFAULT now(),

  -- 0 to 1. A parsed or inferred value is not as good as a stated one, and a
  -- survivorship rule can be told to care.
  confidence        numeric(5,4) NOT NULL DEFAULT 1.0
    CHECK (confidence BETWEEN 0 AND 1),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','VERIFIED','DISPUTED','REJECTED')),
  verified_at       timestamptz,
  verified_by       uuid,

  -- Filled by evaluation. The reason is written for a person reading a provenance
  -- panel, not for a log.
  is_selected       boolean NOT NULL DEFAULT false,
  selected_reason   text,
  evaluated_at      timestamptz,
  rule_version      integer,

  -- Present on a MANUAL candidate: who asserted it and why.
  actor_principal_id uuid,
  reason            text,

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT absence_has_no_value CHECK (NOT asserts_absence OR value_text IS NULL),
  CONSTRAINT selected_has_reason CHECK (NOT is_selected OR selected_reason IS NOT NULL),
  CONSTRAINT verification_has_stamp CHECK (
    verification_status <> 'VERIFIED' OR verified_at IS NOT NULL)
);

-- A source record asserts a given field once. A second payload from the same source
-- record SUPERSEDES rather than accumulates: the full history of what that source said
-- is already in ingest.source_record_version, and duplicating it here would make the
-- candidate table grow without adding evidence (ADR-0011).
CREATE UNIQUE INDEX field_candidate_identity_idx ON party.field_candidate (
  entity_type, entity_id, field_key, source_system_code,
  coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(source_field, '')
);

-- At most one winner per field. Enforced by the database, so a bug in the engine
-- cannot leave two selected values that a provenance panel would show side by side.
CREATE UNIQUE INDEX field_candidate_selected_idx
  ON party.field_candidate (entity_type, entity_id, field_key) WHERE is_selected;

CREATE INDEX field_candidate_entity_idx
  ON party.field_candidate (entity_type, entity_id, field_key);
CREATE INDEX field_candidate_source_idx
  ON party.field_candidate (source_record_id) WHERE source_record_id IS NOT NULL;

COMMENT ON TABLE party.field_candidate IS
  'What each source says a field is. "Why does this field have this value" is a single '
  'SELECT here ordered by is_selected, with no interpretation (ADR-0011).';
COMMENT ON COLUMN party.field_candidate.asserts_absence IS
  'The source positively says there is no value, which is different from the source '
  'being silent. A CRM that clears a phone number is making a claim about the world.';

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
CREATE TABLE party.survivorship_rule (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  entity_type       text NOT NULL
    CHECK (entity_type IN ('ORGANIZATION','SITE','LOCATION','PERSON')),
  -- NULL means "the default for this entity type". A field with no specific rule uses
  -- it, so there is always exactly one rule in force and never an implicit one.
  field_key         kernel.machine_key,

  strategy          text NOT NULL DEFAULT 'PRIORITY_THEN_RECENCY'
    CHECK (strategy IN ('PRIORITY','RECENCY','PRIORITY_THEN_RECENCY','MOST_COMPLETE')),
  -- A verified value beats an unverified one from a higher-priority source. This is
  -- usually right and occasionally wrong, so it is configuration.
  prefer_verified   boolean NOT NULL DEFAULT true,
  -- Whether a source asserting absence can win. Usually false: a CRM with an empty
  -- phone field should not blank a number the ERP has.
  allow_absence_to_win boolean NOT NULL DEFAULT false,
  -- A candidate below this confidence never wins, whatever its source priority.
  min_confidence    numeric(5,4) NOT NULL DEFAULT 0
    CHECK (min_confidence BETWEEN 0 AND 1),
  -- Ordered, most-preferred first. Sources not listed fall back to the registry's
  -- default_priority, so adding a source does not require editing every rule.
  source_priority   kernel.code_key[] NOT NULL DEFAULT '{}',

  -- Bumped whenever the rule changes meaning. Recorded on every selection, so a value
  -- can be traced to the rule that chose it.
  version           integer NOT NULL DEFAULT 1,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);
CREATE UNIQUE INDEX survivorship_rule_scope_idx
  ON party.survivorship_rule (entity_type, coalesce(field_key, '*'));

COMMENT ON TABLE party.survivorship_rule IS
  'How a winner is chosen. Re-evaluation is first-class: changing a rule and re-running '
  'produces a new selection with a new reason, and destroys no candidate (ADR-0011).';

INSERT INTO party.survivorship_rule (entity_type, field_key, strategy, source_priority, note) VALUES
  ('ORGANIZATION', NULL, 'PRIORITY_THEN_RECENCY',
   ARRAY['MANUAL','P21','PIPEDRIVE','VALVEMAN_STORE','MFR_CATALOG']::kernel.code_key[],
   'Default for organizations. The ERP outranks the CRM: an accounting system is kept accurate because invoices depend on it.'),
  ('ORGANIZATION', 'website_url', 'PRIORITY_THEN_RECENCY',
   ARRAY['MANUAL','PIPEDRIVE','P21','VALVEMAN_STORE']::kernel.code_key[],
   'The CRM outranks the ERP here: salespeople keep websites current and an ERP has no reason to.'),
  ('SITE', NULL, 'PRIORITY_THEN_RECENCY',
   ARRAY['MANUAL','P21','PIPEDRIVE']::kernel.code_key[], 'Default for sites.'),
  ('LOCATION', NULL, 'PRIORITY_THEN_RECENCY',
   ARRAY['MANUAL','P21','PIPEDRIVE','VALVEMAN_STORE']::kernel.code_key[],
   'Default for locations. The ERP address is the one goods were actually shipped to.'),
  ('PERSON', NULL, 'PRIORITY_THEN_RECENCY',
   ARRAY['MANUAL','PIPEDRIVE','P21','VALVEMAN_STORE']::kernel.code_key[],
   'Default for people. The CRM outranks the ERP: contact data is what a CRM is for.');

-- ---------------------------------------------------------------------------
-- Field ownership (discovery question B2)
--
-- Distinct from priority, and the distinction matters. Priority says "prefer this
-- source". Ownership says "this source decides, and everyone else is recorded but
-- cannot win". A business that has agreed the ERP owns the legal name wants the
-- second, not a strong version of the first.
-- ---------------------------------------------------------------------------
CREATE TABLE party.field_ownership (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  entity_type       text NOT NULL
    CHECK (entity_type IN ('ORGANIZATION','SITE','LOCATION','PERSON')),
  field_key         kernel.machine_key NOT NULL,
  -- NULL where ownership is group-wide rather than per business.
  operating_company kernel.code_key REFERENCES kernel.operating_company (code),
  owning_source_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),

  -- When true, only the owning source can win. Other candidates are still recorded --
  -- nothing is discarded -- and the divergence view will show them.
  is_exclusive      boolean NOT NULL DEFAULT true,
  -- Whether a human may still override through MANUAL. Almost always yes; a genuinely
  -- system-of-record field may say no.
  allow_manual_override boolean NOT NULL DEFAULT true,

  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  effective_to      date,
  agreed_by         text,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ownership_dates_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX field_ownership_current_idx
  ON party.field_ownership (entity_type, field_key, coalesce(operating_company, '*'))
  WHERE effective_to IS NULL;

COMMENT ON TABLE party.field_ownership IS
  'Which source is authoritative for a field, as a business agreement rather than a '
  'preference. Empty until discovery question B2 is answered: inventing ownership '
  'nobody agreed to would be worse than having none (assumption A-009).';

-- ---------------------------------------------------------------------------
-- Divergence
--
-- What sources disagree about, which is the report that tells a data steward where
-- the real problems are. A view, because it is derived and must never be stale.
-- ---------------------------------------------------------------------------
CREATE VIEW party.field_divergence AS
SELECT
  c.entity_type,
  c.entity_id,
  c.field_key,
  count(*) AS candidate_count,
  -- count(DISTINCT ...) ignores NULLs, and here a NULL means a source positively
  -- asserting absence -- which is one of the values sources can disagree about. It is
  -- counted explicitly rather than folded in with a sentinel string, because any
  -- sentinel is a value some source could one day legitimately assert.
  count(DISTINCT c.value_text)
    + (CASE WHEN bool_or(c.value_text IS NULL) THEN 1 ELSE 0 END) AS distinct_value_count,
  max(c.value_text) FILTER (WHERE c.is_selected)      AS selected_value,
  max(c.source_system_code) FILTER (WHERE c.is_selected) AS selected_source,
  -- Cast to text: an array of a DOMAIN type has its own type OID, which client
  -- drivers do not recognise and hand back as the raw literal '{P21,PIPEDRIVE}'.
  array_agg(DISTINCT c.source_system_code::text ORDER BY c.source_system_code::text) AS sources,
  bool_or(c.verification_status = 'DISPUTED')         AS has_dispute,
  max(c.ingested_at)                                  AS last_ingested_at
FROM party.field_candidate c
GROUP BY c.entity_type, c.entity_id, c.field_key
HAVING count(DISTINCT c.value_text)
         + (CASE WHEN bool_or(c.value_text IS NULL) THEN 1 ELSE 0 END) > 1;

COMMENT ON VIEW party.field_divergence IS
  'Fields where sources assert different values. Divergence is normal and is not an '
  'error; this is the queue a data steward works, not an alert.';

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
