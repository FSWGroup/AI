-- DropIndex
DROP INDEX "InterviewEvidence_recordingId_competencyName_idx";

-- DropIndex
DROP INDEX "PerformanceMetric_key_idx";

-- DropIndex
DROP INDEX "SchedulingPanelist_userId_idx";

-- DropIndex
DROP INDEX "SchedulingRequest_status_idx";

-- DropIndex
DROP INDEX "TalentPool_active_idx";

-- DropIndex
DROP INDEX "TalentProfile_consentStatus_idx";

-- DropIndex
DROP INDEX "TalentProfile_expiresAt_idx";

-- DropIndex
DROP INDEX "TalentTag_category_idx";

-- DropIndex
DROP INDEX "TranscriptSegment_recordingId_startMs_idx";

-- DropIndex
DROP INDEX "ValidationStudy_jobProfileId_idx";

-- DropIndex
DROP INDEX "ValidationStudy_status_idx";

-- DropIndex
DROP INDEX "ValidityCoefficient_studyId_idx";

-- DropIndex
DROP INDEX "WorkSampleAssignment_status_idx";

-- CreateIndex
CREATE INDEX "Hire_managerId_status_idx" ON "Hire"("managerId", "status");

-- CreateIndex
CREATE INDEX "InterviewEvidence_recordingId_startMs_idx" ON "InterviewEvidence"("recordingId", "startMs");

-- CreateIndex
CREATE INDEX "Scorecard_status_submittedAt_idx" ON "Scorecard"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "TalentProfile_consentStatus_updatedAt_idx" ON "TalentProfile"("consentStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "TalentProfile_consentStatus_expiresAt_idx" ON "TalentProfile"("consentStatus", "expiresAt");

-- CreateIndex
CREATE INDEX "WorkSampleAssignment_status_submittedAt_idx" ON "WorkSampleAssignment"("status", "submittedAt");

