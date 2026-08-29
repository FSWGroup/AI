-- Product relationships and certifications (spec §38, §40, §41, §42).
--
-- Cross-reference knowledge is among the most valuable things FSW holds and the least
-- likely to exist in any vendor system: which valve genuinely replaces which, and how
-- confident anyone is about that. It is also the knowledge most at risk of leaving with
-- a retiring salesperson.
--
-- So the distinction the specification insists on is enforced here: "this will bolt in
-- with identical performance" is a different assertion from "this is probably the
-- closest alternative", and the model refuses to let them blur.

-- ---------------------------------------------------------------------------
-- Relationship types are data, so adding one is configuration, not a migration.
-- ---------------------------------------------------------------------------
CREATE TABLE pim.relationship_type (
  code                  kernel.code_key PRIMARY KEY,
  name                  text NOT NULL,
  description           text NOT NULL,
  -- A directional relationship reads one way only: A is superseded by B.
  is_directional        boolean NOT NULL DEFAULT true,
  -- A symmetric relationship implies its own inverse: if A is equivalent to B, B is
  -- equivalent to A. Stored once; resolved both ways.
  is_symmetric          boolean NOT NULL DEFAULT false,
  -- Whether the relationship asserts the products can be substituted without
  -- engineering review. This is the line between an equivalent and a suggestion.
  implies_interchangeable boolean NOT NULL DEFAULT false,
  -- Whether a human must verify before the relationship is exposed as authoritative.
  requires_verification boolean NOT NULL DEFAULT false,
  -- Whether a chain of these must be acyclic (supersession must; alternates need not).
  must_be_acyclic       boolean NOT NULL DEFAULT false,
  sort_order            integer NOT NULL DEFAULT 100,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT symmetric_is_not_directional CHECK (NOT (is_symmetric AND is_directional))
);

INSERT INTO pim.relationship_type
  (code, name, description, is_directional, is_symmetric, implies_interchangeable,
   requires_verification, must_be_acyclic, sort_order)
VALUES
  ('EXACT_EQUIVALENT', 'Exact form-fit-function equivalent',
   'Identical in form, fit and function. Bolts in with the same performance and needs '
   'no engineering review to substitute. The strongest claim the system can make, so it '
   'requires verification before it is treated as authoritative.',
   false, true, true, true, false, 10),

  ('APPROVED_REPLACEMENT', 'Engineer-approved replacement',
   'An FSW application engineer has reviewed this substitution and approved it for the '
   'stated scope. Not necessarily identical: approved.',
   true, false, true, true, false, 20),

  ('FUNCTIONAL_ALTERNATE', 'Functional alternate',
   'Performs the same function and is likely suitable, but differs in form, fit or '
   'detail. Requires application review before substitution.',
   true, false, false, false, false, 30),

  ('CLOSEST_COMPARABLE', 'Closest comparable',
   'The nearest thing FSW offers. A starting point for a conversation, not a '
   'substitution. Explicitly NOT interchangeable.',
   true, false, false, false, false, 40),

  ('COMPETITOR_CROSS_REFERENCE', 'Competitor cross-reference',
   'A competitor product this one is offered against. Says nothing about technical '
   'equivalence on its own.',
   true, false, false, false, false, 50),

  ('SUPERSEDED_BY', 'Superseded by',
   'The manufacturer has replaced this product with another. Chains resolve to the '
   'currently active successor and must not form a cycle.',
   true, false, false, false, true, 60),

  ('ACCESSORY_FOR', 'Accessory for',
   'Fits or is used with the target product. Not a substitution.',
   true, false, false, false, false, 70),

  ('REPAIR_KIT_FOR', 'Repair kit for',
   'A service or repair kit for the target product.',
   true, false, false, false, false, 80);

-- ---------------------------------------------------------------------------
-- The relationships themselves.
--
-- Either end may be a product or a variant: "the 77C series supersedes the 70 series"
-- is a product-level fact, while "this exact SKU replaces that exact SKU" is a variant
-- one. Both are real, so both are representable.
-- ---------------------------------------------------------------------------
CREATE TABLE pim.product_relationship (
  id                  uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),

  from_product_id     uuid REFERENCES pim.product (id) ON DELETE CASCADE,
  from_variant_id     uuid REFERENCES pim.variant (id) ON DELETE CASCADE,
  to_product_id       uuid REFERENCES pim.product (id) ON DELETE CASCADE,
  to_variant_id       uuid REFERENCES pim.variant (id) ON DELETE CASCADE,

  from_key            text GENERATED ALWAYS AS
    (coalesce(from_variant_id::text, from_product_id::text)) STORED,
  to_key              text GENERATED ALWAYS AS
    (coalesce(to_variant_id::text, to_product_id::text)) STORED,
  from_level          text GENERATED ALWAYS AS
    (CASE WHEN from_variant_id IS NOT NULL THEN 'VARIANT' ELSE 'PRODUCT' END) STORED,
  to_level            text GENERATED ALWAYS AS
    (CASE WHEN to_variant_id IS NOT NULL THEN 'VARIANT' ELSE 'PRODUCT' END) STORED,

  relationship_type   kernel.code_key NOT NULL REFERENCES pim.relationship_type (code),

  -- How sure we are. Distinct from verification: a confident guess is still a guess.
  confidence          numeric(3,2) NOT NULL DEFAULT 0.50
    CHECK (confidence >= 0 AND confidence <= 1),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','VERIFIED','DISPUTED','REJECTED')),
  verified_by         uuid,
  verified_at         timestamptz,

  -- What the claim rests on: a manufacturer bulletin, a dimensional comparison, a
  -- named engineer's judgement. Free-form because evidence genuinely varies, but
  -- never empty for a verified relationship.
  evidence            text,
  notes               text,

  source_system_code  kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- Valid time: a supersession takes effect on a date, and an approved replacement can
  -- be withdrawn (ADR-0018).
  valid_from          date NOT NULL DEFAULT CURRENT_DATE,
  valid_to            date,
  validity            daterange GENERATED ALWAYS AS
    (daterange(valid_from, valid_to, '[)')) STORED,

  CONSTRAINT relationship_from_is_one_thing CHECK (
    (from_product_id IS NOT NULL)::int + (from_variant_id IS NOT NULL)::int = 1),
  CONSTRAINT relationship_to_is_one_thing CHECK (
    (to_product_id IS NOT NULL)::int + (to_variant_id IS NOT NULL)::int = 1),
  CONSTRAINT relationship_validity_ordered CHECK (valid_to IS NULL OR valid_from < valid_to),
  CONSTRAINT verified_relationship_needs_evidence CHECK (
    verification_status <> 'VERIFIED'
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND evidence IS NOT NULL))
);

-- A product is never related to itself.
ALTER TABLE pim.product_relationship
  ADD CONSTRAINT relationship_not_self CHECK (from_key IS DISTINCT FROM to_key);

-- One relationship of a given type between the same two things at the same time.
ALTER TABLE pim.product_relationship
  ADD CONSTRAINT one_relationship_per_type_and_period
  EXCLUDE USING gist (
    from_key WITH =, to_key WITH =, relationship_type WITH =, validity WITH &&
  );

CREATE INDEX product_relationship_from_idx
  ON pim.product_relationship (from_key, relationship_type);
CREATE INDEX product_relationship_to_idx
  ON pim.product_relationship (to_key, relationship_type);
CREATE INDEX product_relationship_type_idx
  ON pim.product_relationship (relationship_type, verification_status);

COMMENT ON TABLE pim.product_relationship IS
  'Cross-references, equivalents, alternates and supersession. The relationship TYPE '
  'carries the semantics: EXACT_EQUIVALENT asserts interchangeability, '
  'CLOSEST_COMPARABLE explicitly does not, and the API never flattens them into a '
  'single "related products" list (spec §40).';
COMMENT ON COLUMN pim.product_relationship.confidence IS
  'How sure the assertion is. Orthogonal to verification_status: an unverified claim '
  'can be confident, and a verified one can be narrow in scope.';

-- ---------------------------------------------------------------------------
-- Supersession cycles.
--
-- A -> B -> C -> A would make "what replaces A" unanswerable, and a resolver would
-- loop forever. PostgreSQL cannot express acyclicity declaratively, so a constraint
-- trigger walks the chain. This is an invariant guard, not business logic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pim.assert_relationship_acyclic()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  needs_check boolean;
  cursor_key text := NEW.to_key;
  hops integer := 0;
BEGIN
  SELECT must_be_acyclic INTO needs_check
    FROM pim.relationship_type WHERE code = NEW.relationship_type;
  IF NOT coalesce(needs_check, false) THEN
    RETURN NEW;
  END IF;

  WHILE cursor_key IS NOT NULL LOOP
    IF cursor_key = NEW.from_key THEN
      RAISE EXCEPTION
        'relationship % from % to % would create a cycle in the % chain',
        NEW.id, NEW.from_key, NEW.to_key, NEW.relationship_type
        USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 100 THEN
      RAISE EXCEPTION '% chain from % is longer than 100 links; refusing',
        NEW.relationship_type, NEW.from_key
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT to_key INTO cursor_key
      FROM pim.product_relationship
     WHERE from_key = cursor_key
       AND relationship_type = NEW.relationship_type
       AND id <> NEW.id
       AND (valid_to IS NULL OR valid_to > CURRENT_DATE)
     LIMIT 1;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER product_relationship_acyclic
  AFTER INSERT OR UPDATE OF to_product_id, to_variant_id, relationship_type
  ON pim.product_relationship
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION pim.assert_relationship_acyclic();

-- ---------------------------------------------------------------------------
-- Certifications (spec §38).
--
-- A certificate applying to one size and material configuration does NOT certify a
-- whole product family. That is why a certification attaches to a specific product or
-- variant and carries its own scope, rather than being a flag on a family.
-- ---------------------------------------------------------------------------
CREATE TABLE pim.certification_body (
  code        kernel.code_key PRIMARY KEY,
  name        text NOT NULL,
  description text,
  website     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pim.certification_body (code, name, description) VALUES
  ('THREE_A_SSI', '3-A Sanitary Standards, Inc.', 'Hygienic equipment design standards.'),
  ('NSF', 'NSF International', 'Public health and safety standards and certification.'),
  ('AMPP', 'AMPP (formerly NACE)', 'Corrosion control standards.'),
  ('API', 'American Petroleum Institute', 'Petroleum industry standards.'),
  ('ASME', 'ASME', 'Boiler and pressure vessel, and valve, standards.'),
  ('NOTIFIED_BODY', 'EU notified body', 'Conformity assessment under EU directives.'),
  ('CSA', 'CSA Group', 'Canadian registration and certification.'),
  ('UL', 'UL Solutions', 'Safety certification.'),
  ('FM', 'FM Approvals', 'Property loss prevention certification.'),
  ('MANUFACTURER', 'Manufacturer self-declaration',
   'Declared by the manufacturer without third-party assessment. Recorded as such, '
   'because a self-declaration and a certificate are different things.');

CREATE TABLE pim.product_certification (
  id                  uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),

  product_id          uuid REFERENCES pim.product (id) ON DELETE CASCADE,
  variant_id          uuid REFERENCES pim.variant (id) ON DELETE CASCADE,
  subject_key         text GENERATED ALWAYS AS
    (coalesce(variant_id::text, product_id::text)) STORED,

  -- The standard, from the certification vocabulary.
  certification_term_id uuid NOT NULL,
  vocabulary_key      kernel.machine_key NOT NULL DEFAULT 'certification',

  issuing_body_code   kernel.code_key REFERENCES pim.certification_body (code),
  -- The revision of the standard the certificate was issued against. A certificate to
  -- the 2015 revision is not a certificate to the 2023 one.
  standard_revision   text,
  certificate_id      text,
  -- What the certificate actually covers: sizes, materials, service conditions. A
  -- certificate with an unstated scope is a warning sign, not a blank cheque.
  scope               text,

  issued_on           date,
  expires_on          date,
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','VERIFIED','DISPUTED','EXPIRED','WITHDRAWN')),
  verified_by         uuid,
  verified_at         timestamptz,

  source_system_code  kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT certification_subject_is_one_thing CHECK (
    (product_id IS NOT NULL)::int + (variant_id IS NOT NULL)::int = 1),
  CONSTRAINT certification_dates_ordered CHECK (
    issued_on IS NULL OR expires_on IS NULL OR issued_on < expires_on),
  CONSTRAINT verified_certification_needs_actor CHECK (
    verification_status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  FOREIGN KEY (certification_term_id, vocabulary_key)
    REFERENCES pim.vocabulary_term (id, vocabulary_key)
);

CREATE INDEX product_certification_subject_idx
  ON pim.product_certification (subject_key);
CREATE INDEX product_certification_term_idx
  ON pim.product_certification (certification_term_id, verification_status);
CREATE INDEX product_certification_expiry_idx
  ON pim.product_certification (expires_on) WHERE expires_on IS NOT NULL;

COMMENT ON TABLE pim.product_certification IS
  'Certificates and approvals held by a specific product or variant, with the standard '
  'revision, the certificate identifier and the scope it covers. A certificate for one '
  'size and material configuration does not certify a whole family (spec §38).';
COMMENT ON COLUMN pim.product_certification.scope IS
  'What the certificate covers. Recorded because "the product is 3-A certified" is '
  'usually shorthand for "these configurations are".';

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
