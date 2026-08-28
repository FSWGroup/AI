-- AlterEnum
ALTER TYPE "AuthTokenKind" ADD VALUE 'MAGIC_LINK';

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "kioskFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kioskLockedUntil" TIMESTAMP(3),
ADD COLUMN     "kioskPinHash" TEXT,
ADD COLUMN     "kioskPinSetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskPunch" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeEntryId" TEXT,
    "note" TEXT,

    CONSTRAINT "KioskPunch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_tokenHash_key" ON "KioskDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KioskDevice_active_idx" ON "KioskDevice"("active");

-- CreateIndex
CREATE INDEX "KioskPunch_workerId_at_idx" ON "KioskPunch"("workerId", "at");

-- CreateIndex
CREATE INDEX "KioskPunch_deviceId_at_idx" ON "KioskPunch"("deviceId", "at");

-- AddForeignKey
ALTER TABLE "KioskPunch" ADD CONSTRAINT "KioskPunch_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPunch" ADD CONSTRAINT "KioskPunch_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Kiosk punches are the evidence a disputed hour is settled from, so they
-- carry the same append-only guarantee as AuditEvent.
CREATE TRIGGER kiosk_punch_append_only
  BEFORE UPDATE OR DELETE ON "KioskPunch"
  FOR EACH ROW EXECUTE FUNCTION fsw_prevent_mutation();
