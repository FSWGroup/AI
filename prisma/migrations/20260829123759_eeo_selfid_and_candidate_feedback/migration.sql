-- AlterTable
ALTER TABLE "EeoRecord" ADD COLUMN     "attemptRef" TEXT NOT NULL,
ADD COLUMN     "jobProfileRef" TEXT;

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "candidateFeedbackEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "EeoRecord_attemptRef_key" ON "EeoRecord"("attemptRef");

-- CreateIndex
CREATE INDEX "EeoRecord_jobProfileRef_idx" ON "EeoRecord"("jobProfileRef");

