-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER', 'ASSESSMENT_ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "RetentionRecordType" AS ENUM ('ASSESSMENT_ANSWERS', 'SCORE_REPORT_DATA', 'INVITATION_RECORDS', 'INTEGRITY_EVENT_LOGS', 'WEBCAM_RECORDINGS', 'AUDIT_RECORDS');

-- CreateEnum
CREATE TYPE "Construct" AS ENUM ('MENTAL_ACUITY', 'BUSINESS_TERMS', 'AWARENESS_MEMORY', 'VOCABULARY', 'NUMERICAL_PERCEPTION', 'MECHANICAL_INTEREST', 'ENERGY', 'FLEXIBILITY', 'ORGANIZATION', 'COMMUNICATION', 'EMOTIONAL_DEVELOPMENT', 'ASSERTIVENESS', 'COMPETITIVENESS', 'MENTAL_TOUGHNESS', 'QUESTIONING_PROBING', 'MOTIVATION', 'DISTORTION', 'EQUIVOCATION');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('MULTIPLE_CHOICE', 'LIKERT_STATEMENT', 'MEMORY_STUDY', 'STRING_COMPARISON');

-- CreateEnum
CREATE TYPE "AssessmentVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "JobOpeningStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CompositeCategory" AS ENUM ('SALES', 'LEADERSHIP');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'OPENED', 'STARTED', 'COMPLETED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED', 'EXPIRED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "AttemptSectionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BandType" AS ENUM ('PROVISIONAL', 'STANINE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('ACTIVE', 'FINALIZED', 'INCOMPLETE', 'DELETED');

-- CreateEnum
CREATE TYPE "ChunkUploadStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "AccommodationType" AS ENUM ('EXTENDED_TIME', 'CAMERA_EXEMPT', 'UNTIMED', 'ALTERNATE_PRESENTATION', 'IN_PERSON_ADMINISTRATION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobProfileAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,

    CONSTRAINT "JobProfileAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSettings" (
    "id" TEXT NOT NULL DEFAULT 'org',
    "companyName" TEXT NOT NULL DEFAULT 'FSW Group',
    "logoUrl" TEXT,
    "privacyContactEmail" TEXT,
    "accommodationContactEmail" TEXT,
    "hrNotificationEmail" TEXT,
    "assessmentDisclaimer" TEXT,
    "permittedAdminDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentAwarenessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eeoModuleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "privacyNoticeVersion" TEXT NOT NULL DEFAULT '1.0',
    "privacyNoticeConfigured" BOOLEAN NOT NULL DEFAULT false,
    "storageConfigured" BOOLEAN NOT NULL DEFAULT false,
    "httpsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "recordType" "RetentionRecordType" NOT NULL,
    "retentionDays" INTEGER,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "subtype" TEXT NOT NULL,
    "kind" "QuestionKind" NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'fsw_original',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentAwarenessExpiry" TIMESTAMP(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "construct" "Construct" NOT NULL,
    "subtype" TEXT NOT NULL,
    "kind" "QuestionKind" NOT NULL,
    "prompt" TEXT NOT NULL,
    "promptData" JSONB,
    "choices" JSONB,
    "correctIndex" INTEGER,
    "explanation" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "reverseCoded" BOOLEAN NOT NULL DEFAULT false,
    "pairKey" TEXT,
    "impressionManagement" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "AssessmentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "scoringVersion" TEXT NOT NULL DEFAULT '1.0',
    "narrativeVersion" TEXT NOT NULL DEFAULT '1.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "AssessmentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionDefinition" (
    "id" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "timed" BOOLEAN NOT NULL DEFAULT false,
    "durationSeconds" INTEGER,
    "questionCount" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "randomize" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SectionDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentFormQuestion" (
    "id" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "difficultyBucket" INTEGER NOT NULL DEFAULT 2,
    "orderHint" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssessmentFormQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSalesRole" BOOLEAN NOT NULL DEFAULT false,
    "leadershipModuleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDimensionBenchmark" (
    "id" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "minScore" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "note" TEXT,

    CONSTRAINT "JobDimensionBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaOfConcernRule" (
    "id" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "maxBand" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Additional Interview Attention Recommended',
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AreaOfConcernRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "JobOpeningStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositeDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CompositeCategory" NOT NULL,
    "components" JSONB NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CompositeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateNote" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "recordId" TEXT NOT NULL,
    "resumeTokenHash" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "entryStep" TEXT NOT NULL DEFAULT 'welcome',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "timeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "cameraExempt" BOOLEAN NOT NULL DEFAULT false,
    "untimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptSection" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "status" "AttemptSectionStatus" NOT NULL DEFAULT 'PENDING',
    "timed" BOOLEAN NOT NULL,
    "durationSeconds" INTEGER,
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AttemptSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptQuestion" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "questionVersionId" TEXT NOT NULL,

    CONSTRAINT "AttemptQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "attemptQuestionId" TEXT NOT NULL,
    "value" INTEGER,
    "answeredAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "responseTimeMs" INTEGER,
    "changedCount" INTEGER NOT NULL DEFAULT 0,
    "isCorrect" BOOLEAN,
    "unanswered" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormTable" (
    "id" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "assessmentVersionId" TEXT,
    "population" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "methodology" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "scaledScore" DOUBLE PRECISION NOT NULL,
    "percentile" DOUBLE PRECISION,
    "band" INTEGER NOT NULL,
    "bandType" "BandType" NOT NULL,
    "normTableId" TEXT,
    "scoringVersion" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositeScore" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CompositeCategory" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "band" INTEGER NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "CompositeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "scoringVersion" TEXT NOT NULL,
    "narrativeVersion" TEXT NOT NULL,
    "benchmarkSnapshot" JSONB NOT NULL,
    "payload" JSONB,
    "pdfObjectKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeTemplate" (
    "id" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "slot" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NarrativeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestionTemplate" (
    "id" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "focus" TEXT NOT NULL,
    "measures" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InterviewQuestionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentTemplate" (
    "id" TEXT NOT NULL,
    "construct" "Construct" NOT NULL,
    "recommendations" JSONB NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DevelopmentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'ACTIVE',
    "mimeType" TEXT NOT NULL DEFAULT 'video/webm',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "expectedChunks" INTEGER,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingChunk" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "status" "ChunkUploadStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3),

    CONSTRAINT "RecordingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrityEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "IntegrityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccommodationOverride" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" "AccommodationType" NOT NULL,
    "timeMultiplier" DOUBLE PRECISION,
    "note" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccommodationOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemStatistic" (
    "id" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "administered" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "unansweredCount" INTEGER NOT NULL DEFAULT 0,
    "totalResponseMs" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemStatistic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EeoRecord" (
    "id" TEXT NOT NULL,
    "candidateRef" TEXT NOT NULL,
    "jobOpeningId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EeoRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobProfileAssignment_userId_jobProfileId_key" ON "JobProfileAssignment"("userId", "jobProfileId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_idx" ON "AuditEvent"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_recordType_key" ON "RetentionPolicy"("recordType");

-- CreateIndex
CREATE INDEX "LegalHold_active_idx" ON "LegalHold"("active");

-- CreateIndex
CREATE INDEX "Question_construct_status_idx" ON "Question"("construct", "status");

-- CreateIndex
CREATE INDEX "Question_status_idx" ON "Question"("status");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_publicId_key" ON "QuestionVersion"("publicId");

-- CreateIndex
CREATE INDEX "QuestionVersion_construct_idx" ON "QuestionVersion"("construct");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentVersion_name_versionNumber_key" ON "AssessmentVersion"("name", "versionNumber");

-- CreateIndex
CREATE INDEX "SectionDefinition_assessmentVersionId_orderIndex_idx" ON "SectionDefinition"("assessmentVersionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SectionDefinition_assessmentVersionId_key_key" ON "SectionDefinition"("assessmentVersionId", "key");

-- CreateIndex
CREATE INDEX "AssessmentFormQuestion_assessmentVersionId_sectionKey_idx" ON "AssessmentFormQuestion"("assessmentVersionId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentFormQuestion_assessmentVersionId_sectionKey_quest_key" ON "AssessmentFormQuestion"("assessmentVersionId", "sectionKey", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDimensionBenchmark_jobProfileId_construct_key" ON "JobDimensionBenchmark"("jobProfileId", "construct");

-- CreateIndex
CREATE UNIQUE INDEX "AreaOfConcernRule_jobProfileId_construct_key" ON "AreaOfConcernRule"("jobProfileId", "construct");

-- CreateIndex
CREATE UNIQUE INDEX "CompositeDefinition_key_key" ON "CompositeDefinition"("key");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");

-- CreateIndex
CREATE INDEX "Invitation_candidateId_idx" ON "Invitation"("candidateId");

-- CreateIndex
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_recordId_key" ON "Attempt"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_resumeTokenHash_key" ON "Attempt"("resumeTokenHash");

-- CreateIndex
CREATE INDEX "Attempt_candidateId_idx" ON "Attempt"("candidateId");

-- CreateIndex
CREATE INDEX "Attempt_jobOpeningId_idx" ON "Attempt"("jobOpeningId");

-- CreateIndex
CREATE INDEX "Attempt_status_idx" ON "Attempt"("status");

-- CreateIndex
CREATE INDEX "AttemptSection_attemptId_orderIndex_idx" ON "AttemptSection"("attemptId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptSection_attemptId_sectionKey_key" ON "AttemptSection"("attemptId", "sectionKey");

-- CreateIndex
CREATE INDEX "AttemptQuestion_attemptId_sectionKey_idx" ON "AttemptQuestion"("attemptId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_sectionKey_orderIndex_key" ON "AttemptQuestion"("attemptId", "sectionKey", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Response_attemptQuestionId_key" ON "Response"("attemptQuestionId");

-- CreateIndex
CREATE INDEX "Response_attemptId_idx" ON "Response"("attemptId");

-- CreateIndex
CREATE INDEX "NormTable_construct_idx" ON "NormTable"("construct");

-- CreateIndex
CREATE UNIQUE INDEX "Score_attemptId_construct_key" ON "Score"("attemptId", "construct");

-- CreateIndex
CREATE UNIQUE INDEX "CompositeScore_attemptId_key_key" ON "CompositeScore"("attemptId", "key");

-- CreateIndex
CREATE INDEX "Report_attemptId_idx" ON "Report"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeTemplate_construct_slot_version_key" ON "NarrativeTemplate"("construct", "slot", "version");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewQuestionTemplate_construct_focus_version_key" ON "InterviewQuestionTemplate"("construct", "focus", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentTemplate_construct_version_key" ON "DevelopmentTemplate"("construct", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_sessionId_key" ON "Recording"("sessionId");

-- CreateIndex
CREATE INDEX "Recording_attemptId_idx" ON "Recording"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingChunk_recordingId_sequence_key" ON "RecordingChunk"("recordingId", "sequence");

-- CreateIndex
CREATE INDEX "ConsentRecord_attemptId_idx" ON "ConsentRecord"("attemptId");

-- CreateIndex
CREATE INDEX "IntegrityEvent_attemptId_occurredAt_idx" ON "IntegrityEvent"("attemptId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemStatistic_questionVersionId_key" ON "ItemStatistic"("questionVersionId");

-- CreateIndex
CREATE INDEX "EeoRecord_jobOpeningId_idx" ON "EeoRecord"("jobOpeningId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobProfileAssignment" ADD CONSTRAINT "JobProfileAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobProfileAssignment" ADD CONSTRAINT "JobProfileAssignment_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionDefinition" ADD CONSTRAINT "SectionDefinition_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentFormQuestion" ADD CONSTRAINT "AssessmentFormQuestion_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentFormQuestion" ADD CONSTRAINT "AssessmentFormQuestion_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDimensionBenchmark" ADD CONSTRAINT "JobDimensionBenchmark_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaOfConcernRule" ADD CONSTRAINT "AreaOfConcernRule_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSection" ADD CONSTRAINT "AttemptSection_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_attemptQuestionId_fkey" FOREIGN KEY ("attemptQuestionId") REFERENCES "AttemptQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormTable" ADD CONSTRAINT "NormTable_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_normTableId_fkey" FOREIGN KEY ("normTableId") REFERENCES "NormTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositeScore" ADD CONSTRAINT "CompositeScore_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingChunk" ADD CONSTRAINT "RecordingChunk_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrityEvent" ADD CONSTRAINT "IntegrityEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccommodationOverride" ADD CONSTRAINT "AccommodationOverride_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccommodationOverride" ADD CONSTRAINT "AccommodationOverride_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStatistic" ADD CONSTRAINT "ItemStatistic_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
