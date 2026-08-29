-- Canonical attribute values: typed EAV (ADR-0013).
--
-- One table, one row per (owner, attribute, ordinal, candidate). Values live in TYPED
-- columns chosen by the attribute's declared value type, with the database -- not the
-- application -- guaranteeing that:
--
--   * a QUANTITY cannot hold a term, and a PRESSURE_CLASS cannot hold a number
--     (this is the enforcement behind acceptance criterion 7)
--   * an enumerated value's term belongs to the attribute's own vocabulary
--   * a quantity's unit measures the attribute's own dimension
--   * a single-cardinality attribute has at most one selected value at any point in
--     valid time
--
-- Every one of those is a composite foreign key or an exclusion constraint rather than
-- application code, because application code can be bypassed and constraints cannot.

-- Targets for the composite foreign keys below. Each carries one attribute property
-- onto its value rows so a constraint can reference it.
ALTER TABLE pim.attribute
  ADD CONSTRAINT attribute_key_value_type UNIQUE (key, value_type),
  ADD CONSTRAINT attribute_key_vocabulary UNIQUE (key, vocabulary_key),
  ADD CONSTRAINT attribute_key_dimension  UNIQUE (key, dimension_code),
  ADD CONSTRAINT attribute_key_cardinality UNIQUE (key, cardinality);

ALTER TABLE pim.unit
  ADD CONSTRAINT unit_code_dimension UNIQUE (code, dimension_code);

CREATE TABLE pim.attribute_value (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  attribute_key     kernel.machine_key NOT NULL REFERENCES pim.attribute (key),

  -- The attribute's shape, carried here by cascading composite foreign keys so the
  -- CHECK constraints below can see it. Never set by hand; the writer copies it from
  -- the attribute definition and ON UPDATE CASCADE keeps it in step.
  value_type        text NOT NULL,
  cardinality       text NOT NULL,

  -- --- owner: exactly one of four, each a real foreign key -------------------
  product_line_id   uuid REFERENCES pim.product_line (id)   ON DELETE CASCADE,
  product_family_id uuid REFERENCES pim.product_family (id) ON DELETE CASCADE,
  product_id        uuid REFERENCES pim.product (id)        ON DELETE CASCADE,
  variant_id        uuid REFERENCES pim.variant (id)        ON DELETE CASCADE,

  owner_level       text GENERATED ALWAYS AS (
    CASE
      WHEN variant_id        IS NOT NULL THEN 'VARIANT'
      WHEN product_id        IS NOT NULL THEN 'PRODUCT'
      WHEN product_family_id IS NOT NULL THEN 'FAMILY'
      WHEN product_line_id   IS NOT NULL THEN 'LINE'
    END) STORED,
  owner_key         text GENERATED ALWAYS AS (
    coalesce(
      variant_id::text, product_id::text, product_family_id::text, product_line_id::text
    )) STORED,

  -- --- typed value columns ---------------------------------------------------
  value_text        text,
  value_boolean     boolean,
  value_numeric     numeric,
  value_date        date,

  value_term_id     uuid,
  -- Carried so the term can be constrained to the attribute's vocabulary.
  value_vocabulary_key kernel.machine_key,

  value_entity_id   uuid,
  value_entity_type text,

  -- Quantities keep what was entered AND the normalized base value (ADR-0015).
  value_qty_original      numeric,
  value_qty_original_unit text,
  value_qty_base          numeric,
  value_qty_dimension     kernel.code_key,
  -- QUANTITY_RANGE upper bound.
  value_qty_max_original  numeric,
  value_qty_max_base      numeric,

  -- Exactly what the source said, before any parsing or normalization.
  entered_raw       text,
  -- Position within a MULTI-valued attribute.
  ordinal           smallint NOT NULL DEFAULT 0,

  -- --- provenance (ADR-0011, spec §11) ---------------------------------------
  source_system_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  source_record_id   uuid,
  source_field       text,
  source_updated_at  timestamptz,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  confidence         numeric(3,2) NOT NULL DEFAULT 1.00
    CHECK (confidence >= 0 AND confidence <= 1),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','VERIFIED','DISPUTED','REJECTED')),
  verified_by        uuid,
  verified_at        timestamptz,
  metadata_version_id uuid REFERENCES pim.metadata_version (id),

  -- --- valid time (ADR-0018) --------------------------------------------------
  valid_from        date NOT NULL DEFAULT CURRENT_DATE,
  valid_to          date,
  validity          daterange GENERATED ALWAYS AS
    (daterange(valid_from, valid_to, '[)')) STORED,

  -- --- survivorship (ADR-0011) ------------------------------------------------
  is_selected       boolean NOT NULL DEFAULT false,
  selected_reason   text,
  selected_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT value_has_exactly_one_owner CHECK (
    (product_line_id   IS NOT NULL)::int
  + (product_family_id IS NOT NULL)::int
  + (product_id        IS NOT NULL)::int
  + (variant_id        IS NOT NULL)::int = 1),

  CONSTRAINT validity_ordered CHECK (valid_to IS NULL OR valid_from < valid_to),
  CONSTRAINT selection_has_reason CHECK (NOT is_selected OR selected_reason IS NOT NULL),
  CONSTRAINT verification_has_actor CHECK (
    verification_status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT single_cardinality_has_ordinal_zero CHECK (
    cardinality <> 'SINGLE' OR ordinal = 0),

  -- The value type must actually be populated.
  CONSTRAINT value_is_populated CHECK (
       (value_type = 'TEXT'           AND value_text IS NOT NULL)
    OR (value_type = 'BOOLEAN'        AND value_boolean IS NOT NULL)
    OR (value_type IN ('INTEGER','DECIMAL') AND value_numeric IS NOT NULL)
    OR (value_type = 'DATE'           AND value_date IS NOT NULL)
    OR (value_type IN ('ENUM','NOMINAL_SIZE','PRESSURE_CLASS')
        AND value_term_id IS NOT NULL AND value_vocabulary_key IS NOT NULL)
    OR (value_type = 'QUANTITY'
        AND value_qty_original IS NOT NULL AND value_qty_original_unit IS NOT NULL
        AND value_qty_base IS NOT NULL AND value_qty_dimension IS NOT NULL)
    OR (value_type = 'QUANTITY_RANGE'
        AND value_qty_base IS NOT NULL AND value_qty_max_base IS NOT NULL
        AND value_qty_original_unit IS NOT NULL AND value_qty_dimension IS NOT NULL)
    OR (value_type = 'ENTITY_REF'
        AND value_entity_id IS NOT NULL AND value_entity_type IS NOT NULL)),

  -- ...and no column belonging to a different type may be populated. This is the
  -- constraint that makes it structurally impossible for ASME Class 150 to be stored
  -- as, or compared against, a numeric pressure (ADR-0016, acceptance criterion 7).
  CONSTRAINT no_value_columns_from_other_types CHECK (
        (value_text     IS NULL OR value_type = 'TEXT')
    AND (value_boolean  IS NULL OR value_type = 'BOOLEAN')
    AND (value_numeric  IS NULL OR value_type IN ('INTEGER','DECIMAL'))
    AND (value_date     IS NULL OR value_type = 'DATE')
    AND (value_term_id  IS NULL OR value_type IN ('ENUM','NOMINAL_SIZE','PRESSURE_CLASS'))
    AND (value_qty_base IS NULL OR value_type IN ('QUANTITY','QUANTITY_RANGE'))
    AND (value_qty_original IS NULL OR value_type IN ('QUANTITY','QUANTITY_RANGE'))
    AND (value_qty_max_base IS NULL OR value_type = 'QUANTITY_RANGE')
    AND (value_entity_id IS NULL OR value_type = 'ENTITY_REF')),

  CONSTRAINT range_bounds_ordered CHECK (
    value_qty_max_base IS NULL OR value_qty_base IS NULL
    OR value_qty_base <= value_qty_max_base),

  -- The attribute's declared shape must match what is stored.
  FOREIGN KEY (attribute_key, value_type)
    REFERENCES pim.attribute (key, value_type) ON UPDATE CASCADE,
  FOREIGN KEY (attribute_key, cardinality)
    REFERENCES pim.attribute (key, cardinality) ON UPDATE CASCADE,
  -- An enumerated value's term must belong to the attribute's own vocabulary.
  FOREIGN KEY (attribute_key, value_vocabulary_key)
    REFERENCES pim.attribute (key, vocabulary_key) ON UPDATE CASCADE,
  FOREIGN KEY (value_term_id, value_vocabulary_key)
    REFERENCES pim.vocabulary_term (id, vocabulary_key),
  -- A quantity's dimension must be the attribute's own dimension...
  FOREIGN KEY (attribute_key, value_qty_dimension)
    REFERENCES pim.attribute (key, dimension_code) ON UPDATE CASCADE,
  -- ...and its unit must measure that dimension.
  FOREIGN KEY (value_qty_original_unit, value_qty_dimension)
    REFERENCES pim.unit (code, dimension_code) ON UPDATE CASCADE
);

CREATE INDEX attribute_value_variant_idx ON pim.attribute_value (variant_id, attribute_key)
  WHERE variant_id IS NOT NULL;
CREATE INDEX attribute_value_product_idx ON pim.attribute_value (product_id, attribute_key)
  WHERE product_id IS NOT NULL;
CREATE INDEX attribute_value_family_idx ON pim.attribute_value (product_family_id, attribute_key)
  WHERE product_family_id IS NOT NULL;
CREATE INDEX attribute_value_line_idx ON pim.attribute_value (product_line_id, attribute_key)
  WHERE product_line_id IS NOT NULL;
CREATE INDEX attribute_value_attribute_idx ON pim.attribute_value (attribute_key);
CREATE INDEX attribute_value_source_idx
  ON pim.attribute_value (source_system_code, source_record_id)
  WHERE source_record_id IS NOT NULL;
CREATE INDEX attribute_value_selected_idx
  ON pim.attribute_value (owner_key, attribute_key) WHERE is_selected;

-- At most one selected value per (owner, attribute, ordinal) at any point in valid
-- time. Not an application rule: the database physically cannot hold two.
ALTER TABLE pim.attribute_value
  ADD CONSTRAINT one_selected_value_per_period
  EXCLUDE USING gist (
    owner_key WITH =,
    attribute_key WITH =,
    ordinal WITH =,
    validity WITH &&
  ) WHERE (is_selected);

COMMENT ON TABLE pim.attribute_value IS
  'Canonical attribute values, and simultaneously the candidate values survivorship '
  'chooses between (ADR-0011). Losing candidates are never destroyed: is_selected '
  'marks the survivor, selected_reason says why it won, and every other row remains '
  'queryable evidence of what each source asserted.';
COMMENT ON COLUMN pim.attribute_value.entered_raw IS
  'Exactly what the source said, before parsing or normalization. Never overwritten.';
COMMENT ON COLUMN pim.attribute_value.value_qty_original IS
  'The value as entered, in the unit it was entered in. Comparison and filtering use '
  'value_qty_base; display defaults to this.';
COMMENT ON COLUMN pim.attribute_value.value_type IS
  'Denormalized from pim.attribute by a cascading composite foreign key, so the CHECK '
  'constraints above can enforce type coherence. Changing an attribute value type '
  'cascades here, which is why the metadata loader refuses that change while values '
  'exist (ADR-0017).';
