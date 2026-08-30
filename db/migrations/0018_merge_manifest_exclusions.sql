-- Record what a merge must NOT move (ADR-0012).
--
-- The manifest tripwire — the test that fails when a table referencing
-- party.organization is unregistered — found two columns that legitimately reference an
-- organization and must never be re-pointed:
--
--   party.organization_merge.surviving_organization_id
--   party.organization_merge.merged_organization_id
--
-- These are the merge ledger's own bookkeeping. Re-pointing them during a LATER merge
-- would rewrite the record of an earlier one, and the unmerge that depends on it would
-- then restore rows to the wrong place. The bug would only appear in a chain — merge,
-- merge again, reverse the first — which is exactly the case least likely to be tried
-- by hand.
--
-- They are registered with an explicit NEVER_MOVE strategy rather than left out. An
-- omission is indistinguishable from an oversight; a row that says "deliberately not
-- moved, and here is why" is not.

ALTER TABLE party.merge_manifest DROP CONSTRAINT merge_manifest_strategy_check;
ALTER TABLE party.merge_manifest
  ADD CONSTRAINT merge_manifest_strategy_check
  CHECK (strategy IN ('MOVE','NEVER_MOVE'));

COMMENT ON COLUMN party.merge_manifest.strategy IS
  'MOVE re-points the row at the survivor. NEVER_MOVE marks a reference that must stay '
  'where it is — merge bookkeeping, which a later merge must not rewrite.';

INSERT INTO party.merge_manifest (entity_table, column_name, strategy, apply_order, note) VALUES
  ('party.organization_merge', 'surviving_organization_id', 'NEVER_MOVE', 1000,
   'The merge ledger''s own record of who survived. Re-pointing it during a later '
   'merge would rewrite the history an unmerge depends on.'),
  ('party.organization_merge', 'merged_organization_id', 'NEVER_MOVE', 1000,
   'Likewise: which organization this merge absorbed is a fact about that merge, not '
   'a link to be followed forward.')
ON CONFLICT (entity_table, column_name) DO NOTHING;
