-- The search projection and data quality (ADR-0013, ADR-0014, spec §44).
--
-- pim.variant_facet is a FIXED-SCHEMA, denormalized projection of the resolved
-- effective attribute value for each variant -- inheritance already applied. It is
-- written in the SAME TRANSACTION as the canonical change, so a product committed
-- through the API is filterable immediately (acceptance criterion 5), and it is fully
-- rebuildable from pim.attribute_value at any time.
--
-- No DDL is generated at runtime. Defining a new attribute inserts metadata rows and
-- then facet rows. It never creates a column, an index or a view.

CREATE TABLE pim.variant_facet (
  variant_id        uuid NOT NULL REFERENCES pim.variant (id) ON DELETE CASCADE,
  attribute_key     kernel.machine_key NOT NULL REFERENCES pim.attribute (key),
  ordinal           smallint NOT NULL DEFAULT 0,

  -- Which typed column carries the value. Kept explicit so a query planner hint and a
  -- human reading a row both know what they are looking at.
  value_kind        text NOT NULL
    CHECK (value_kind IN ('NUMBER','RANGE','TERM','BOOLEAN','TEXT','ENTITY')),

  -- Quantities are stored as NORMALIZED BASE values, so a filter expressed in PSI
  -- matches a value entered in bar (ADR-0015).
  num_value         numeric,
  num_min           numeric,
  num_max           numeric,
  term_id           uuid REFERENCES pim.vocabulary_term (id),
  bool_value        boolean,
  text_value        text,
  entity_id         uuid,

  -- Where the effective value came from, so the API can return the resolved value
  -- together with its provenance (spec §27).
  source_level      text NOT NULL CHECK (source_level IN ('LINE','FAMILY','PRODUCT','VARIANT')),
  attribute_value_id uuid NOT NULL REFERENCES pim.attribute_value (id) ON DELETE CASCADE,

  PRIMARY KEY (variant_id, attribute_key, ordinal),

  CONSTRAINT facet_value_populated CHECK (
       (value_kind = 'NUMBER'  AND num_value IS NOT NULL)
    OR (value_kind = 'RANGE'   AND num_min IS NOT NULL AND num_max IS NOT NULL)
    OR (value_kind = 'TERM'    AND term_id IS NOT NULL)
    OR (value_kind = 'BOOLEAN' AND bool_value IS NOT NULL)
    OR (value_kind = 'TEXT'    AND text_value IS NOT NULL)
    OR (value_kind = 'ENTITY'  AND entity_id IS NOT NULL))
);

-- The indexes the filter engine intersects across. One per value kind, each leading
-- with attribute_key because every criterion names an attribute.
CREATE INDEX variant_facet_term_idx
  ON pim.variant_facet (attribute_key, term_id) INCLUDE (variant_id)
  WHERE term_id IS NOT NULL;
CREATE INDEX variant_facet_number_idx
  ON pim.variant_facet (attribute_key, num_value) INCLUDE (variant_id)
  WHERE num_value IS NOT NULL;
CREATE INDEX variant_facet_range_idx
  ON pim.variant_facet (attribute_key, num_min, num_max) INCLUDE (variant_id)
  WHERE num_min IS NOT NULL;
CREATE INDEX variant_facet_boolean_idx
  ON pim.variant_facet (attribute_key, bool_value) INCLUDE (variant_id)
  WHERE bool_value IS NOT NULL;
CREATE INDEX variant_facet_text_idx
  ON pim.variant_facet USING gin (text_value gin_trgm_ops)
  WHERE text_value IS NOT NULL;
CREATE INDEX variant_facet_source_idx ON pim.variant_facet (attribute_value_id);

COMMENT ON TABLE pim.variant_facet IS
  'Synchronous, fixed-schema search projection holding the resolved effective value '
  'after inheritance. Derived and rebuildable: the canonical answer always comes from '
  'pim.attribute_value, so a bug here costs performance, never correctness (ADR-0013).';
COMMENT ON COLUMN pim.variant_facet.num_value IS
  'Normalized base value for quantities -- pascals, kelvin, metres -- not the value as '
  'entered. This is what makes a PSI range query match a value entered in bar.';

-- ---------------------------------------------------------------------------
-- Data quality (spec §44). Rules are configuration; findings are computed.
-- ---------------------------------------------------------------------------
CREATE TABLE pim.channel (
  code        kernel.code_key PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  operating_company kernel.code_key REFERENCES kernel.operating_company (code),
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pim.channel (code, name, description, operating_company) VALUES
  ('VALVEMAN', 'ValveMan.com storefront',
   'Public ecommerce storefront. Requires enough content and imagery to publish.',
   'VALVEMAN'),
  ('WELSFORD_QUOTE', 'Welsford quotation',
   'Engineering and quotation use. Requires technical completeness, not merchandising.',
   'WELSFORD'),
  ('INTERNAL', 'Internal',
   'Baseline completeness every product should meet regardless of channel.', 'FSW_GROUP');

CREATE TABLE pim.quality_rule (
  key              kernel.machine_key PRIMARY KEY,
  name             text NOT NULL,
  description      text NOT NULL,
  channel_code     kernel.code_key REFERENCES pim.channel (code),
  product_type_key kernel.machine_key REFERENCES pim.product_type (key),
  severity         text NOT NULL CHECK (severity IN ('BLOCKING','WARNING')),
  rule_kind        text NOT NULL CHECK (rule_kind IN (
                     'REQUIRED_ATTRIBUTES','CONDITIONAL_ATTRIBUTES','INVALID_COMBINATION',
                     'MISSING_IDENTIFIER','NUMERIC_RANGE','MISSING_ASSET','MISSING_CERTIFICATION')),
  -- Rule parameters, shaped by rule_kind and validated by the metadata loader.
  parameters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Applicability predicate in the FSW condition DSL, same language as
  -- product_type_attribute.condition.
  applies_when     jsonb,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE pim.quality_rule IS
  'Configurable completeness and validity rules. A BLOCKING failure excludes a variant '
  'from the channel publishable view; a WARNING is visible but not disqualifying.';

CREATE TABLE pim.variant_quality (
  variant_id      uuid NOT NULL REFERENCES pim.variant (id) ON DELETE CASCADE,
  channel_code    kernel.code_key NOT NULL REFERENCES pim.channel (code),
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  is_publishable  boolean NOT NULL,
  blocking_count  integer NOT NULL DEFAULT 0,
  warning_count   integer NOT NULL DEFAULT 0,
  -- Share of applicable required and recommended attributes that have a value.
  completeness    numeric(5,4) NOT NULL DEFAULT 0
    CHECK (completeness >= 0 AND completeness <= 1),
  PRIMARY KEY (variant_id, channel_code)
);
CREATE INDEX variant_quality_publishable_idx
  ON pim.variant_quality (channel_code, is_publishable);
CREATE INDEX variant_quality_incomplete_idx
  ON pim.variant_quality (channel_code, completeness) WHERE NOT is_publishable;

CREATE TABLE pim.variant_quality_finding (
  id             uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  variant_id     uuid NOT NULL REFERENCES pim.variant (id) ON DELETE CASCADE,
  channel_code   kernel.code_key NOT NULL REFERENCES pim.channel (code),
  rule_key       kernel.machine_key NOT NULL REFERENCES pim.quality_rule (key),
  severity       text NOT NULL CHECK (severity IN ('BLOCKING','WARNING')),
  attribute_key  kernel.machine_key REFERENCES pim.attribute (key),
  -- Plain-language explanation, including why a conditional rule applied.
  message        text NOT NULL,
  evaluated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variant_quality_finding_variant_idx
  ON pim.variant_quality_finding (variant_id, channel_code);
CREATE INDEX variant_quality_finding_rule_idx
  ON pim.variant_quality_finding (rule_key, severity);
CREATE INDEX variant_quality_finding_attribute_idx
  ON pim.variant_quality_finding (attribute_key) WHERE attribute_key IS NOT NULL;

COMMENT ON TABLE pim.variant_quality_finding IS
  'Why a variant is incomplete, in enough detail to act on: which rule, which '
  'attribute, and a message that says what is missing and why it was required.';

-- The publishable view the storefront and quotation tooling read. A variant failing a
-- blocking rule is absent from it -- not flagged within it (acceptance criterion 22).
CREATE VIEW pim.publishable_variant AS
SELECT q.channel_code,
       v.id AS variant_id,
       v.product_id,
       v.manufacturer_part_number,
       q.completeness,
       q.warning_count,
       q.evaluated_at
  FROM pim.variant v
  JOIN pim.variant_quality q ON q.variant_id = v.id
 WHERE v.deleted_at IS NULL
   AND q.is_publishable;

COMMENT ON VIEW pim.publishable_variant IS
  'Variants that pass every blocking rule for a channel. Excluded means excluded: a '
  'product missing a required Cv does not appear here (spec §44).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pim TO fsw_app;
    GRANT SELECT ON pim.publishable_variant TO fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA pim TO fsw_readonly;
    GRANT SELECT ON pim.publishable_variant TO fsw_readonly;
  END IF;
END;
$$;
