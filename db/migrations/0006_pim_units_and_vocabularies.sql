-- PIM foundations: units as a first-class domain (ADR-0015) and controlled
-- vocabularies, including the engineering designations that must never become
-- quantities (ADR-0016).

CREATE SCHEMA IF NOT EXISTS pim;
COMMENT ON SCHEMA pim IS
  'Product Information Management: units, vocabularies, attributes, product types, '
  'hierarchy, typed values, facets, relationships and quality.';

-- ---------------------------------------------------------------------------
-- Quantity dimensions and units (ADR-0015)
-- ---------------------------------------------------------------------------
CREATE TABLE pim.quantity_dimension (
  code        kernel.code_key PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL
);
COMMENT ON TABLE pim.quantity_dimension IS
  'What a quantity measures. TEMPERATURE and TEMPERATURE_DIFFERENCE are separate '
  'dimensions on purpose: 10 degC is 283.15 K, but a 10 degC difference is 10 K. '
  'Conflating them is a classic and consequential engineering bug.';

CREATE TABLE pim.unit (
  code            text PRIMARY KEY,
  dimension_code  kernel.code_key NOT NULL REFERENCES pim.quantity_dimension (code),
  name            text    NOT NULL,
  symbol          text    NOT NULL,
  -- Affine conversion: base = value * factor + offset; value = (base - offset) / factor.
  -- Pure scaling is simply offset = 0.
  factor_to_base  numeric NOT NULL CHECK (factor_to_base <> 0),
  offset_to_base  numeric NOT NULL DEFAULT 0,
  is_base         boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 100,
  CONSTRAINT base_unit_is_identity
    CHECK (NOT is_base OR (factor_to_base = 1 AND offset_to_base = 0))
);
COMMENT ON TABLE pim.unit IS
  'UCUM-coded units. Codes follow UCUM so they are unambiguous and interoperable: '
  'bar, [psi], Cel, [degF], mm, [in_i], N.m, L/min. Gauge and absolute pressure are '
  'distinct codes rather than a flag, because converting between them needs ambient '
  'pressure and must be explicit.';
COMMENT ON COLUMN pim.unit.factor_to_base IS
  'Exact where the definition is exact: 1 [in_i] = 25.4 mm by definition.';

CREATE UNIQUE INDEX unit_one_base_per_dimension
  ON pim.unit (dimension_code) WHERE is_base;
CREATE INDEX unit_dimension_idx ON pim.unit (dimension_code, sort_order);

CREATE TABLE pim.unit_alias (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  unit_code         text NOT NULL REFERENCES pim.unit (code) ON DELETE CASCADE,
  alias             text NOT NULL,
  normalized_alias  text GENERATED ALWAYS AS
    (upper(regexp_replace(alias, '[^a-zA-Z0-9]', '', 'g'))) STORED
);
CREATE UNIQUE INDEX unit_alias_unique ON pim.unit_alias (normalized_alias);
COMMENT ON TABLE pim.unit_alias IS
  'Spellings seen in source data that resolve to a unit: PSI, psig, "in", INCH. '
  'Ingestion resolves through here; it never guesses.';

-- ---------------------------------------------------------------------------
-- Controlled vocabularies (spec §28) and engineering designations (ADR-0016)
-- ---------------------------------------------------------------------------
CREATE TABLE pim.vocabulary (
  key               kernel.machine_key PRIMARY KEY,
  name              text    NOT NULL,
  description       text    NOT NULL,
  -- A designation vocabulary holds controlled engineering designations, not
  -- measurements. ASME Class 150 is a pressure-temperature rating designation, not
  -- 150 PSI. NPS 1 is a size designation, not 25.4 mm. The unit conversion service
  -- refuses to accept a term from a designation vocabulary (ADR-0016).
  is_designation    boolean NOT NULL DEFAULT false,
  designation_kind  text CHECK (designation_kind IN ('NOMINAL_SIZE','PRESSURE_CLASS')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designation_kind_iff_designation
    CHECK (is_designation = (designation_kind IS NOT NULL)),
  -- Foreign key target for attribute.value_type -> vocabulary kind checking.
  CONSTRAINT vocabulary_key_kind_unique UNIQUE (key, designation_kind)
);

CREATE TABLE pim.vocabulary_term (
  id                 uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  vocabulary_key     kernel.machine_key NOT NULL REFERENCES pim.vocabulary (key),
  code               kernel.code_key NOT NULL,
  label              text NOT NULL,
  description        text,
  parent_id          uuid REFERENCES pim.vocabulary_term (id),
  -- Ordering without being a number. Sizes and pressure classes must sort correctly
  -- even though their designations are not quantities.
  sort_ordinal       numeric,

  -- Designation metadata. Present only for designation vocabularies.
  size_system        text CHECK (size_system IN ('NPS','DN','OD_TUBE','JIS','ISO','BSP','NONE')),
  designation        text,
  reference_standard text,

  deprecated_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT term_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT term_code_unique UNIQUE (vocabulary_key, code),
  CONSTRAINT term_id_vocabulary_unique UNIQUE (id, vocabulary_key)
);
CREATE INDEX vocabulary_term_vocab_idx ON pim.vocabulary_term (vocabulary_key, sort_ordinal);
CREATE INDEX vocabulary_term_parent_idx ON pim.vocabulary_term (parent_id) WHERE parent_id IS NOT NULL;

COMMENT ON COLUMN pim.vocabulary_term.designation IS
  'The designation itself: 1, DN25, 150, PN16. For a pressure class the numeral is '
  'part of the designation and is NEVER a pressure value.';
COMMENT ON COLUMN pim.vocabulary_term.sort_ordinal IS
  'Display and comparison ordering only. Not a measurement and not convertible.';

CREATE TABLE pim.vocabulary_term_alias (
  id                  uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  term_id             uuid NOT NULL,
  vocabulary_key      kernel.machine_key NOT NULL,
  alias               text NOT NULL,
  normalized_alias    text GENERATED ALWAYS AS
    (upper(regexp_replace(alias, '[^a-zA-Z0-9]', '', 'g'))) STORED,
  source_system_code  kernel.code_key REFERENCES kernel.source_system (code),
  -- The distinction spec §28 requires. '316SS' and 'SS316' are the same thing, so
  -- they assert equivalence. 'CF8M' is a cast grade commonly supplied for 316
  -- service but is not the identical wrought material, so it normalizes without
  -- asserting equivalence and carries a note explaining why.
  asserts_equivalence boolean NOT NULL DEFAULT true,
  confidence          numeric(3,2) NOT NULL DEFAULT 1.00
    CHECK (confidence >= 0 AND confidence <= 1),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (term_id, vocabulary_key)
    REFERENCES pim.vocabulary_term (id, vocabulary_key) ON DELETE CASCADE,
  CONSTRAINT non_equivalent_alias_needs_note
    CHECK (asserts_equivalence OR note IS NOT NULL)
);

-- Within one vocabulary a spelling may definitively resolve to at most one term.
-- Non-equivalent aliases are exempt: several terms may legitimately be candidates
-- for a messy source string, which is precisely what human review is for.
CREATE UNIQUE INDEX vocabulary_term_alias_definitive
  ON pim.vocabulary_term_alias (vocabulary_key, normalized_alias)
  WHERE asserts_equivalence;
CREATE INDEX vocabulary_term_alias_lookup
  ON pim.vocabulary_term_alias (normalized_alias);

-- ---------------------------------------------------------------------------
-- Cycle guard for vocabulary term hierarchies.
--
-- PostgreSQL cannot express "no cycles" declaratively. A constraint trigger is the
-- standard answer and this is an invariant guard, not business logic: it rejects
-- impossible states and does nothing else (spec §14).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pim.assert_vocabulary_term_acyclic()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cursor_id uuid := NEW.parent_id;
  hops integer := 0;
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'vocabulary term % would create a cycle in its hierarchy', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 64 THEN
      RAISE EXCEPTION 'vocabulary term hierarchy deeper than 64 levels; refusing'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_id INTO cursor_id FROM pim.vocabulary_term WHERE id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER vocabulary_term_acyclic
  AFTER INSERT OR UPDATE OF parent_id ON pim.vocabulary_term
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION pim.assert_vocabulary_term_acyclic();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT USAGE ON SCHEMA pim TO fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pim TO fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT USAGE ON SCHEMA pim TO fsw_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA pim TO fsw_readonly;
  END IF;
END;
$$;
