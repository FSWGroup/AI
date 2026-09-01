-- DropForeignKey
ALTER TABLE "SignatureEvent" DROP CONSTRAINT "SignatureEvent_requestId_fkey";

-- DropForeignKey
ALTER TABLE "SignatureRequest" DROP CONSTRAINT "SignatureRequest_documentVersionId_fkey";

-- DropForeignKey
ALTER TABLE "SignatureRequest" DROP CONSTRAINT "SignatureRequest_workerId_fkey";

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

