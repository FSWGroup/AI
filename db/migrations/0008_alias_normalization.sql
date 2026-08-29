-- Widen alias normalization to preserve '/', '.' and '-'.
--
-- Migration 0007 normalized by stripping every non-alphanumeric character, which made
-- the nominal size alias '1/2' collide with '12': NPS 1/2 and NPS 12 became the same
-- lookup key. That is a silent, consequential data error -- a half-inch valve
-- resolving to a twelve-inch designation -- so the normalization has to keep the
-- characters that carry meaning in engineering designations.
--
-- 0006 is applied and therefore immutable (ADR-0006). This is the forward migration.
--
-- A STORED generated column's expression cannot be altered in place, so the column is
-- dropped and re-added, taking its indexes with it.

ALTER TABLE pim.unit_alias DROP COLUMN normalized_alias;
ALTER TABLE pim.unit_alias
  ADD COLUMN normalized_alias text GENERATED ALWAYS AS
    (upper(regexp_replace(alias, '[^a-zA-Z0-9/.-]', '', 'g'))) STORED;
CREATE UNIQUE INDEX unit_alias_unique ON pim.unit_alias (normalized_alias);

ALTER TABLE pim.vocabulary_term_alias DROP COLUMN normalized_alias;
ALTER TABLE pim.vocabulary_term_alias
  ADD COLUMN normalized_alias text GENERATED ALWAYS AS
    (upper(regexp_replace(alias, '[^a-zA-Z0-9/.-]', '', 'g'))) STORED;

CREATE UNIQUE INDEX vocabulary_term_alias_definitive
  ON pim.vocabulary_term_alias (vocabulary_key, normalized_alias)
  WHERE asserts_equivalence;
CREATE INDEX vocabulary_term_alias_lookup
  ON pim.vocabulary_term_alias (normalized_alias);

COMMENT ON COLUMN pim.unit_alias.normalized_alias IS
  'Uppercased, with punctuation other than / . - removed. Those three are preserved '
  'because they carry meaning in engineering designations: 1/2 must not normalize to '
  'the same key as 12.';
COMMENT ON COLUMN pim.vocabulary_term_alias.normalized_alias IS
  'See pim.unit_alias.normalized_alias.';
