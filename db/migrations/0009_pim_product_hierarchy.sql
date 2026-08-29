-- Product hierarchy (spec §22).
--
-- Manufacturer, brand, product line, product family, product and variant are distinct
-- concepts and stay distinct, even though every source system collapses some of them.
-- The semantics of each level are in docs/data-dictionary.md.
--
-- Manufacturer identity lives in party.organization, not here: an organization plays a
-- MANUFACTURER role, and the same company can also be a customer (ADR-0007). The party
-- module arrives in a later phase, so brand.owner_organization_id is a plain uuid for
-- now and gains its foreign key then. It is not a source-system identifier and it is
-- not nullable forever.

CREATE TABLE pim.brand (
  id                    uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  key                   kernel.machine_key NOT NULL UNIQUE,
  name                  text NOT NULL,
  description           text,
  -- Becomes a foreign key to party.organization when that module lands.
  owner_organization_id uuid,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE pim.brand IS
  'A trade name products are sold under. Distinct from the organization that owns it: '
  'one organization may own several brands, and a brand may change hands.';

CREATE TABLE pim.product_line (
  id            uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  key           kernel.machine_key NOT NULL UNIQUE,
  brand_id      uuid NOT NULL REFERENCES pim.brand (id),
  name          text NOT NULL,
  description   text,
  deprecated_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_line_brand_idx ON pim.product_line (brand_id);
COMMENT ON TABLE pim.product_line IS
  'A commercial grouping within a brand, broader than a family. Attribute values set '
  'here are inherited by every family, product and variant beneath it.';

CREATE TABLE pim.product_family (
  id              uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  key             kernel.machine_key NOT NULL UNIQUE,
  product_line_id uuid NOT NULL REFERENCES pim.product_line (id),
  name            text NOT NULL,
  description     text,
  deprecated_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_family_line_idx ON pim.product_family (product_line_id);
COMMENT ON TABLE pim.product_family IS
  'An engineering grouping whose members share construction and differ by configuration. '
  'A family typically defines the valve type and body style; its variants define size, '
  'materials and connection.';

CREATE TABLE pim.product (
  id                 uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  key                kernel.machine_key NOT NULL UNIQUE,
  brand_id           uuid NOT NULL REFERENCES pim.brand (id),
  -- Optional on purpose. Requiring a full line/family chain for every product would
  -- force invented groupings for the large share of catalogue data that arrives
  -- without one. Inheritance resolves through whatever chain exists.
  product_family_id  uuid REFERENCES pim.product_family (id),
  product_type_key   kernel.machine_key NOT NULL REFERENCES pim.product_type (key),
  name               text NOT NULL,
  -- The manufacturer's model series designation, as the manufacturer writes it.
  model_series       text,
  description        text,

  lifecycle_status   text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN
      ('PRE_RELEASE','ACTIVE','NON_STOCK','OBSOLETE','SUPERSEDED','DISCONTINUED')),
  lifecycle_from     date NOT NULL DEFAULT CURRENT_DATE,

  -- Optimistic concurrency (ADR-0028). Incremented on every mutation; returned as an
  -- ETag; a stale If-Match is a 412 rather than a silent overwrite.
  version            integer NOT NULL DEFAULT 1,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Soft deletion (spec §15). Business entities are not physically removed.
  deleted_at         timestamptz,
  deleted_by         uuid,
  deletion_reason    text,
  CONSTRAINT deletion_requires_reason
    CHECK (deleted_at IS NULL OR deletion_reason IS NOT NULL)
);
CREATE INDEX product_brand_idx  ON pim.product (brand_id);
CREATE INDEX product_family_idx ON pim.product (product_family_id);
CREATE INDEX product_type_idx   ON pim.product (product_type_key);
CREATE INDEX product_active_idx ON pim.product (id) WHERE deleted_at IS NULL;
CREATE INDEX product_name_trgm_idx ON pim.product USING gin (name gin_trgm_ops);

COMMENT ON TABLE pim.product IS
  'A manufacturer model series. Not an orderable item -- that is a variant.';
COMMENT ON COLUMN pim.product.lifecycle_status IS
  'Manufacturer lifecycle. FSW commercial stocking status is a separate concept and '
  'lives with channel data, because the two genuinely differ (spec §42).';

CREATE TABLE pim.variant (
  id                   uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  product_id           uuid NOT NULL REFERENCES pim.product (id),
  -- The model number as the manufacturer writes it. Preserved exactly; parsing it into
  -- attributes is a later, separate capability that never overwrites this (spec §36).
  manufacturer_part_number text,
  name                 text,
  description          text,

  lifecycle_status     text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN
      ('PRE_RELEASE','ACTIVE','NON_STOCK','OBSOLETE','SUPERSEDED','DISCONTINUED')),
  lifecycle_from       date NOT NULL DEFAULT CURRENT_DATE,

  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  deleted_by           uuid,
  deletion_reason      text,
  CONSTRAINT variant_deletion_requires_reason
    CHECK (deleted_at IS NULL OR deletion_reason IS NOT NULL)
);
CREATE INDEX variant_product_idx ON pim.variant (product_id);
CREATE INDEX variant_active_idx  ON pim.variant (id) WHERE deleted_at IS NULL;
CREATE INDEX variant_mpn_trgm_idx
  ON pim.variant USING gin (manufacturer_part_number gin_trgm_ops)
  WHERE manufacturer_part_number IS NOT NULL;

COMMENT ON TABLE pim.variant IS
  'An orderable configuration -- what a customer actually buys. Identity is the FSW '
  'UUID; manufacturer part numbers, SKUs and source-system item IDs are external '
  'identifiers, never the primary key (ADR-0004).';

-- ---------------------------------------------------------------------------
-- External identifiers (spec §37).
--
-- No p21_id, valveman_sku or gtin column appears on a product table. Identifiers live
-- here with a namespace, so adding a source system is data rather than a migration.
-- ---------------------------------------------------------------------------
CREATE TABLE pim.identifier_namespace (
  code             kernel.code_key PRIMARY KEY,
  name             text NOT NULL,
  description      text NOT NULL,
  issuer           text,
  -- Whether a value must be unique across the whole catalogue. A GTIN is; a
  -- manufacturer part number is not, because two brands legitimately reuse one.
  is_global_unique boolean NOT NULL DEFAULT false,
  -- Optional format check applied at write time.
  value_pattern    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Target for the composite foreign key that carries is_global_unique onto each row,
  -- so a partial unique index can be conditioned on it without a trigger.
  CONSTRAINT identifier_namespace_uniqueness UNIQUE (code, is_global_unique)
);

CREATE TABLE pim.product_identifier (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  variant_id        uuid REFERENCES pim.variant (id) ON DELETE CASCADE,
  product_id        uuid REFERENCES pim.product (id) ON DELETE CASCADE,
  namespace_code    kernel.code_key NOT NULL,
  is_global_unique  boolean NOT NULL,
  value             text NOT NULL,
  normalized_value  text GENERATED ALWAYS AS
    (upper(regexp_replace(value, '[^a-zA-Z0-9]', '', 'g'))) STORED,
  valid_from        date,
  valid_to          date,
  validation_status text NOT NULL DEFAULT 'UNVALIDATED'
    CHECK (validation_status IN ('UNVALIDATED','VALID','INVALID','SUPERSEDED')),
  source_system_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identifier_has_exactly_one_owner CHECK (
    (variant_id IS NOT NULL)::int + (product_id IS NOT NULL)::int = 1),
  CONSTRAINT identifier_validity_ordered
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  FOREIGN KEY (namespace_code, is_global_unique)
    REFERENCES pim.identifier_namespace (code, is_global_unique) ON UPDATE CASCADE
);

CREATE INDEX product_identifier_variant_idx ON pim.product_identifier (variant_id);
CREATE INDEX product_identifier_product_idx ON pim.product_identifier (product_id);
CREATE INDEX product_identifier_lookup_idx
  ON pim.product_identifier (namespace_code, normalized_value);
-- Enforced only where the namespace says the identifier is globally unique.
CREATE UNIQUE INDEX product_identifier_global_unique
  ON pim.product_identifier (namespace_code, normalized_value)
  WHERE is_global_unique;

COMMENT ON TABLE pim.product_identifier IS
  'Manufacturer part numbers, GTINs, UPCs, ValveMan SKUs, P21 item IDs, legacy models. '
  'GTIN is never required: most industrial products do not have one (spec §37).';
COMMENT ON COLUMN pim.product_identifier.is_global_unique IS
  'Carried from the namespace by a cascading composite foreign key so the partial '
  'unique index below can be conditioned on it. Never set by hand.';

INSERT INTO pim.identifier_namespace (code, name, description, issuer, is_global_unique, value_pattern) VALUES
  ('MPN', 'Manufacturer part number',
   'The manufacturer''s own part or model number. Not globally unique: two brands '
   'legitimately use the same string.', 'Manufacturer', false, NULL),
  ('MFR_CATALOG', 'Manufacturer catalogue number',
   'A catalogue or ordering number distinct from the model number.', 'Manufacturer', false, NULL),
  ('GTIN', 'GTIN',
   'Global Trade Item Number. Globally unique where present; most industrial products '
   'do not have one.', 'GS1', true, '^[0-9]{8}$|^[0-9]{12,14}$'),
  ('UPC', 'UPC-A', 'Universal Product Code.', 'GS1', true, '^[0-9]{12}$'),
  ('VALVEMAN_SKU', 'ValveMan SKU', 'Storefront SKU on ValveMan.com.', 'FSW', true, NULL),
  ('P21_ITEM', 'Prophet 21 item ID', 'Item identifier in Epicor Prophet 21.', 'FSW', true, NULL),
  ('VENDOR_PART', 'Vendor part number',
   'A distributor or vendor part number that is not the manufacturer''s.', NULL, false, NULL),
  ('LEGACY_MODEL', 'Legacy model number',
   'A superseded model number retained so historical references still resolve.',
   'Manufacturer', false, NULL);

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
