-- The attribute type system and product types (ADR-0013, ADR-0016, ADR-0017).
--
-- Attributes and product types are DATA. Creating a new product type or a new
-- attribute inserts rows here; it never creates a column, an index, a view, or a
-- migration. That is what makes acceptance criterion 3 achievable without runtime DDL.

CREATE TABLE pim.attribute (
  id                 uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  key                kernel.machine_key NOT NULL UNIQUE,
  name               text NOT NULL,
  description        text NOT NULL,

  value_type         text NOT NULL CHECK (value_type IN (
                       'TEXT','BOOLEAN','INTEGER','DECIMAL','DATE',
                       'QUANTITY','QUANTITY_RANGE',
                       'ENUM','NOMINAL_SIZE','PRESSURE_CLASS','ENTITY_REF')),

  -- Required for QUANTITY / QUANTITY_RANGE, forbidden otherwise.
  dimension_code     kernel.code_key REFERENCES pim.quantity_dimension (code),
  default_unit_code  text REFERENCES pim.unit (code),

  -- Required for ENUM / NOMINAL_SIZE / PRESSURE_CLASS, forbidden otherwise.
  vocabulary_key     kernel.machine_key,

  -- Required for ENTITY_REF, forbidden otherwise.
  entity_type        text,

  cardinality        text NOT NULL DEFAULT 'SINGLE'
                       CHECK (cardinality IN ('SINGLE','MULTI')),

  numeric_scale      integer CHECK (numeric_scale IS NULL OR numeric_scale BETWEEN 0 AND 12),
  min_numeric        numeric,
  max_numeric        numeric,
  min_length         integer CHECK (min_length IS NULL OR min_length >= 0),
  max_length         integer CHECK (max_length IS NULL OR max_length > 0),

  is_filterable      boolean NOT NULL DEFAULT true,
  is_comparable      boolean NOT NULL DEFAULT true,
  -- Channels that care about this attribute. Empty means all.
  channels           text[] NOT NULL DEFAULT '{}',

  deprecated_at      timestamptz,
  superseded_by_key  kernel.machine_key REFERENCES pim.attribute (key),
  definition_version integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- The value type determines exactly which companion columns must be present.
  -- The database, not the application, guarantees an attribute is coherent.
  CONSTRAINT quantity_requires_dimension CHECK (
    (value_type IN ('QUANTITY','QUANTITY_RANGE')) = (dimension_code IS NOT NULL)),
  CONSTRAINT enumerated_requires_vocabulary CHECK (
    (value_type IN ('ENUM','NOMINAL_SIZE','PRESSURE_CLASS')) = (vocabulary_key IS NOT NULL)),
  CONSTRAINT entity_ref_requires_entity_type CHECK (
    (value_type = 'ENTITY_REF') = (entity_type IS NOT NULL)),
  CONSTRAINT default_unit_only_for_quantity CHECK (
    default_unit_code IS NULL OR value_type IN ('QUANTITY','QUANTITY_RANGE')),
  CONSTRAINT numeric_bounds_ordered CHECK (
    min_numeric IS NULL OR max_numeric IS NULL OR min_numeric <= max_numeric),
  CONSTRAINT length_bounds_ordered CHECK (
    min_length IS NULL OR max_length IS NULL OR min_length <= max_length),

  -- A NOMINAL_SIZE attribute must point at a nominal-size vocabulary and a
  -- PRESSURE_CLASS attribute at a pressure-class vocabulary. Enforced by a composite
  -- foreign key against the generated column below (ADR-0016).
  required_designation_kind text GENERATED ALWAYS AS (
    CASE value_type
      WHEN 'NOMINAL_SIZE'   THEN 'NOMINAL_SIZE'
      WHEN 'PRESSURE_CLASS' THEN 'PRESSURE_CLASS'
      ELSE NULL
    END) STORED,
  FOREIGN KEY (vocabulary_key, required_designation_kind)
    REFERENCES pim.vocabulary (key, designation_kind)
);

CREATE INDEX attribute_value_type_idx ON pim.attribute (value_type);
CREATE INDEX attribute_active_idx ON pim.attribute (key) WHERE deprecated_at IS NULL;

COMMENT ON TABLE pim.attribute IS
  'Attribute definitions. Metadata, loaded from version-controlled configuration '
  '(ADR-0017). Adding one requires no code change and no migration.';
COMMENT ON COLUMN pim.attribute.value_type IS
  'NOMINAL_SIZE and PRESSURE_CLASS are deliberately distinct from ENUM and from '
  'QUANTITY. Making them their own value types is what makes it structurally '
  'impossible for Class 150 to be stored as, or compared against, 150 PSI (ADR-0016).';
COMMENT ON COLUMN pim.attribute.superseded_by_key IS
  'Attributes are deprecated and superseded, never deleted: values already recorded '
  'against them remain meaningful.';

-- The ENUM case must NOT point at a designation vocabulary. That direction cannot be
-- expressed as a foreign key, so the metadata loader enforces it and
-- tests/pim/engineering-semantics.test.ts proves it.

-- ---------------------------------------------------------------------------
-- Product types (spec §23)
-- ---------------------------------------------------------------------------
CREATE TABLE pim.product_type (
  id            uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  key           kernel.machine_key NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text NOT NULL,
  parent_key    kernel.machine_key REFERENCES pim.product_type (key),
  -- Mapping to an external taxonomy. ETIM is a mapping vocabulary, never the master
  -- of FSW's domain (spec §33).
  etim_class    text,
  etim_release  text,
  deprecated_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_type_not_own_parent CHECK (parent_key IS DISTINCT FROM key),
  CONSTRAINT etim_class_needs_release CHECK (etim_class IS NULL OR etim_release IS NOT NULL)
);
CREATE INDEX product_type_parent_idx ON pim.product_type (parent_key);

COMMENT ON TABLE pim.product_type IS
  'Ball valve, butterfly valve, control valve, regulator, steam trap, pressure '
  'instrument, and so on. Hierarchical: a ball valve is a valve, and inherits the '
  'attribute applicability rules of its ancestors.';

CREATE OR REPLACE FUNCTION pim.assert_product_type_acyclic()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cursor_key text := NEW.parent_key;
  hops integer := 0;
BEGIN
  WHILE cursor_key IS NOT NULL LOOP
    IF cursor_key = NEW.key THEN
      RAISE EXCEPTION 'product type % would create a cycle in its hierarchy', NEW.key
        USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 32 THEN
      RAISE EXCEPTION 'product type hierarchy deeper than 32 levels; refusing'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_key INTO cursor_key FROM pim.product_type WHERE key = cursor_key;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER product_type_acyclic
  AFTER INSERT OR UPDATE OF parent_key ON pim.product_type
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION pim.assert_product_type_acyclic();

-- ---------------------------------------------------------------------------
-- Which attributes apply to which product types, and when (spec §26)
-- ---------------------------------------------------------------------------
CREATE TABLE pim.product_type_attribute (
  id               uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  product_type_key kernel.machine_key NOT NULL REFERENCES pim.product_type (key) ON DELETE CASCADE,
  attribute_key    kernel.machine_key NOT NULL REFERENCES pim.attribute (key),
  requirement      text NOT NULL DEFAULT 'OPTIONAL'
                     CHECK (requirement IN ('REQUIRED','RECOMMENDED','OPTIONAL')),
  -- Where in the hierarchy a value for this attribute is expected to be set.
  level            text NOT NULL DEFAULT 'ANY'
                     CHECK (level IN ('LINE','FAMILY','PRODUCT','VARIANT','ANY')),
  sort_order       integer NOT NULL DEFAULT 100,
  -- Conditional applicability, as a small declarative predicate. Never executable
  -- code: a limited, versioned, testable DSL evaluated in the application
  -- (spec §26). Example:
  --   {"all": [{"attr": "actuation_type", "op": "eq", "value": "ELECTRIC"}]}
  condition        jsonb,
  condition_note   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_type_attribute_unique UNIQUE (product_type_key, attribute_key),
  CONSTRAINT conditional_requires_note CHECK (condition IS NULL OR condition_note IS NOT NULL)
);
CREATE INDEX product_type_attribute_type_idx
  ON pim.product_type_attribute (product_type_key, sort_order);

COMMENT ON COLUMN pim.product_type_attribute.condition IS
  'Applicability predicate in the FSW rule DSL. If actuation is electric, voltage '
  'becomes applicable; if pneumatic, supply pressure does. Data, not code.';

-- ---------------------------------------------------------------------------
-- Metadata versioning (ADR-0017)
-- ---------------------------------------------------------------------------
CREATE TABLE pim.metadata_version (
  id            uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  applied_at    timestamptz NOT NULL DEFAULT now(),
  applied_by    text NOT NULL,
  -- SHA-256 over the sorted, normalized configuration files.
  content_hash  text NOT NULL,
  file_count    integer NOT NULL,
  summary       jsonb NOT NULL,
  note          text
);
CREATE INDEX metadata_version_applied_idx ON pim.metadata_version (applied_at DESC);
COMMENT ON TABLE pim.metadata_version IS
  'Each application of config/metadata/**. An attribute value can be traced to the '
  'metadata version in force when it was written.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pim TO fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA pim TO fsw_readonly;
  END IF;
END;
$$;
