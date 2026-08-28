-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "sourceBoard" TEXT,
ADD COLUMN     "sourceRef" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "resumeText" TEXT;

-- CreateTable
CREATE TABLE "JobBoardPosting" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "board" TEXT NOT NULL DEFAULT 'INDEED',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "publicTitle" TEXT,
    "publicLocation" TEXT,
    "showSalary" BOOLEAN NOT NULL DEFAULT false,
    "remoteType" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "lastFeedAt" TIMESTAMP(3),

    CONSTRAINT "JobBoardPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobBoardDelivery" (
    "id" TEXT NOT NULL,
    "board" TEXT NOT NULL DEFAULT 'INDEED',
    "externalId" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "requisitionId" TEXT,
    "applicationId" TEXT,
    "payloadDigest" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobBoardDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestionSet" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "basis" JSONB NOT NULL DEFAULT '{}',
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewQuestionSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobBoardPosting_board_status_idx" ON "JobBoardPosting"("board", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobBoardPosting_requisitionId_board_key" ON "JobBoardPosting"("requisitionId", "board");

-- CreateIndex
CREATE INDEX "JobBoardDelivery_board_receivedAt_idx" ON "JobBoardDelivery"("board", "receivedAt");

-- CreateIndex
CREATE INDEX "JobBoardDelivery_externalId_idx" ON "JobBoardDelivery"("externalId");

-- CreateIndex
CREATE INDEX "InterviewQuestionSet_applicationId_createdAt_idx" ON "InterviewQuestionSet"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_sourceRef_key" ON "Application"("sourceRef");

-- AddForeignKey
ALTER TABLE "JobBoardPosting" ADD CONSTRAINT "JobBoardPosting_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "JobRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestionSet" ADD CONSTRAINT "InterviewQuestionSet_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Inbound job-board deliveries are an evidence log: every payload Indeed sends
-- us is recorded, including the ones we reject. Like AuditEvent, the row must
-- not be editable after the fact.
CREATE TRIGGER job_board_delivery_append_only
  BEFORE UPDATE OR DELETE ON "JobBoardDelivery"
  FOR EACH ROW EXECUTE FUNCTION fsw_prevent_mutation();
