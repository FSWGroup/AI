-- The party model: organizations, sites, locations, accounts and people
-- (ADR-0007, spec §6, §45).
--
-- Four concepts are kept rigorously distinct here, because collapsing them is the
-- single most common and most expensive master-data mistake:
--
--   organization       a company. Exists whether or not FSW trades with it.
--   site               a physical facility it operates. The thing a salesperson visits.
--   location           an address. Not a business entity.
--   commercial account a source system's accounting construct. Not an organization.
--
-- And a fifth distinction that is easy to lose: a SHIP-TO is a commercial and
-- logistical role over a location. It is not a plant. It may be a loading dock, a job
-- trailer, a third-party warehouse, or a customer's freight forwarder.
--
-- Canonical scalar fields on these tables are NEVER written directly. They are
-- materialized survivorship outputs over candidate values (ADR-0011, migration 0016).
-- The columns are real, typed and indexable because that is what makes them useful;
-- they are a cache of a derivation, not an authored value.

CREATE SCHEMA IF NOT EXISTS party;
COMMENT ON SCHEMA party IS
  'Canonical organizations, sites, locations, commercial accounts and people, with '
  'field-level provenance. Shared by every FSW business (ADR-0007).';

-- ---------------------------------------------------------------------------
-- Registries
-- ---------------------------------------------------------------------------
CREATE TABLE party.organization_role_type (
  code        kernel.code_key PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  -- Whether the role is meaningful per operating company. A CUSTOMER role is: an
  -- organization can be a Welsford customer and not a ValveMan one. MANUFACTURER is
  -- not: a company either makes things or it does not.
  is_company_scoped boolean NOT NULL DEFAULT false,
  sort_ordinal integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE party.organization_role_type IS
  'Roles an organization can play. Adding one requires a data-dictionary entry and a '
  'stated consumer, which is the control on role explosion (ADR-0007).';

INSERT INTO party.organization_role_type (code, name, description, is_company_scoped, sort_ordinal) VALUES
  ('CUSTOMER',        'Customer',            'Buys from an FSW business.', true, 10),
  ('PROSPECT',        'Prospect',            'Not yet a customer of this business.', true, 20),
  ('MANUFACTURER',    'Manufacturer',        'Makes products.', false, 30),
  ('BRAND_OWNER',     'Brand owner',         'Owns a brand, which may be made by someone else.', false, 40),
  ('SUPPLIER',        'Supplier',            'FSW buys from them.', true, 50),
  ('DISTRIBUTOR',     'Distributor',         'Distributes products; often also a competitor.', false, 60),
  ('MANUFACTURER_REP','Manufacturer rep',    'Represents manufacturers in a territory, as Welsford does.', false, 70),
  ('SPECIFIER',       'Specifier',           'Specifies equipment without buying it: an A&E firm.', false, 80),
  ('OEM',             'OEM',                 'Builds FSW-supplied components into their own equipment.', false, 90),
  ('CONTRACTOR',      'Contractor',          'Installs or builds; buys for a job rather than a facility.', false, 100),
  ('END_USER',        'End user',            'Operates the equipment, whoever bought it.', false, 110),
  ('CARRIER',         'Carrier',             'Moves freight.', false, 120),
  ('INTERNAL',        'Internal',            'An FSW entity itself.', false, 130);

CREATE TABLE party.affiliation_type (
  code        kernel.code_key PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  -- True where the person is an FSW employee rather than someone else's contact.
  is_internal boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true
);

INSERT INTO party.affiliation_type (code, name, description, is_internal) VALUES
  ('EMPLOYEE',    'Employee',       'Employed by the organization.', true),
  ('CONTACT',     'Contact',        'A contact at a customer, supplier or prospect.', false),
  ('DECISION_MAKER','Decision maker','A contact who signs off on purchases.', false),
  ('ENGINEER',    'Engineer',       'A technical contact, at a customer or a specifier.', false),
  ('BUYER',       'Buyer',          'A purchasing contact.', false),
  ('FORMER',      'Former',         'Was affiliated and no longer is. Kept for history.', false);

CREATE TABLE party.relationship_type (
  code             kernel.code_key PRIMARY KEY,
  name             text NOT NULL,
  description      text NOT NULL,
  -- The name of the reverse direction, so the UI never has to invent one.
  inverse_name     text NOT NULL,
  -- Hierarchical types form a directed acyclic graph and are cycle-checked. A
  -- non-hierarchical type (COMPETES_WITH) is symmetric and needs no such check.
  is_hierarchical  boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true
);

INSERT INTO party.relationship_type (code, name, description, inverse_name, is_hierarchical) VALUES
  ('PARENT_OF',    'Parent of',    'Owns or controls the other organization.', 'Subsidiary of', true),
  ('DIVISION_OF',  'Has division', 'An operating division rather than a separate legal entity.', 'Division of', true),
  ('ACQUIRED',     'Acquired',     'Acquired the other organization; both records are kept.', 'Acquired by', true),
  ('COMPETES_WITH','Competes with','Competes in at least one market.', 'Competes with', false),
  ('PARTNERS_WITH','Partners with','A commercial partnership.', 'Partners with', false);

-- ---------------------------------------------------------------------------
-- Locations (spec §46)
--
-- Raw text is preserved exactly as the source gave it, and a normalized form sits
-- beside it. Overwriting the raw address with a normalizer's output destroys the
-- evidence needed to tell a normalization bug from a bad source, and there is no way
-- to get it back.
-- ---------------------------------------------------------------------------
CREATE TABLE party.location (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),

  -- Exactly what the source said, joined with newlines. Never edited, never cleaned.
  raw_address       text NOT NULL,

  line1             text,
  line2             text,
  city              text,
  -- ISO 3166-2 subdivision code without the country prefix: 'PA', 'NJ', 'ON'.
  region_code       text,
  postal_code       text,
  -- ISO 3166-1 alpha-2. Defaulted to US only where a source omits it AND the
  -- connector declares that default; never guessed from the postal code shape.
  country_code      char(2) NOT NULL DEFAULT 'US'
    CONSTRAINT country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),

  -- A stable key over the normalized components, used for blocking during entity
  -- resolution. Not a uniqueness constraint: two suites at one address are two
  -- locations, and a normalization change must not require a data migration.
  normalized_key    text,
  normalization_version integer NOT NULL DEFAULT 1,

  latitude          numeric(9,6)  CONSTRAINT latitude_range  CHECK (latitude  BETWEEN -90 AND 90),
  longitude         numeric(9,6)  CONSTRAINT longitude_range CHECK (longitude BETWEEN -180 AND 180),
  -- How the coordinates were obtained, so a rooftop match is distinguishable from a
  -- postal-code centroid. Absent until something geocodes it; Layer 0 does not.
  geocode_precision text CHECK (geocode_precision IN ('ROOFTOP','PARCEL','STREET','POSTAL','CITY','REGION')),

  -- Deliverability as a postal service assessed it, where a source tells us.
  address_status    text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (address_status IN ('UNVERIFIED','VERIFIED','UNDELIVERABLE','VACANT')),

  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid
);
CREATE INDEX location_normalized_idx ON party.location (normalized_key)
  WHERE normalized_key IS NOT NULL;
CREATE INDEX location_region_idx ON party.location (country_code, region_code, city);
CREATE INDEX location_postal_idx ON party.location (country_code, postal_code);

COMMENT ON TABLE party.location IS
  'A postal or physical address. NOT a business entity and NOT a site: several '
  'organizations can occupy one address, and one site can have several (ADR-0007).';
COMMENT ON COLUMN party.location.raw_address IS
  'Exactly what the source asserted. Never normalized in place: overwriting it makes '
  'a normalization bug indistinguishable from a bad source, permanently (spec §46).';

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
CREATE TABLE party.organization (
  id                 uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),

  -- Mastered fields. Every one of these is a materialized survivorship output; the
  -- application writes candidates and recomputes (ADR-0011). A direct UPDATE here is
  -- a bug, and organization_field_candidate is where the evidence lives.
  legal_name         text NOT NULL,
  trade_name         text,
  website_url        text,
  main_phone         text,
  -- Employer identification number and similar. Classified SECRET for audit
  -- redaction: it identifies a business uniquely and is not needed for most work.
  tax_identifier     text,
  duns_number        text,
  -- North American Industry Classification System. Six digits, as a string, because
  -- leading zeros matter and no arithmetic is ever done on it.
  naics_code         text CONSTRAINT naics_format CHECK (naics_code ~ '^[0-9]{2,6}$'),
  organization_type  text NOT NULL DEFAULT 'COMPANY'
    CHECK (organization_type IN ('COMPANY','GOVERNMENT','MUNICIPAL','UTILITY','INSTITUTION','NON_PROFIT','INDIVIDUAL')),

  primary_location_id uuid REFERENCES party.location (id),

  -- Lifecycle, which is about the organization in the world, not about our record of
  -- it. A dissolved company still has history worth keeping.
  lifecycle_status   text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','DISSOLVED','ACQUIRED','DUPLICATE')),

  -- Set when this record was merged into another. The row is kept forever so that
  -- every identifier ever issued still resolves, and so an unmerge is possible
  -- (ADR-0012). Never deleted.
  merged_into_id     uuid REFERENCES party.organization (id),
  merged_at          timestamptz,

  -- How confident we are that this is a real, distinct organization. Records created
  -- by matching start lower than records a person confirmed.
  confidence         text NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK (confidence IN ('UNCONFIRMED','PROBABLE','CONFIRMED')),

  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,

  CONSTRAINT merged_organization_has_target CHECK (
    (merged_into_id IS NULL) = (merged_at IS NULL)),
  CONSTRAINT merged_organization_is_duplicate CHECK (
    merged_into_id IS NULL OR lifecycle_status = 'DUPLICATE'),
  CONSTRAINT organization_not_merged_into_itself CHECK (merged_into_id <> id)
);
CREATE INDEX organization_live_idx ON party.organization (legal_name)
  WHERE merged_into_id IS NULL;
CREATE INDEX organization_merged_idx ON party.organization (merged_into_id)
  WHERE merged_into_id IS NOT NULL;
CREATE INDEX organization_name_trgm_idx ON party.organization
  USING gin (legal_name gin_trgm_ops);

COMMENT ON TABLE party.organization IS
  'One canonical company, playing any number of roles (ADR-0007). Mastered columns '
  'are survivorship outputs and are never written directly (ADR-0011).';
COMMENT ON COLUMN party.organization.merged_into_id IS
  'Set when this record lost a merge. The row is never deleted: every identifier ever '
  'issued must keep resolving, and unmerge must remain possible (ADR-0012).';

CREATE TABLE party.organization_role (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  organization_id   uuid NOT NULL REFERENCES party.organization (id) ON DELETE CASCADE,
  role_code         kernel.code_key NOT NULL REFERENCES party.organization_role_type (code),
  -- Null where the role is not company-scoped. A CUSTOMER role names which business.
  operating_company kernel.code_key REFERENCES kernel.operating_company (code),

  -- When the role applied. Open-ended by default: most roles have no known start.
  valid_from        date,
  valid_to          date,

  source_system_code kernel.code_key REFERENCES kernel.source_system (code),
  source_record_id   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT role_dates_ordered CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX organization_role_unique
  ON party.organization_role (organization_id, role_code, coalesce(operating_company, '*'))
  WHERE valid_to IS NULL;
CREATE INDEX organization_role_lookup_idx
  ON party.organization_role (role_code, operating_company, organization_id);

COMMENT ON TABLE party.organization_role IS
  'What an organization is to us, per operating company where that matters. A '
  'manufacturer that also buys from us has two rows, not two organizations.';

CREATE TABLE party.organization_relationship (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  from_organization_id uuid NOT NULL REFERENCES party.organization (id) ON DELETE CASCADE,
  to_organization_id   uuid NOT NULL REFERENCES party.organization (id) ON DELETE CASCADE,
  relationship_code kernel.code_key NOT NULL REFERENCES party.relationship_type (code),

  valid_from        date,
  valid_to          date,
  note              text,

  source_system_code kernel.code_key REFERENCES kernel.source_system (code),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT relationship_not_reflexive CHECK (from_organization_id <> to_organization_id),
  CONSTRAINT relationship_dates_ordered CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX organization_relationship_unique
  ON party.organization_relationship (from_organization_id, to_organization_id, relationship_code)
  WHERE valid_to IS NULL;
CREATE INDEX organization_relationship_to_idx
  ON party.organization_relationship (to_organization_id, relationship_code);

COMMENT ON TABLE party.organization_relationship IS
  'Corporate structure and commercial relationships. Hierarchical types are checked '
  'for cycles in the application, which reports the offending path rather than '
  'raising a constraint violation nobody can act on.';

-- ---------------------------------------------------------------------------
-- Sites: the physical facilities an organization operates
-- ---------------------------------------------------------------------------
CREATE TABLE party.site (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  organization_id   uuid NOT NULL REFERENCES party.organization (id),
  location_id       uuid REFERENCES party.location (id),

  -- Mastered. What the facility is called: 'Marcus Hook Refinery', 'Plant 3'.
  name              text NOT NULL,
  site_type         text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (site_type IN ('UNKNOWN','PLANT','REFINERY','TREATMENT_WORKS','HEADQUARTERS',
                         'DISTRIBUTION_CENTRE','WAREHOUSE','OFFICE','LABORATORY','FIELD_SITE')),
  -- What the facility does, for the application knowledge Welsford's business rests
  -- on. Free text is deliberate: a controlled vocabulary here would be guessed.
  industry_note     text,

  lifecycle_status  text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','CLOSED','SOLD')),
  merged_into_id    uuid REFERENCES party.site (id),
  merged_at         timestamptz,

  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,

  CONSTRAINT merged_site_has_target CHECK ((merged_into_id IS NULL) = (merged_at IS NULL)),
  CONSTRAINT site_not_merged_into_itself CHECK (merged_into_id <> id)
);
CREATE INDEX site_organization_idx ON party.site (organization_id)
  WHERE merged_into_id IS NULL;
CREATE INDEX site_location_idx ON party.site (location_id);

COMMENT ON TABLE party.site IS
  'A physical facility an organization operates. The thing a salesperson visits and '
  'the thing equipment is installed in. NOT an address and NOT a ship-to (ADR-0007).';

-- ---------------------------------------------------------------------------
-- Commercial accounts: the source systems'' accounting constructs
-- ---------------------------------------------------------------------------
CREATE TABLE party.commercial_account (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  organization_id   uuid NOT NULL REFERENCES party.organization (id),
  operating_company kernel.code_key NOT NULL REFERENCES kernel.operating_company (code),

  -- Which source system's construct this is, and what that system calls it. The
  -- source's own key lives HERE and nowhere else: this table is part of the
  -- anti-corruption boundary, not an exception to it.
  source_system_code kernel.code_key NOT NULL REFERENCES kernel.source_system (code),
  source_account_key text NOT NULL,
  source_record_id   uuid REFERENCES ingest.source_record (id),

  -- What the source calls the account, which is frequently not the company's name.
  account_name      text,
  account_status    text NOT NULL DEFAULT 'ACTIVE'
    CHECK (account_status IN ('ACTIVE','INACTIVE','ON_HOLD','CLOSED')),
  -- Deliberately NOT here: credit limits, terms, balances, pricing. Layer 0 holds no
  -- pricing and is not an ERP (ADR-0033). Those stay in the system that owns them.

  opened_on         date,
  closed_on         date,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,

  CONSTRAINT commercial_account_identity UNIQUE (source_system_code, source_account_key),
  CONSTRAINT account_dates_ordered CHECK (closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on)
);
CREATE INDEX commercial_account_organization_idx
  ON party.commercial_account (organization_id, operating_company);

COMMENT ON TABLE party.commercial_account IS
  'A P21 customer, a ValveMan web customer, a Pipedrive organization used as an '
  'account. One organization routinely has several, across several businesses. An '
  'account is NOT an organization: treating them as the same thing is why one company '
  'appears eleven times in a CRM (ADR-0007).';

CREATE TABLE party.ship_to (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  commercial_account_id uuid NOT NULL REFERENCES party.commercial_account (id) ON DELETE CASCADE,
  location_id       uuid NOT NULL REFERENCES party.location (id),
  -- Optional, and optional on purpose. A ship-to often IS a site, and just as often
  -- is a job trailer, a freight forwarder or a third-party warehouse. Requiring a
  -- site here would force someone to invent one (ADR-0007).
  site_id           uuid REFERENCES party.site (id),

  source_ship_to_key text NOT NULL,
  name              text,
  is_default        boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  delivery_note     text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ship_to_identity UNIQUE (commercial_account_id, source_ship_to_key)
);
CREATE UNIQUE INDEX ship_to_default_idx
  ON party.ship_to (commercial_account_id) WHERE is_default;
CREATE INDEX ship_to_location_idx ON party.ship_to (location_id);
CREATE INDEX ship_to_site_idx ON party.ship_to (site_id) WHERE site_id IS NOT NULL;

COMMENT ON TABLE party.ship_to IS
  'A commercial and logistical role over a location. A ship-to is NOT a plant: it may '
  'be a loading dock, a job trailer, a third-party warehouse or a freight forwarder. '
  'Inferring sites from ship-tos is how a CRM ends up with 400 fictional plants.';

-- ---------------------------------------------------------------------------
-- People
--
-- One canonical human, shared by IAM and account master (ADR-0020). Employment and
-- contact roles are affiliation rows with dates, never booleans on the person: a
-- salesperson who moves from a customer to a competitor is one person with two
-- affiliations, and the history is the valuable part.
-- ---------------------------------------------------------------------------
CREATE TABLE party.person (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),

  -- Mastered fields, all personal data (ADR-0027). Erasure blanks these and keeps the
  -- row, because affiliations and audit references must continue to resolve.
  given_name        text,
  family_name       text,
  -- What the person is actually called, where it differs. Sources routinely disagree.
  display_name      text NOT NULL,
  job_title         text,
  email             text,
  phone             text,
  mobile_phone      text,
  linkedin_url      text,

  -- A case-and-dot-normalized form of the email, for blocking during matching. Not
  -- unique: shared mailboxes are real, and two people at info@ is not a data error.
  email_normalized  text,

  lifecycle_status  text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','LEFT','DECEASED','ERASED')),
  merged_into_id    uuid REFERENCES party.person (id),
  merged_at         timestamptz,

  -- Set when a subject exercises a right to erasure. The row survives; the personal
  -- fields do not (ADR-0027, acceptance criterion 27).
  erased_at         timestamptz,

  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,

  CONSTRAINT merged_person_has_target CHECK ((merged_into_id IS NULL) = (merged_at IS NULL)),
  CONSTRAINT person_not_merged_into_itself CHECK (merged_into_id <> id),
  CONSTRAINT erased_person_is_blank CHECK (
    erased_at IS NULL OR (given_name IS NULL AND family_name IS NULL
                          AND email IS NULL AND phone IS NULL AND mobile_phone IS NULL
                          AND linkedin_url IS NULL))
);
CREATE INDEX person_email_idx ON party.person (email_normalized)
  WHERE email_normalized IS NOT NULL AND merged_into_id IS NULL;
CREATE INDEX person_name_trgm_idx ON party.person USING gin (display_name gin_trgm_ops);

COMMENT ON TABLE party.person IS
  'One canonical human, shared by IAM and account master (ADR-0007, ADR-0020). '
  'Erasure blanks the personal fields and keeps the row so references resolve.';
COMMENT ON CONSTRAINT erased_person_is_blank ON party.person IS
  'Erasure is enforced by the database, not by remembering to call the right function.';

CREATE TABLE party.person_affiliation (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  person_id         uuid NOT NULL REFERENCES party.person (id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES party.organization (id),
  -- Where the person actually works, when known and when it matters.
  site_id           uuid REFERENCES party.site (id),
  affiliation_code  kernel.code_key NOT NULL REFERENCES party.affiliation_type (code),

  job_title         text,
  -- Contact details that belong to the ROLE rather than the person: a work number
  -- that stays with the job when the person leaves.
  work_email        text,
  work_phone        text,

  valid_from        date,
  valid_to          date,
  is_primary        boolean NOT NULL DEFAULT false,

  source_system_code kernel.code_key REFERENCES kernel.source_system (code),
  source_record_id   uuid REFERENCES ingest.source_record (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT affiliation_dates_ordered CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX person_affiliation_current_idx
  ON party.person_affiliation (person_id, organization_id, affiliation_code)
  WHERE valid_to IS NULL;
CREATE UNIQUE INDEX person_primary_affiliation_idx
  ON party.person_affiliation (person_id) WHERE is_primary AND valid_to IS NULL;
CREATE INDEX person_affiliation_organization_idx
  ON party.person_affiliation (organization_id) WHERE valid_to IS NULL;

COMMENT ON TABLE party.person_affiliation IS
  'A person''s relationship to an organization over a period. Never a boolean on the '
  'person: someone who moves from a customer to a competitor is one person with two '
  'affiliations, and that history is the valuable part (ADR-0007).';

-- ---------------------------------------------------------------------------
-- Source links: which source records this canonical entity was built from
--
-- Merge and unmerge work by MOVING these links, not by rewriting canonical rows
-- (ADR-0012). That is what makes an unmerge an exact reversal rather than a
-- reconstruction from audit logs.
-- ---------------------------------------------------------------------------
CREATE TABLE party.source_link (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  entity_type       text NOT NULL
    CHECK (entity_type IN ('ORGANIZATION','SITE','LOCATION','PERSON','COMMERCIAL_ACCOUNT')),
  entity_id         uuid NOT NULL,
  source_record_id  uuid NOT NULL REFERENCES ingest.source_record (id),

  -- How this link came to exist, which is what an explainable match report is built
  -- from (ADR-0025).
  match_method      text NOT NULL DEFAULT 'MANUAL'
    CHECK (match_method IN ('MANUAL','DETERMINISTIC','PROBABILISTIC','IMPORTED','MERGED')),
  match_score       numeric(5,4) CHECK (match_score BETWEEN 0 AND 1),
  match_explanation jsonb,

  -- Set when a merge moved this link. Unmerge reads it to put the link back exactly
  -- where it was, which is why it records the previous owner rather than just a flag.
  moved_from_entity_id uuid,
  moved_by_merge_id    uuid,

  linked_at         timestamptz NOT NULL DEFAULT now(),
  linked_by         uuid,

  CONSTRAINT source_link_unique UNIQUE (entity_type, source_record_id)
);
CREATE INDEX source_link_entity_idx ON party.source_link (entity_type, entity_id);

COMMENT ON TABLE party.source_link IS
  'The join between a canonical entity and the source records it was built from. '
  'Merge moves these links; unmerge moves them back. One source record links to at '
  'most one entity of a given type, which is what makes the movement reversible.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT USAGE ON SCHEMA party TO fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA party TO fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT USAGE ON SCHEMA party TO fsw_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA party TO fsw_readonly;
  END IF;
END;
$$;
