-- CreateEnum
CREATE TYPE "ReviewRoundStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SocialCheckStatus" AS ENUM ('NOT_STARTED', 'CONSENT_REQUESTED', 'CONSENT_DECLINED', 'AWAITING_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SocialCheckOutcome" AS ENUM ('NOTHING_FOUND', 'FINDINGS_TO_DISCUSS');

-- CreateEnum
CREATE TYPE "SocialFindingCategory" AS ENUM ('VIOLENT_THREATS', 'HARASSMENT_OR_ABUSE', 'ILLEGAL_ACTIVITY', 'CONFIDENTIALITY_BREACH', 'MISREPRESENTATION', 'SAFETY_RISK');

-- CreateEnum
CREATE TYPE "BackgroundCheckStatus" AS ENUM ('NOT_STARTED', 'INVITATION_SENT', 'INVITATION_EXPIRED', 'PENDING', 'COMPLETE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BackgroundCheckResult" AS ENUM ('CLEAR', 'CONSIDER', 'DISPUTE');

-- CreateEnum
CREATE TYPE "AdverseActionStage" AS ENUM ('NONE', 'PRE_ADVERSE_SENT', 'DISPUTED', 'ADVERSE_ACTION_SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "ReviewRound" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kitId" TEXT,
    "blind" BOOLEAN NOT NULL DEFAULT true,
    "status" "ReviewRoundStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateReview" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "status" "ScorecardStatus" NOT NULL DEFAULT 'DRAFT',
    "recommendation" "ScorecardRecommendation",
    "summary" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateReviewRating" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "criterionName" TEXT NOT NULL,
    "rating" INTEGER,
    "note" TEXT,

    CONSTRAINT "CandidateReviewRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMediaCheck" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "SocialCheckStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "consentTokenHash" TEXT,
    "consentRequestedAt" TIMESTAMP(3),
    "consentGivenAt" TIMESTAMP(3),
    "consentDeclinedAt" TIMESTAMP(3),
    "disclosedProfiles" JSONB,
    "consentStatementVersion" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "outcome" "SocialCheckOutcome",
    "reviewerNotes" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMediaCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMediaFinding" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "category" "SocialFindingCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialMediaFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundCheck" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "offerId" TEXT,
    "status" "BackgroundCheckStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "result" "BackgroundCheckResult",
    "packageSlug" TEXT NOT NULL,
    "workLocationCountry" TEXT NOT NULL DEFAULT 'US',
    "workLocationState" TEXT,
    "workLocationCity" TEXT,
    "checkrCandidateId" TEXT,
    "checkrInvitationId" TEXT,
    "checkrReportId" TEXT,
    "invitationUrl" TEXT,
    "invitedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reportSummary" JSONB,
    "adverseStage" "AdverseActionStage" NOT NULL DEFAULT 'NONE',
    "preAdverseSentAt" TIMESTAMP(3),
    "disputeReceivedAt" TIMESTAMP(3),
    "adverseActionSentAt" TIMESTAMP(3),
    "adverseActionReason" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundCheckEvent" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT,
    "payload" JSONB,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundCheckEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewRound_applicationId_idx" ON "ReviewRound"("applicationId");

-- CreateIndex
CREATE INDEX "CandidateReview_reviewerId_status_idx" ON "CandidateReview"("reviewerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateReview_roundId_reviewerId_key" ON "CandidateReview"("roundId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateReviewRating_reviewId_criterionName_key" ON "CandidateReviewRating"("reviewId", "criterionName");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMediaCheck_applicationId_key" ON "SocialMediaCheck"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMediaCheck_consentTokenHash_key" ON "SocialMediaCheck"("consentTokenHash");

-- CreateIndex
CREATE INDEX "SocialMediaFinding_checkId_idx" ON "SocialMediaFinding"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundCheck_applicationId_key" ON "BackgroundCheck"("applicationId");

-- CreateIndex
CREATE INDEX "BackgroundCheck_status_idx" ON "BackgroundCheck"("status");

-- CreateIndex
CREATE INDEX "BackgroundCheckEvent_checkId_occurredAt_idx" ON "BackgroundCheckEvent"("checkId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "InterviewKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateReview" ADD CONSTRAINT "CandidateReview_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ReviewRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateReview" ADD CONSTRAINT "CandidateReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateReviewRating" ADD CONSTRAINT "CandidateReviewRating_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "CandidateReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMediaCheck" ADD CONSTRAINT "SocialMediaCheck_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMediaCheck" ADD CONSTRAINT "SocialMediaCheck_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMediaCheck" ADD CONSTRAINT "SocialMediaCheck_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMediaFinding" ADD CONSTRAINT "SocialMediaFinding_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "SocialMediaCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheck" ADD CONSTRAINT "BackgroundCheck_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheck" ADD CONSTRAINT "BackgroundCheck_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheckEvent" ADD CONSTRAINT "BackgroundCheckEvent_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "BackgroundCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

