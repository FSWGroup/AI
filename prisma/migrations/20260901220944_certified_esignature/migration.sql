-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SIGNNOW',
    "providerDocumentId" TEXT,
    "providerInviteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "message" TEXT,
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "storedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "signedFileKey" TEXT,
    "certificateFileKey" TEXT,
    "signedSha256" TEXT,
    "signedVersionId" TEXT,
    "lastError" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "canceledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "providerEventId" TEXT,
    "payloadDigest" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureRequest_providerDocumentId_key" ON "SignatureRequest"("providerDocumentId");

-- CreateIndex
CREATE INDEX "SignatureRequest_status_dueAt_idx" ON "SignatureRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "SignatureRequest_workerId_status_idx" ON "SignatureRequest"("workerId", "status");

-- CreateIndex
CREATE INDEX "SignatureRequest_documentVersionId_idx" ON "SignatureRequest"("documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEvent_providerEventId_key" ON "SignatureEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "SignatureEvent_requestId_at_idx" ON "SignatureEvent"("requestId", "at");

-- CreateIndex
CREATE INDEX "SignatureEvent_kind_at_idx" ON "SignatureEvent"("kind", "at");

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Signature events are the evidence trail a dispute is settled from months
-- later. Same append-only guarantee as AuditEvent.
CREATE TRIGGER signature_event_append_only
  BEFORE UPDATE OR DELETE ON "SignatureEvent"
  FOR EACH ROW EXECUTE FUNCTION fsw_prevent_mutation();
