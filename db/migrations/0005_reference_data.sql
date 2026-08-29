-- Reference data that other tables take foreign keys against. Structural, so it
-- lives in a migration rather than in the metadata configuration loaded by
-- tools/metadata.ts (ADR-0017).

INSERT INTO kernel.operating_company (code, name, is_group) VALUES
  ('FSW_GROUP', 'FSW Group',   true),
  ('WELSFORD',  'Welsford Co.', false),
  ('VALVEMAN',  'ValveMan.com', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO kernel.source_system (code, name, kind, description, contains_pii, default_priority) VALUES
  ('MANUAL',        'Manual entry',          'MANUAL',
   'A human asserting a value through the admin UI or API. Recorded as a candidate '
   'value like any other source, which is what keeps merges reversible (ADR-0011).',
   true,  10),
  ('P21',           'Epicor Prophet 21',     'ERP',
   'Current cloud-hosted Prophet 21. Enters through approved file exports; no API '
   'access is available to this project (ADR-0023).',
   true,  20),
  ('PIPEDRIVE',     'Pipedrive CRM',         'CRM',
   'Current CRM. API is authoritative; webhooks are hints only (ADR-0024).',
   true,  30),
  ('VALVEMAN_STORE','ValveMan.com storefront','ECOMMERCE',
   'National B2B ecommerce storefront. Product content and web customer records.',
   true,  40),
  ('MFR_CATALOG',   'Manufacturer catalogue','CATALOG',
   'Manufacturer-supplied product data: price files, spec sheets, exchange formats.',
   false, 50),
  ('MODEL_PARSER',  'Model number parser',   'DERIVED',
   'Attributes interpreted from a manufacturer model number. Never overrides '
   'verified data; conflicts are recorded (spec §36).',
   false, 90),
  ('FSW_LAYER0',    'FSW Layer 0',           'INTERNAL',
   'Facts Layer 0 itself owns: canonical identity, merges, resolved relationships.',
   false, 1)
ON CONFLICT (code) DO NOTHING;
