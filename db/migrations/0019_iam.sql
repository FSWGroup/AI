-- Identity and access (ADR-0019, ADR-0020, spec §12, §13).
--
-- Two decisions are baked into this schema and are worth stating before the tables.
--
-- IDENTITY IS (issuer, subject), NEVER EMAIL. People change names, companies change
-- domains, and addresses get reused by the next employee. An email is stored here only
-- as a human-readable note of what it was at the moment the identity was linked, and
-- nothing ever looks a person up by it.
--
-- MULTI-ISSUER FROM THE START. Whether FSW standardises on Entra or Google is
-- unanswered (question G1), and Welsford and ValveMan may not share a directory (G2).
-- Building for one issuer would bake UNIQUE(subject) into the schema and into every
-- consumer's assumptions; supporting several is a small amount of work now and a
-- painful retrofit later. It is also the mechanism acceptance criterion 1 needs: one
-- human with an identity in each tenant is ONE person, not two.
--
-- No passwords are stored anywhere in this schema and none ever will be. MFA, password
-- reset and lockout are the identity provider's job (§80).

CREATE SCHEMA IF NOT EXISTS iam;
COMMENT ON SCHEMA iam IS
  'Principals, identities, roles, permissions and scopes. The authoritative directory '
  'a future FSW application asks "who is this and what may they do" (ADR-0019).';

-- ---------------------------------------------------------------------------
-- Trusted issuers
-- ---------------------------------------------------------------------------
CREATE TABLE iam.issuer (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  -- The `iss` claim, matched exactly. Not a prefix, not a hostname.
  issuer_url        text NOT NULL UNIQUE,
  name              text NOT NULL,
  jwks_uri          text NOT NULL,
  -- Accepted `aud` values. A token minted for another audience is not for us, however
  -- valid its signature.
  audiences         text[] NOT NULL CHECK (cardinality(audiences) > 0),
  -- Entra returns a tenant in `tid`. Empty means any tenant this issuer vouches for.
  allowed_tenant_ids text[] NOT NULL DEFAULT '{}',

  -- Whether a first-time authentication may create a person. Off by default: an issuer
  -- that can mint people is a serious grant, and it should be a deliberate one.
  jit_enabled       boolean NOT NULL DEFAULT false,
  -- Verified email domains JIT will accept. Empty with jit_enabled is refused by the
  -- application: "any domain this issuer will sign for" is not an allow-list.
  jit_email_domains text[] NOT NULL DEFAULT '{}',
  -- The operating company a JIT-provisioned person is affiliated with. Roles are NOT
  -- granted on creation — authentication is not authorization.
  default_operating_company kernel.code_key REFERENCES kernel.operating_company (code),

  -- Tolerance for clock skew between us and the issuer, in seconds.
  clock_skew_seconds integer NOT NULL DEFAULT 60 CHECK (clock_skew_seconds BETWEEN 0 AND 300),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE iam.issuer IS
  'Identity providers we trust, and exactly how far. Adding Google Workspace alongside '
  'Entra is a row here, not a code change (ADR-0020).';
COMMENT ON COLUMN iam.issuer.jit_enabled IS
  'Just-in-time provisioning. Off by default, and constrained by jit_email_domains: a '
  'misconfigured issuer that could mint people is the main risk this feature carries.';

-- ---------------------------------------------------------------------------
-- Principals: everything that acts
-- ---------------------------------------------------------------------------
CREATE TABLE iam.principal (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  principal_type    text NOT NULL CHECK (principal_type IN ('PERSON','SERVICE')),
  -- Exactly one of these, enforced below. A person-principal is backed by the same
  -- party.person row the account master uses: one canonical human, shared (ADR-0007).
  person_id         uuid UNIQUE REFERENCES party.person (id),
  -- What to call this principal in an audit entry. For a person this is a cached
  -- display name; the authoritative one is on party.person.
  label             text NOT NULL,

  is_active         boolean NOT NULL DEFAULT true,
  -- Set when access is withdrawn. The row is kept: audit entries reference it, and a
  -- principal that vanished would make its own history unreadable.
  deactivated_at    timestamptz,
  deactivated_reason text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT person_principal_has_person CHECK (
    (principal_type = 'PERSON') = (person_id IS NOT NULL)),
  CONSTRAINT deactivation_has_reason CHECK (
    (deactivated_at IS NULL) = (deactivated_reason IS NULL)),
  CONSTRAINT inactive_principal_is_deactivated CHECK (is_active OR deactivated_at IS NOT NULL)
);
CREATE INDEX principal_active_idx ON iam.principal (principal_type) WHERE is_active;

COMMENT ON TABLE iam.principal IS
  'The unified subject of every action: a person or a service account. Everything that '
  'writes has exactly one, so every change in the audit log has an accountable actor.';

-- ---------------------------------------------------------------------------
-- Identities: how a person authenticates
-- ---------------------------------------------------------------------------
CREATE TABLE iam.identity (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  person_id         uuid NOT NULL REFERENCES party.person (id) ON DELETE CASCADE,
  issuer_id         uuid NOT NULL REFERENCES iam.issuer (id),
  -- The `sub` claim. Opaque, permanent, and the actual identity.
  subject           text NOT NULL,
  tenant_id         text,

  -- What the token said at link time. A HINT for a human reading the admin screen, and
  -- nothing else: no lookup, no join, no matching uses these.
  email_at_link     text,
  display_name_at_link text,

  linked_at         timestamptz NOT NULL DEFAULT now(),
  linked_by         uuid,
  last_seen_at      timestamptz,
  disabled_at       timestamptz,
  disabled_reason   text,

  CONSTRAINT identity_unique UNIQUE (issuer_id, subject)
);
CREATE INDEX identity_person_idx ON iam.identity (person_id) WHERE disabled_at IS NULL;

COMMENT ON TABLE iam.identity IS
  'One row per (issuer, subject). A person may hold several — which is exactly how one '
  'human who exists in both a Welsford tenant and a ValveMan tenant remains one person '
  '(acceptance criterion 1).';
COMMENT ON COLUMN iam.identity.email_at_link IS
  'What the token said when this identity was linked. A human-readable hint only: '
  'nothing looks a person up by email, because email is not identity (§12).';

/**
 * A first authentication that could not be resolved or provisioned.
 *
 * The alternative to this table is silently refusing the login, which produces a
 * support ticket with no information in it. A pending request tells an administrator
 * exactly who tried, from where, and lets them link or refuse.
 */
CREATE TABLE iam.pending_link_request (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  issuer_id         uuid NOT NULL REFERENCES iam.issuer (id),
  subject           text NOT NULL,
  tenant_id         text,
  email_claimed     text,
  display_name_claimed text,
  email_verified    boolean NOT NULL DEFAULT false,
  reason            text NOT NULL,

  status            text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','LINKED','REFUSED','EXPIRED')),
  resolved_at       timestamptz,
  resolved_by       uuid,
  linked_person_id  uuid REFERENCES party.person (id),
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  attempt_count     integer NOT NULL DEFAULT 1,

  CONSTRAINT pending_link_unique UNIQUE (issuer_id, subject)
);
CREATE INDEX pending_link_open_idx ON iam.pending_link_request (status) WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Service accounts and machine credentials
-- ---------------------------------------------------------------------------
CREATE TABLE iam.service_account (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  principal_id      uuid NOT NULL UNIQUE REFERENCES iam.principal (id) ON DELETE CASCADE,
  key               kernel.machine_key NOT NULL UNIQUE,
  description       text NOT NULL,
  -- Who to ask when it misbehaves. A service account with no owner becomes a mystery
  -- nobody dares disable.
  owner_note        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE iam.service_account IS
  'A principal with no person: a connector, the dispatcher, a future application. Every '
  'automated write has an accountable identity rather than appearing as "the system".';

CREATE TABLE iam.api_credential (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  principal_id      uuid NOT NULL REFERENCES iam.principal (id) ON DELETE CASCADE,
  -- The public half, sent with every request so the right hash can be found without
  -- hashing against every row.
  credential_id     text NOT NULL UNIQUE,
  -- Argon2id. The secret itself is returned exactly once, at creation, and is never
  -- stored, logged, or recoverable (§62).
  secret_hash       text NOT NULL,
  hash_algorithm    text NOT NULL DEFAULT 'argon2id' CHECK (hash_algorithm = 'argon2id'),

  label             text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  expires_at        timestamptz NOT NULL,
  last_used_at      timestamptz,
  revoked_at        timestamptz,
  revoked_reason    text,
  -- Overlapping rotation: the replacement points at what it replaces, both work until
  -- the old one expires, and nothing needs a downtime window.
  rotated_from_id   uuid REFERENCES iam.api_credential (id),

  CONSTRAINT credential_expires_after_creation CHECK (expires_at > created_at),
  CONSTRAINT revocation_has_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX api_credential_principal_idx ON iam.api_credential (principal_id);
CREATE INDEX api_credential_expiring_idx ON iam.api_credential (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE iam.api_credential IS
  'Machine credentials. The secret is shown once and hashed with Argon2id; there is no '
  'recovery path, only rotation. API keys never satisfy a human authentication '
  'requirement (ADR-0020).';

-- ---------------------------------------------------------------------------
-- Permissions, roles and scopes (ADR-0019)
--
-- All data, not code. §12 names permissions-in-code as an anti-pattern, and it is
-- right: a permission that only exists in a deployed artefact cannot be reviewed by
-- the people whose access it governs.
-- ---------------------------------------------------------------------------
CREATE TABLE iam.permission (
  key               text PRIMARY KEY
    CONSTRAINT permission_format CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  resource          text NOT NULL,
  action            text NOT NULL,
  description       text NOT NULL,
  -- Which application owns it. A consuming app registers its permissions here rather
  -- than inventing them, so the catalogue stays the single list (ADR-0019).
  owning_component  text NOT NULL DEFAULT 'LAYER0',
  -- Permissions that should never be held casually: erasure, merge, identity admin.
  is_sensitive      boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO iam.permission (key, resource, action, description, is_sensitive) VALUES
  ('product.read',    'product',  'read',    'Read products, variants and their attributes.', false),
  ('product.write',   'product',  'write',   'Create and change products and variants.', false),
  ('product.publish', 'product',  'publish', 'Move a variant into a publishable lifecycle state.', false),
  ('metadata.read',   'metadata', 'read',    'Read attribute, vocabulary and product-type definitions.', false),
  ('metadata.write',  'metadata', 'write',   'Apply metadata configuration. Changes the meaning of existing values.', true),
  ('account.read',    'account',  'read',    'Read organizations, sites, accounts and contacts.', false),
  ('account.write',   'account',  'write',   'Assert values about organizations, sites and contacts.', false),
  ('account.merge',   'account',  'merge',   'Merge two organizations. Reversible, but disruptive.', true),
  ('account.unmerge', 'account',  'unmerge', 'Reverse a merge.', true),
  ('match.review',    'match',    'review',  'Decide candidate pairs in the entity-resolution queue.', false),
  ('ingest.run',      'ingest',   'run',     'Start an ingestion run.', false),
  ('ingest.approve',  'ingest',   'approve', 'Approve a changed source structure. Read the change first.', true),
  ('quarantine.read', 'quarantine','read',   'Read quarantined records, which routinely contain personal data.', false),
  ('quarantine.resolve','quarantine','resolve','Resolve or retry a quarantined record.', false),
  ('event.read',      'event',    'read',    'Read the domain event feed.', false),
  ('audit.read',      'audit',    'read',    'Read the audit log.', true),
  ('identity.admin',  'identity', 'admin',   'Manage principals, identities, roles and credentials.', true),
  ('pii.read',        'pii',      'read',    'Read personal data beyond what a name and role require.', true),
  ('pii.erase',       'pii',      'erase',   'Erase a data subject. Irreversible by design.', true);

CREATE TABLE iam.role (
  key               kernel.machine_key PRIMARY KEY,
  name              text NOT NULL,
  description       text NOT NULL,
  -- A role that may only be assigned within one operating company, never group-wide.
  is_company_scoped boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO iam.role (key, name, description, is_company_scoped) VALUES
  ('reader',          'Reader',           'Read products and accounts within scope.', true),
  ('product_editor',  'Product editor',   'Maintain the catalogue within scope.', true),
  ('data_steward',    'Data steward',     'Work the match queue and the quarantine, and correct mastered values.', true),
  ('metadata_admin',  'Metadata administrator', 'Change attribute and vocabulary definitions. Group-wide by nature.', false),
  ('integration',     'Integration',      'Run ingestion and read the event feed. For service accounts.', true),
  ('privacy_officer', 'Privacy officer',  'Read personal data and carry out erasure. Group-wide by nature.', false),
  ('identity_admin',  'Identity administrator', 'Manage principals, roles and credentials.', false),
  ('auditor',         'Auditor',          'Read the audit log and the event feed. Reads nothing else.', false);

CREATE TABLE iam.role_permission (
  role_key          kernel.machine_key NOT NULL REFERENCES iam.role (key) ON DELETE CASCADE,
  permission_key    text NOT NULL REFERENCES iam.permission (key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

INSERT INTO iam.role_permission (role_key, permission_key) VALUES
  ('reader','product.read'), ('reader','metadata.read'), ('reader','account.read'),
  ('product_editor','product.read'), ('product_editor','product.write'),
  ('product_editor','product.publish'), ('product_editor','metadata.read'),
  ('data_steward','product.read'), ('data_steward','account.read'),
  ('data_steward','account.write'), ('data_steward','account.merge'),
  ('data_steward','account.unmerge'), ('data_steward','match.review'),
  ('data_steward','quarantine.read'), ('data_steward','quarantine.resolve'),
  ('data_steward','metadata.read'),
  ('metadata_admin','metadata.read'), ('metadata_admin','metadata.write'),
  ('metadata_admin','product.read'),
  ('integration','ingest.run'), ('integration','ingest.approve'),
  ('integration','event.read'), ('integration','product.read'), ('integration','account.read'),
  ('privacy_officer','pii.read'), ('privacy_officer','pii.erase'),
  ('privacy_officer','account.read'), ('privacy_officer','audit.read'),
  ('identity_admin','identity.admin'), ('identity_admin','audit.read'),
  ('auditor','audit.read'), ('auditor','event.read');

/**
 * Role assignments, each carrying its scope.
 *
 * The scope is what acceptance criterion 2 turns on. One person can be a product editor
 * at ValveMan and a reader at Welsford, and a ValveMan-only principal must not see a
 * Welsford-only row — not "be refused when they ask for it", but not have it returned.
 */
CREATE TABLE iam.principal_role_assignment (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  principal_id      uuid NOT NULL REFERENCES iam.principal (id) ON DELETE CASCADE,
  role_key          kernel.machine_key NOT NULL REFERENCES iam.role (key),

  scope_type        text NOT NULL
    CHECK (scope_type IN ('FSW_GROUP','OPERATING_COMPANY','DOMAIN')),
  -- The operating company code, or the domain name. Null only for FSW_GROUP.
  scope_id          text,

  granted_at        timestamptz NOT NULL DEFAULT now(),
  granted_by        uuid,
  granted_reason    text,
  -- Access reviews expire assignments rather than trusting anyone to remember.
  expires_at        timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid,
  revoked_reason    text,

  CONSTRAINT group_scope_has_no_id CHECK (
    (scope_type = 'FSW_GROUP') = (scope_id IS NULL)),
  CONSTRAINT revocation_has_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE UNIQUE INDEX principal_role_scope_idx
  ON iam.principal_role_assignment (principal_id, role_key, coalesce(scope_id, '*'))
  WHERE revoked_at IS NULL;
CREATE INDEX principal_role_lookup_idx
  ON iam.principal_role_assignment (principal_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE iam.principal_role_assignment IS
  'What a principal may do, and where. Scope is per assignment, so "product editor at '
  'ValveMan, reader at Welsford" is two rows rather than a special case (ADR-0019).';

-- ---------------------------------------------------------------------------
-- Denials
--
-- Recorded, and deliberately in their own table rather than in audit.change_log: a
-- denial is not a change, and burying refusals among writes is how nobody notices a
-- credential probing endpoints for an hour.
-- ---------------------------------------------------------------------------
CREATE TABLE iam.access_denial (
  id                uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
  principal_id      uuid REFERENCES iam.principal (id),
  -- Present when the caller could not even be identified, which is itself worth seeing.
  attempted_subject text,
  permission_key    text,
  scope_type        text,
  scope_id          text,
  resource_kind     text,
  resource_id       text,
  -- Why, in terms a person can act on: no such permission, out of scope, principal
  -- inactive, credential expired.
  reason            text NOT NULL,
  interface         text NOT NULL,
  correlation_id    uuid,
  client_ip         inet,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_denial_principal_idx ON iam.access_denial (principal_id, occurred_at DESC);
CREATE INDEX access_denial_time_idx ON iam.access_denial (occurred_at DESC);

COMMENT ON TABLE iam.access_denial IS
  'Every refused authorization. Acceptance criterion 2 requires the denial to be '
  'auditable, and a refusal rate is one of the few genuinely useful security signals a '
  'system this size can produce.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') THEN
    GRANT USAGE ON SCHEMA iam TO fsw_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam TO fsw_app;
    -- Denials are evidence: append-only, like the event ledger.
    REVOKE UPDATE, DELETE ON iam.access_denial FROM fsw_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_readonly') THEN
    GRANT USAGE ON SCHEMA iam TO fsw_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA iam TO fsw_readonly;
    -- The readonly role is for analytics and support. Credential hashes are not for it,
    -- however useless an Argon2id hash is to an attacker who already has database read.
    REVOKE SELECT ON iam.api_credential FROM fsw_readonly;
  END IF;
END;
$$;
