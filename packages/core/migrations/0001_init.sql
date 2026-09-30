-- Welsford Product Intelligence — core schema
-- Design rules:
--   * Every technical/commercial fact is a knowledge_assertion with assertion_evidence rows pointing at
--     versioned source_records. Nothing in `products`/`product_attributes` is answerable without evidence.
--   * Relationships (substitutes, compatibility, supersession) are explicit rows with evidence and approval.
--   * Channel/territory logic lives in rule tables compiled by the rule engine, not in prose.
--   * Fixture data is flagged at the source level (sources.is_fixture) and can never be mistaken for production.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Organizations, users, roles
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,          -- 'welsford' | 'valveman'
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id            text PRIMARY KEY,              -- 'admin','app_engineer','sales','cs','customer','public'
  description   text NOT NULL,
  permissions   text[] NOT NULL                -- 'view_cost','view_customer_pricing','review_knowledge','write_crm',...
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  role_id       text NOT NULL REFERENCES roles(id),
  customer_id   uuid,                          -- set for authenticated external customers
  api_key_hash  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Sales channels & territories
-- ---------------------------------------------------------------------------
CREATE TABLE sales_channels (
  id            text PRIMARY KEY,              -- 'welsford' | 'valveman'
  name          text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  channel_type  text NOT NULL CHECK (channel_type IN ('rep_distributor','ecommerce'))
);

CREATE TABLE territories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,          -- 'US-PA', 'US-NJ', 'US-DE', 'US-NATIONAL'
  name          text NOT NULL,
  country       text NOT NULL DEFAULT 'US',
  state         text,                          -- two-letter, NULL for national
  region_notes  text
);

-- ---------------------------------------------------------------------------
-- Manufacturer → family → series → product → variant → identifiers
-- ---------------------------------------------------------------------------
CREATE TABLE manufacturers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,          -- short stable code used in part-number prefixes
  name          text NOT NULL,
  website       text,
  aliases       text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_families (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid NOT NULL REFERENCES manufacturers(id),
  name          text NOT NULL,
  category      text NOT NULL,                 -- 'ball_valve','butterfly_valve','actuator_pneumatic',...
  UNIQUE (manufacturer_id, name)
);

CREATE TABLE product_series (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES product_families(id),
  manufacturer_id uuid NOT NULL REFERENCES manufacturers(id),
  code          text NOT NULL,                 -- 'S70'
  name          text NOT NULL,
  UNIQUE (manufacturer_id, code)
);

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid NOT NULL REFERENCES manufacturers(id),
  series_id     uuid REFERENCES product_series(id),
  family_id     uuid REFERENCES product_families(id),
  category      text NOT NULL,
  name          text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','discontinued','superseded','pending')),
  search_tsv    tsvector,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_tsv_idx ON products USING gin (search_tsv);

CREATE TABLE product_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- canonical SKU is the identity ValveMan/Welsford sell; identifiers table carries all aliases
  canonical_sku text NOT NULL UNIQUE,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','discontinued','superseded','pending')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- All identifiers, normalized. identifier_norm strips dashes/spaces/dots and upper-cases.
CREATE TABLE product_identifiers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN
    ('mfr_part_number','canonical_sku','shopify_sku','p21_item_id','upc','historical_part_number','superseded_part_number','competitor_part_number','alias')),
  identifier_raw  text NOT NULL,
  identifier_norm text NOT NULL,
  manufacturer_id uuid REFERENCES manufacturers(id),  -- for competitor numbers, the competitor
  is_primary    boolean NOT NULL DEFAULT false,
  source_record_id uuid,                              -- FK added after source_records
  UNIQUE (identifier_type, identifier_norm, variant_id)
);
CREATE INDEX product_identifiers_norm_idx ON product_identifiers (identifier_norm);
CREATE INDEX product_identifiers_norm_trgm_idx ON product_identifiers USING gin (identifier_norm gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Attribute definitions (core + category-specific) and attribute values
-- Values are NOT facts by themselves: each attribute row is backed by a knowledge_assertion.
-- ---------------------------------------------------------------------------
CREATE TABLE attribute_definitions (
  key           text PRIMARY KEY,              -- 'size_in','body_material','pressure_rating_psi',...
  label         text NOT NULL,
  data_type     text NOT NULL CHECK (data_type IN ('number','text','boolean','enum','range')),
  unit          text,
  scope         text NOT NULL DEFAULT 'core',  -- 'core' or category key
  criticality   integer NOT NULL DEFAULT 1 CHECK (criticality BETWEEN 1 AND 5),
  allowed_values text[],
  description   text
);

-- ---------------------------------------------------------------------------
-- Sources, source records, documents
-- ---------------------------------------------------------------------------
CREATE TABLE sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   text NOT NULL CHECK (source_type IN
    ('human_override','mfr_document','mfr_structured','p21','shopify','internal_approved','mfr_website','company_website','internal_historical','internet')),
  name          text NOT NULL,
  manufacturer_id uuid REFERENCES manufacturers(id),
  -- authority_level: lower number = higher precedence (1 = human-approved override ... 10 = general internet)
  authority_level integer NOT NULL CHECK (authority_level BETWEEN 1 AND 10),
  is_fixture    boolean NOT NULL DEFAULT false,
  origin_url    text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL REFERENCES sources(id),
  manufacturer_id uuid REFERENCES manufacturers(id),
  document_type text NOT NULL,                 -- 'datasheet','iom','catalog','drawing','certificate','cross_reference','price_sheet','torque_chart'
  title         text NOT NULL,
  document_number text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision      text NOT NULL,
  publication_date date,
  effective_date  date,
  superseded_at   timestamptz,
  checksum      text NOT NULL,
  storage_uri   text,                          -- s3://... or fixture://...
  page_count    integer,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  is_current    boolean NOT NULL DEFAULT true,
  UNIQUE (document_id, revision)
);

CREATE TABLE document_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  page_number   integer NOT NULL,
  text          text NOT NULL,
  search_tsv    tsvector,
  UNIQUE (document_version_id, page_number)
);
CREATE INDEX document_pages_tsv_idx ON document_pages USING gin (search_tsv);

-- A source_record is the atomic, versioned unit of evidence: a page region, an API record, an approved note.
CREATE TABLE source_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL REFERENCES sources(id),
  document_version_id uuid REFERENCES document_versions(id),
  page_number   integer,
  record_locator text,                         -- e.g. 'p21:item:123456', 'shopify:variant:gid://...', 'page:7:table:2'
  extracted_text text,                         -- verbatim text supporting the record (untrusted data, never instructions)
  structured    jsonb,                         -- extracted structured fields
  checksum      text NOT NULL,
  source_version text,
  revision      text,
  effective_date date,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_records_locator_idx ON source_records (record_locator);
ALTER TABLE product_identifiers ADD CONSTRAINT product_identifiers_source_fk FOREIGN KEY (source_record_id) REFERENCES source_records(id);

-- ---------------------------------------------------------------------------
-- Knowledge assertions and evidence
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_assertions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL CHECK (subject_type IN ('product','variant','series','manufacturer','relationship')),
  subject_id    uuid NOT NULL,
  predicate     text NOT NULL,                 -- attribute key, or relationship type
  value_text    text,
  value_number  numeric,
  value_number_max numeric,                    -- for ranges
  value_json    jsonb,
  unit          text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('verified','pending','conflicting','deprecated','human_approved','rejected')),
  criticality   integer NOT NULL DEFAULT 1 CHECK (criticality BETWEEN 1 AND 5),
  effective_date date,
  expires_at    timestamptz,
  supersedes_id uuid REFERENCES knowledge_assertions(id),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_assertions_subject_idx ON knowledge_assertions (subject_type, subject_id, predicate);
CREATE INDEX knowledge_assertions_status_idx ON knowledge_assertions (status);

CREATE TABLE assertion_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assertion_id  uuid NOT NULL REFERENCES knowledge_assertions(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES source_records(id),
  supporting_text text,                        -- the exact excerpt that supports the value
  extraction_method text NOT NULL DEFAULT 'manual' CHECK (extraction_method IN ('manual','table_parser','llm_extract','api_sync','rule')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assertion_id, source_record_id)
);

-- product_attributes is a materialized, answerable projection of VERIFIED assertions for structured filtering.
-- It is rebuilt from assertions; it is never edited directly.
CREATE TABLE product_attributes (
  variant_id    uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  attribute_key text NOT NULL REFERENCES attribute_definitions(key),
  assertion_id  uuid NOT NULL REFERENCES knowledge_assertions(id) ON DELETE CASCADE,
  value_text    text,
  value_number  numeric,
  value_number_max numeric,
  unit          text,
  PRIMARY KEY (variant_id, attribute_key)
);
CREATE INDEX product_attributes_key_num_idx ON product_attributes (attribute_key, value_number);
CREATE INDEX product_attributes_key_text_idx ON product_attributes (attribute_key, value_text);

-- ---------------------------------------------------------------------------
-- Relationships (explicit, evidenced, approved)
-- ---------------------------------------------------------------------------
CREATE TABLE product_relationships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  to_variant_id   uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN
    ('compatible_with','approved_substitute_for','technically_similar_to','requires_accessory','assembled_with',
     'actuated_by','mounted_with','replaces','superseded_by','possible_match_needs_review')),
  -- who approved: distinguishes MANUFACTURER-approved vs WELSFORD-approved substitutes
  approval_authority text CHECK (approval_authority IN ('manufacturer','welsford','none')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('verified','pending','human_approved','rejected','deprecated')),
  notes         text,
  conditions    jsonb,                          -- e.g. {"requires":"mounting kit MK-2"}
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_variant_id, to_variant_id, relationship_type)
);

CREATE TABLE relationship_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES product_relationships(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES source_records(id),
  supporting_text text,
  UNIQUE (relationship_id, source_record_id)
);

-- ---------------------------------------------------------------------------
-- Channel & territory rules (compiled business logic)
-- ---------------------------------------------------------------------------
CREATE TABLE channel_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    text NOT NULL REFERENCES sales_channels(id),
  scope_type    text NOT NULL CHECK (scope_type IN ('manufacturer','family','series','variant')),
  scope_id      uuid NOT NULL,
  rule_type     text NOT NULL CHECK (rule_type IN
    ('authorized','not_authorized','rfq_only','ecommerce','pricing_visible','pricing_login_required','requires_approval')),
  territory_code text,                         -- NULL = applies everywhere the channel operates
  customer_class text,                         -- NULL = all customer classes
  priority      integer NOT NULL DEFAULT 100,  -- lower wins on conflict
  source_record_id uuid REFERENCES source_records(id),
  notes         text,
  effective_date date,
  expires_at    timestamptz
);
CREATE INDEX channel_rules_scope_idx ON channel_rules (scope_type, scope_id, channel_id);

-- ---------------------------------------------------------------------------
-- Commercial: customers, pricing, inventory (projections of ERP/ecommerce sources)
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  p21_customer_id text UNIQUE,
  shopify_customer_id text UNIQUE,
  name          text NOT NULL,
  customer_class text,
  state         text,
  channel_id    text REFERENCES sales_channels(id),
  salesperson   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD CONSTRAINT users_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE TABLE customer_pricing (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid REFERENCES customers(id),    -- NULL = list/channel price
  channel_id    text NOT NULL REFERENCES sales_channels(id),
  variant_id    uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  price_type    text NOT NULL CHECK (price_type IN ('list','customer_contract','ecommerce','cost')),
  system        text NOT NULL CHECK (system IN ('p21','shopify')),
  unit_price    numeric(14,4) NOT NULL,
  currency      text NOT NULL DEFAULT 'USD',
  uom           text NOT NULL DEFAULT 'EA',
  source_record_id uuid NOT NULL REFERENCES source_records(id),
  as_of         timestamptz NOT NULL
);
CREATE UNIQUE INDEX customer_pricing_unique_idx ON customer_pricing (system, channel_id, variant_id, price_type, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE inventory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  system        text NOT NULL CHECK (system IN ('p21','shopify')),
  location_code text NOT NULL,
  qty_on_hand   numeric NOT NULL,
  qty_committed numeric NOT NULL DEFAULT 0,
  qty_available numeric NOT NULL,
  qty_on_order  numeric NOT NULL DEFAULT 0,
  lead_time_days integer,
  source_record_id uuid NOT NULL REFERENCES source_records(id),
  as_of         timestamptz NOT NULL,
  UNIQUE (variant_id, system, location_code)
);

-- ---------------------------------------------------------------------------
-- System mappings & sync
-- ---------------------------------------------------------------------------
CREATE TABLE shopify_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id text NOT NULL,
  shopify_variant_id text NOT NULL UNIQUE,
  shopify_sku   text,
  variant_id    uuid REFERENCES product_variants(id),
  handle        text,
  title         text,
  vendor        text,
  product_type  text,
  status        text,
  tags          text[],
  price         numeric(14,4),
  compare_at_price numeric(14,4),
  inventory_quantity integer,
  raw           jsonb NOT NULL,
  mapping_status text NOT NULL DEFAULT 'unmapped' CHECK (mapping_status IN ('mapped','unmapped','ambiguous','conflict')),
  last_synced_at timestamptz NOT NULL
);

CREATE TABLE p21_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  p21_item_id   text NOT NULL UNIQUE,
  p21_inv_mast_uid text,
  variant_id    uuid REFERENCES product_variants(id),
  item_desc     text,
  supplier_part_number text,
  manufacturer_name text,
  uom           text,
  raw           jsonb NOT NULL,
  mapping_status text NOT NULL DEFAULT 'unmapped' CHECK (mapping_status IN ('mapped','unmapped','ambiguous','conflict')),
  last_synced_at timestamptz NOT NULL
);

CREATE TABLE sync_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system        text NOT NULL,
  job_type      text NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('fixture','live')),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  started_at    timestamptz,
  finished_at   timestamptz,
  stats         jsonb,
  error         text
);

CREATE TABLE sync_conflicts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id   uuid REFERENCES sync_jobs(id),
  conflict_type text NOT NULL,   -- 'unmapped_sku','duplicate_sku','manufacturer_mismatch','description_mismatch','price_discrepancy','missing_product','uom_conflict'
  variant_id    uuid REFERENCES product_variants(id),
  shopify_variant_id text,
  p21_item_id   text,
  details       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Knowledge conflicts and human review
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_conflicts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL,
  subject_id    uuid NOT NULL,
  predicate     text NOT NULL,
  assertion_ids uuid[] NOT NULL,
  description   text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_assertion_id uuid REFERENCES knowledge_assertions(id),
  resolved_by   uuid REFERENCES users(id),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_conflicts_subject_idx ON knowledge_conflicts (subject_type, subject_id, predicate) WHERE status = 'open';

CREATE TABLE knowledge_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_type   text NOT NULL CHECK (review_type IN
    ('new_relationship','source_conflict','possible_substitution','missing_attribute','ambiguous_mapping',
     'document_revision','taxonomy_change','stale_evidence','low_confidence_assertion','answer_correction','escalation')),
  target_type   text NOT NULL,   -- 'assertion','relationship','conflict','mapping','answer','document_version'
  target_id     uuid,
  summary       text NOT NULL,
  payload       jsonb,
  priority      integer NOT NULL DEFAULT 3,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','corrected','superseded','closed')),
  assigned_to   uuid REFERENCES users(id),
  decided_by    uuid REFERENCES users(id),
  decision_note text,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     uuid NOT NULL REFERENCES knowledge_reviews(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id),
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE human_escalations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id  uuid,
  reason        text NOT NULL,
  criticality   integer NOT NULL,
  question      text NOT NULL,
  known_facts   jsonb,
  unknowns      jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  answered_by   uuid REFERENCES users(id),
  answer        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RFQs, quotes, opportunities
-- ---------------------------------------------------------------------------
CREATE TABLE rfqs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    text REFERENCES sales_channels(id),
  customer_id   uuid REFERENCES customers(id),
  source_kind   text NOT NULL CHECK (source_kind IN ('email','pdf','excel','csv','text','api')),
  raw_text      text NOT NULL,
  status        text NOT NULL DEFAULT 'extracted' CHECK (status IN ('extracted','review','verified','quoted','closed')),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rfq_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id        uuid NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,
  raw_line      text NOT NULL,
  quantity      numeric,
  manufacturer_text text,
  part_number_text text,
  description_text text,
  required_attributes jsonb,
  candidate_variant_id uuid REFERENCES product_variants(id),
  match_type    text CHECK (match_type IN ('exact','normalized','historical','competitor_xref','attribute','none')),
  confidence    text CHECK (confidence IN ('VERIFIED','NEEDS_REVIEW','INSUFFICIENT_EVIDENCE')),
  evidence      jsonb,
  questions     text[],
  review_required boolean NOT NULL DEFAULT true,
  UNIQUE (rfq_id, line_no)
);

CREATE TABLE quotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id        uuid REFERENCES rfqs(id),
  customer_id   uuid REFERENCES customers(id),
  channel_id    text NOT NULL REFERENCES sales_channels(id),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','sent','won','lost')),
  p21_quote_id  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quote_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,
  variant_id    uuid REFERENCES product_variants(id),
  quantity      numeric NOT NULL,
  unit_price    numeric(14,4),
  unit_cost     numeric(14,4),
  price_source_record_id uuid REFERENCES source_records(id),
  lead_time_days integer,
  notes         text
);

CREATE TABLE opportunities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid REFERENCES customers(id),
  quote_id      uuid REFERENCES quotes(id),
  title         text NOT NULL,
  crm_system    text DEFAULT 'pipedrive',
  crm_external_id text,
  status        text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','pushed','failed')),
  payload       jsonb,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Agent runs, claims, citations, traces
-- ---------------------------------------------------------------------------
CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent         text NOT NULL,                 -- 'ask','part_lookup','product_finder','cross_reference','rfq_bom','document_finder',...
  channel_id    text REFERENCES sales_channels(id),
  user_id       uuid REFERENCES users(id),
  role_id       text,
  mode          text NOT NULL DEFAULT 'interactive' CHECK (mode IN ('interactive','shadow','evaluation')),
  question      text NOT NULL,
  criticality   integer,
  outcome       text NOT NULL CHECK (outcome IN ('answered','partial','abstained','escalated','error')),
  confidence    text CHECK (confidence IN ('VERIFIED','NEEDS_REVIEW','INSUFFICIENT_EVIDENCE')),
  answer        jsonb,
  gate_report   jsonb,
  llm_used      boolean NOT NULL DEFAULT false,
  llm_model     text,
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  role          text NOT NULL,
  content       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  subject_ref   text NOT NULL,                  -- canonical SKU or entity ref
  predicate     text NOT NULL,
  value         text NOT NULL,
  criticality   integer NOT NULL,
  status        text NOT NULL CHECK (status IN ('verified','removed_unsupported','removed_conflict','removed_stale','removed_channel','removed_unapproved','assumption')),
  assertion_id  uuid REFERENCES knowledge_assertions(id),
  reason        text
);

CREATE TABLE citations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES source_records(id),
  supporting_text text,
  label         text NOT NULL
);

CREATE TABLE retrieval_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  stage         text NOT NULL,                  -- 'exact_identifier','mfr_identifier','alt_identifier','attribute_filter','relationship','fts','vector','rerank','evidence_validation','rule_filter'
  query         jsonb,
  result_count  integer NOT NULL,
  latency_ms    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------
CREATE TABLE evaluations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  dataset_version text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evaluation_cases (
  id            text PRIMARY KEY,               -- stable case id from golden dataset
  category      text NOT NULL,
  agent         text NOT NULL,
  criticality   integer NOT NULL,
  input         jsonb NOT NULL,
  expected      jsonb NOT NULL,
  is_regression boolean NOT NULL DEFAULT false,
  origin        text,                            -- 'golden','regression:<review_id>'
  dataset_version text NOT NULL
);

CREATE TABLE evaluation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version text NOT NULL,
  code_version  text,
  llm_model     text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  metrics       jsonb,
  passed_gate   boolean,
  results       jsonb
);

CREATE TABLE regression_cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_case_id text NOT NULL REFERENCES evaluation_cases(id),
  review_id     uuid REFERENCES knowledge_reviews(id),
  question      text NOT NULL,
  incorrect_output jsonb,
  corrected_answer jsonb,
  root_cause    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id),
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  details       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Triggers for search vectors
-- ---------------------------------------------------------------------------
CREATE FUNCTION products_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', coalesce(NEW.name,'') || ' ' || coalesce(NEW.description,'') || ' ' || coalesce(NEW.category,''));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER products_tsv_trg BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION products_tsv_update();

CREATE FUNCTION document_pages_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', coalesce(NEW.text,''));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER document_pages_tsv_trg BEFORE INSERT OR UPDATE ON document_pages FOR EACH ROW EXECUTE FUNCTION document_pages_tsv_update();
