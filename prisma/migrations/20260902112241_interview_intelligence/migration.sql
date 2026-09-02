-- CreateEnum
CREATE TYPE "RecordingConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RecordingConsentParty" AS ENUM ('CANDIDATE', 'INTERVIEWER');

-- CreateEnum
CREATE TYPE "InterviewRecordingStatus" AS ENUM ('AWAITING_CONSENT', 'READY', 'UPLOADED', 'TRANSCRIBED', 'ANALYZED', 'DELETED');

-- AlterEnum
ALTER TYPE "RetentionRecordType" ADD VALUE 'INTERVIEW_RECORDINGS';

-- CreateTable
CREATE TABLE "InterviewRecordingConsent" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "party" "RecordingConsentParty" NOT NULL,
    "userId" TEXT,
    "status" "RecordingConsentStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT,
    "statementVersion" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewRecordingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewRecording" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "status" "InterviewRecordingStatus" NOT NULL DEFAULT 'AWAITING_CONSENT',
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "objectKey" TEXT,
    "durationSeconds" INTEGER,
    "transcriptSource" TEXT,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "transcribedAt" TIMESTAMP(3),
    "analyzedAt" TIMESTAMP(3),
    "mediaDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "speakerLabel" TEXT,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewEvidence" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "competencyId" TEXT,
    "competencyName" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "relevance" TEXT NOT NULL,
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedReason" TEXT,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRecordingConsent_tokenHash_key" ON "InterviewRecordingConsent"("tokenHash");

-- CreateIndex
CREATE INDEX "InterviewRecordingConsent_interviewId_status_idx" ON "InterviewRecordingConsent"("interviewId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRecordingConsent_interviewId_party_userId_key" ON "InterviewRecordingConsent"("interviewId", "party", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRecording_interviewId_key" ON "InterviewRecording"("interviewId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_recordingId_startMs_idx" ON "TranscriptSegment"("recordingId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_recordingId_orderIndex_key" ON "TranscriptSegment"("recordingId", "orderIndex");

-- CreateIndex
CREATE INDEX "InterviewEvidence_recordingId_competencyName_idx" ON "InterviewEvidence"("recordingId", "competencyName");

-- AddForeignKey
ALTER TABLE "InterviewRecordingConsent" ADD CONSTRAINT "InterviewRecordingConsent_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRecordingConsent" ADD CONSTRAINT "InterviewRecordingConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRecording" ADD CONSTRAINT "InterviewRecording_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRecording" ADD CONSTRAINT "InterviewRecording_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "InterviewRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvidence" ADD CONSTRAINT "InterviewEvidence_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "InterviewRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvidence" ADD CONSTRAINT "InterviewEvidence_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "KitCompetency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvidence" ADD CONSTRAINT "InterviewEvidence_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

