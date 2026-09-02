-- CreateEnum
CREATE TYPE "WorkSampleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "WorkSampleSubmissionKind" AS ENUM ('TEXT', 'FILE', 'TEXT_AND_FILE');

-- CreateEnum
CREATE TYPE "WorkSampleAssignmentStatus" AS ENUM ('ASSIGNED', 'STARTED', 'SUBMITTED', 'EXPIRED', 'WITHDRAWN', 'GRADED');

-- CreateEnum
CREATE TYPE "WorkSampleGradeStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterEnum
ALTER TYPE "StageKind" ADD VALUE 'WORK_SAMPLE';

-- CreateTable
CREATE TABLE "WorkSample" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "instructions" TEXT NOT NULL,
    "successCriteria" TEXT,
    "submissionKind" "WorkSampleSubmissionKind" NOT NULL DEFAULT 'TEXT',
    "timeLimitMinutes" INTEGER,
    "dueInDays" INTEGER NOT NULL DEFAULT 5,
    "allowedFileTypes" TEXT[],
    "status" "WorkSampleStatus" NOT NULL DEFAULT 'DRAFT',
    "requiredGraders" INTEGER NOT NULL DEFAULT 2,
    "jobProfileId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSampleCriterion" (
    "id" TEXT NOT NULL,
    "workSampleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "anchors" JSONB NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkSampleCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSampleAssignment" (
    "id" TEXT NOT NULL,
    "workSampleId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "WorkSampleAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "draftText" TEXT,
    "submittedText" TEXT,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "objectKey" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSampleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSampleGrade" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "graderId" TEXT NOT NULL,
    "status" "WorkSampleGradeStatus" NOT NULL DEFAULT 'DRAFT',
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSampleGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSampleRating" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "criterionName" TEXT NOT NULL,
    "level" INTEGER,
    "note" TEXT,

    CONSTRAINT "WorkSampleRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkSample_status_idx" ON "WorkSample"("status");

-- CreateIndex
CREATE INDEX "WorkSampleCriterion_workSampleId_orderIndex_idx" ON "WorkSampleCriterion"("workSampleId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSampleCriterion_workSampleId_name_key" ON "WorkSampleCriterion"("workSampleId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSampleAssignment_reference_key" ON "WorkSampleAssignment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSampleAssignment_tokenHash_key" ON "WorkSampleAssignment"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkSampleAssignment_applicationId_idx" ON "WorkSampleAssignment"("applicationId");

-- CreateIndex
CREATE INDEX "WorkSampleAssignment_status_idx" ON "WorkSampleAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSampleAssignment_workSampleId_applicationId_key" ON "WorkSampleAssignment"("workSampleId", "applicationId");

-- CreateIndex
CREATE INDEX "WorkSampleGrade_graderId_status_idx" ON "WorkSampleGrade"("graderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSampleGrade_assignmentId_graderId_key" ON "WorkSampleGrade"("assignmentId", "graderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSampleRating_gradeId_criterionId_key" ON "WorkSampleRating"("gradeId", "criterionId");

-- AddForeignKey
ALTER TABLE "WorkSample" ADD CONSTRAINT "WorkSample_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSample" ADD CONSTRAINT "WorkSample_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleCriterion" ADD CONSTRAINT "WorkSampleCriterion_workSampleId_fkey" FOREIGN KEY ("workSampleId") REFERENCES "WorkSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleAssignment" ADD CONSTRAINT "WorkSampleAssignment_workSampleId_fkey" FOREIGN KEY ("workSampleId") REFERENCES "WorkSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleAssignment" ADD CONSTRAINT "WorkSampleAssignment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleAssignment" ADD CONSTRAINT "WorkSampleAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleGrade" ADD CONSTRAINT "WorkSampleGrade_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "WorkSampleAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleGrade" ADD CONSTRAINT "WorkSampleGrade_graderId_fkey" FOREIGN KEY ("graderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleRating" ADD CONSTRAINT "WorkSampleRating_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "WorkSampleGrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSampleRating" ADD CONSTRAINT "WorkSampleRating_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "WorkSampleCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

