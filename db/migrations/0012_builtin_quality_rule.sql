-- The product-type requirement rule is evaluated by the engine itself, from
-- pim.product_type_attribute, rather than from a configured parameter list. It still
-- needs a row here, because every finding names the rule that produced it and that
-- reference is a foreign key.
--
-- System rules are owned by the code, not by configuration, so the metadata loader
-- must not deactivate them for being absent from config/metadata.

ALTER TABLE pim.quality_rule
  ADD COLUMN is_system boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pim.quality_rule.is_system IS
  'True for rules the evaluator implements directly. The metadata loader leaves them '
  'alone: they are not absent from configuration, they were never in it.';

ALTER TABLE pim.quality_rule
  DROP CONSTRAINT quality_rule_rule_kind_check,
  ADD CONSTRAINT quality_rule_rule_kind_check CHECK (rule_kind IN (
    'REQUIRED_ATTRIBUTES','CONDITIONAL_ATTRIBUTES','INVALID_COMBINATION',
    'MISSING_IDENTIFIER','NUMERIC_RANGE','MISSING_ASSET','MISSING_CERTIFICATION',
    'PRODUCT_TYPE_REQUIREMENTS'));

INSERT INTO pim.quality_rule
  (key, name, description, channel_code, product_type_key, severity, rule_kind,
   parameters, is_system)
VALUES (
  'product_type_requirements',
  'Product type requirements',
  'Every attribute a product type marks REQUIRED (blocking) or RECOMMENDED (warning), '
  'including attributes that become applicable only when a condition holds -- voltage '
  'on an electrically actuated valve, air supply pressure on a pneumatic one. Derived '
  'from config/metadata/product-types rather than configured here.',
  NULL, NULL, 'BLOCKING', 'PRODUCT_TYPE_REQUIREMENTS', '{}'::jsonb, true
)
ON CONFLICT (key) DO NOTHING;
