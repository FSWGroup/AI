-- DropIndex
DROP INDEX "InterviewRecordingConsent_interviewId_party_userId_key";

-- AlterTable
-- Added nullable, backfilled, then made NOT NULL, so an instance that already
-- holds consent rows migrates instead of failing on the new column.
ALTER TABLE "InterviewRecordingConsent" ADD COLUMN     "partyKey" TEXT;
UPDATE "InterviewRecordingConsent" SET "partyKey" = COALESCE("userId", 'CANDIDATE');
ALTER TABLE "InterviewRecordingConsent" ALTER COLUMN "partyKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRecordingConsent_interviewId_partyKey_key" ON "InterviewRecordingConsent"("interviewId", "partyKey");

