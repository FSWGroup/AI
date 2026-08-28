-- AlterEnum
--
-- APPLICATION is a multi-dimension judgment question: given a set of
-- application parameters, the learner makes several linked selections and each
-- is scored separately.
ALTER TYPE "QuestionType" ADD VALUE 'APPLICATION';

-- DropIndex
--
-- Left over from the original schema's @@unique over the Assignment target
-- columns, which never enforced anything: in Postgres NULL is never equal to
-- NULL, so rows differing only in NULL slots were all accepted. Migration
-- 20260828021500_assignment_dedupe replaced it with a COALESCE expression index
-- that does work, but its DROP named the index untruncated —
-- "..._parentAssignmentId_key" — while Postgres had truncated the identifier to
-- 63 characters as "..._parentAs_key". IF EXISTS then swallowed the miss
-- silently, so the dead index survived. This drops it by its real name.
DROP INDEX "Assignment_userId_targetType_courseId_sopId_pathId_parentAs_key";
