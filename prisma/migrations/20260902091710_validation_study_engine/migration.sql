-- CreateEnum
CREATE TYPE "HireStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'DEPARTED_VOLUNTARY', 'DEPARTED_INVOLUNTARY');

-- CreateEnum
CREATE TYPE "PerformanceCycleKind" AS ENUM ('DAY_30', 'DAY_90', 'DAY_180', 'ANNUAL', 'AD_HOC');

-- CreateEnum
CREATE TYPE "PerformanceCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PerformanceReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "ValidationCriterionKind" AS ENUM ('OVERALL_RATING', 'COMPETENCY_RATING', 'COMPOSITE_RATING', 'METRIC', 'RETENTION');

-- CreateEnum
CREATE TYPE "ValidationStudyStatus" AS ENUM ('DRAFT', 'COMPUTED', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "NormTable" ADD COLUMN     "sourceStudyId" TEXT;

-- CreateTable
CREATE TABLE "Hire" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "attemptId" TEXT,
    "applicationId" TEXT,
    "offerId" TEXT,
    "jobProfileId" TEXT,
    "requisitionId" TEXT,
    "jobTitle" TEXT NOT NULL,
    "departmentId" TEXT,
    "locationId" TEXT,
    "managerId" TEXT,
    "hiredAt" TIMESTAMP(3) NOT NULL,
    "status" "HireStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceCycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PerformanceCycleKind" NOT NULL,
    "dueAfterDays" INTEGER,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "status" "PerformanceCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "criterionKeys" TEXT[],
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "hireId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "status" "PerformanceReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "overallRating" INTEGER,
    "wouldRehire" BOOLEAN,
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceRating" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "criterionKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "PerformanceRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "hireId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationStudy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "jobProfileId" TEXT,
    "criterionKind" "ValidationCriterionKind" NOT NULL,
    "criterionKeys" TEXT[],
    "retentionDays" INTEGER,
    "cycleKinds" "PerformanceCycleKind"[],
    "hiredFrom" TIMESTAMP(3),
    "hiredTo" TIMESTAMP(3),
    "correctRangeRestriction" BOOLEAN NOT NULL DEFAULT true,
    "correctAttenuation" BOOLEAN NOT NULL DEFAULT true,
    "status" "ValidationStudyStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" JSONB,
    "computedAt" TIMESTAMP(3),
    "computedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidityCoefficient" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "construct" "Construct",
    "compositeKey" TEXT,
    "label" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "r" DOUBLE PRECISION NOT NULL,
    "ciLow" DOUBLE PRECISION NOT NULL,
    "ciHigh" DOUBLE PRECISION NOT NULL,
    "pValue" DOUBLE PRECISION NOT NULL,
    "qValue" DOUBLE PRECISION NOT NULL,
    "rRangeCorrected" DOUBLE PRECISION,
    "rFullyCorrected" DOUBLE PRECISION,
    "sdRestricted" DOUBLE PRECISION,
    "sdUnrestricted" DOUBLE PRECISION,
    "predictorMean" DOUBLE PRECISION,
    "verdict" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidityCoefficient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hire_attemptId_key" ON "Hire"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Hire_applicationId_key" ON "Hire"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Hire_offerId_key" ON "Hire"("offerId");

-- CreateIndex
CREATE INDEX "Hire_candidateId_idx" ON "Hire"("candidateId");

-- CreateIndex
CREATE INDEX "Hire_jobProfileId_idx" ON "Hire"("jobProfileId");

-- CreateIndex
CREATE INDEX "Hire_status_idx" ON "Hire"("status");

-- CreateIndex
CREATE INDEX "Hire_hiredAt_idx" ON "Hire"("hiredAt");

-- CreateIndex
CREATE INDEX "PerformanceCycle_status_idx" ON "PerformanceCycle"("status");

-- CreateIndex
CREATE INDEX "PerformanceReview_raterId_status_idx" ON "PerformanceReview"("raterId", "status");

-- CreateIndex
CREATE INDEX "PerformanceReview_cycleId_status_idx" ON "PerformanceReview"("cycleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_hireId_cycleId_raterId_key" ON "PerformanceReview"("hireId", "cycleId", "raterId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceRating_reviewId_criterionKey_key" ON "PerformanceRating"("reviewId", "criterionKey");

-- CreateIndex
CREATE INDEX "PerformanceMetric_key_idx" ON "PerformanceMetric"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceMetric_hireId_key_periodStart_periodEnd_key" ON "PerformanceMetric"("hireId", "key", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ValidationStudy_status_idx" ON "ValidationStudy"("status");

-- CreateIndex
CREATE INDEX "ValidationStudy_jobProfileId_idx" ON "ValidationStudy"("jobProfileId");

-- CreateIndex
CREATE INDEX "ValidityCoefficient_studyId_idx" ON "ValidityCoefficient"("studyId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidityCoefficient_studyId_construct_compositeKey_key" ON "ValidityCoefficient"("studyId", "construct", "compositeKey");

-- CreateIndex
CREATE INDEX "NormTable_status_idx" ON "NormTable"("status");

-- AddForeignKey
ALTER TABLE "NormTable" ADD CONSTRAINT "NormTable_sourceStudyId_fkey" FOREIGN KEY ("sourceStudyId") REFERENCES "ValidationStudy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hire" ADD CONSTRAINT "Hire_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_hireId_fkey" FOREIGN KEY ("hireId") REFERENCES "Hire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceRating" ADD CONSTRAINT "PerformanceRating_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PerformanceReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceMetric" ADD CONSTRAINT "PerformanceMetric_hireId_fkey" FOREIGN KEY ("hireId") REFERENCES "Hire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceMetric" ADD CONSTRAINT "PerformanceMetric_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationStudy" ADD CONSTRAINT "ValidationStudy_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationStudy" ADD CONSTRAINT "ValidationStudy_computedById_fkey" FOREIGN KEY ("computedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationStudy" ADD CONSTRAINT "ValidationStudy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidityCoefficient" ADD CONSTRAINT "ValidityCoefficient_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ValidationStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

