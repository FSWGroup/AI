-- Enforce assignment idempotency correctly.
--
-- The previous constraint was a plain UNIQUE over
-- (userId, targetType, courseId, sopId, pathId, parentAssignmentId).
-- That does not work in PostgreSQL: NULL is never equal to NULL, so a course
-- assignment (where sopId, pathId and parentAssignmentId are all NULL) could be
-- inserted any number of times. The assignment-rule engine relies on this
-- constraint to be idempotent, so the guarantee was not actually held.
--
-- Replaced with an expression index that maps NULL to a sentinel, making the
-- comparison total.

DROP INDEX IF EXISTS "Assignment_userId_targetType_courseId_sopId_pathId_parentAssignmentId_key";

-- Remove any duplicates that predate the fix, keeping the earliest row so the
-- original assignment date and reason are preserved.
DELETE FROM "Assignment" a
USING "Assignment" b
WHERE a."id" > b."id"
  AND a."userId" = b."userId"
  AND a."targetType" = b."targetType"
  AND COALESCE(a."courseId", '') = COALESCE(b."courseId", '')
  AND COALESCE(a."sopId", '') = COALESCE(b."sopId", '')
  AND COALESCE(a."pathId", '') = COALESCE(b."pathId", '')
  AND COALESCE(a."parentAssignmentId", '') = COALESCE(b."parentAssignmentId", '');

CREATE UNIQUE INDEX "Assignment_user_target_unique" ON "Assignment" (
  "userId",
  "targetType",
  COALESCE("courseId", ''),
  COALESCE("sopId", ''),
  COALESCE("pathId", ''),
  COALESCE("parentAssignmentId", '')
);
