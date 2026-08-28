-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('RESUME', 'COVER_LETTER', 'OTHER');

-- CreateEnum
CREATE TYPE "AiAnalysisKind" AS ENUM ('CANDIDATE_FIT', 'JOB_DESCRIPTION');

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "JobProfile" ADD COLUMN     "assessmentVersionId" TEXT,
ADD COLUMN     "jobDescription" TEXT;

-- CreateTable
CREATE TABLE "CandidateDocument" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "attemptId" TEXT,
    "kind" "DocumentKind" NOT NULL DEFAULT 'RESUME',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" TEXT,
    "extractedText" TEXT,
    "textSource" TEXT NOT NULL DEFAULT 'extracted',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL,
    "kind" "AiAnalysisKind" NOT NULL,
    "status" "AiAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "attemptId" TEXT,
    "jobProfileId" TEXT,
    "documentId" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateDocument_candidateId_idx" ON "CandidateDocument"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateDocument_attemptId_idx" ON "CandidateDocument"("attemptId");

-- CreateIndex
CREATE INDEX "AiAnalysis_attemptId_idx" ON "AiAnalysis"("attemptId");

-- CreateIndex
CREATE INDEX "AiAnalysis_jobProfileId_idx" ON "AiAnalysis"("jobProfileId");

-- AddForeignKey
ALTER TABLE "JobProfile" ADD CONSTRAINT "JobProfile_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "AssessmentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDocument" ADD CONSTRAINT "CandidateDocument_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDocument" ADD CONSTRAINT "CandidateDocument_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CandidateDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
