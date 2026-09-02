-- CreateEnum
CREATE TYPE "TalentConsentStatus" AS ENUM ('NOT_ASKED', 'INVITED', 'OPTED_IN', 'OPTED_OUT');

-- AlterEnum
ALTER TYPE "RetentionRecordType" ADD VALUE 'TALENT_POOL_RECORDS';

-- CreateTable
CREATE TABLE "TalentProfile" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "consentStatus" "TalentConsentStatus" NOT NULL DEFAULT 'NOT_ASKED',
    "consentAskedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "consentSource" TEXT,
    "consentTokenHash" TEXT,
    "interests" TEXT,
    "summary" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentTag" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentProfileTag" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentProfileTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentPool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "jobProfileId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentPoolMember" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "note" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentPoolMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentOutreach" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "requisitionId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "note" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentOutreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentSuppression" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'opted_out',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TalentProfile_candidateId_key" ON "TalentProfile"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentProfile_consentTokenHash_key" ON "TalentProfile"("consentTokenHash");

-- CreateIndex
CREATE INDEX "TalentProfile_consentStatus_idx" ON "TalentProfile"("consentStatus");

-- CreateIndex
CREATE INDEX "TalentProfile_expiresAt_idx" ON "TalentProfile"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TalentTag_label_key" ON "TalentTag"("label");

-- CreateIndex
CREATE INDEX "TalentTag_category_idx" ON "TalentTag"("category");

-- CreateIndex
CREATE INDEX "TalentProfileTag_tagId_idx" ON "TalentProfileTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentProfileTag_profileId_tagId_key" ON "TalentProfileTag"("profileId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentPool_name_key" ON "TalentPool"("name");

-- CreateIndex
CREATE INDEX "TalentPool_active_idx" ON "TalentPool"("active");

-- CreateIndex
CREATE INDEX "TalentPoolMember_profileId_idx" ON "TalentPoolMember"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentPoolMember_poolId_profileId_key" ON "TalentPoolMember"("poolId", "profileId");

-- CreateIndex
CREATE INDEX "TalentOutreach_profileId_sentAt_idx" ON "TalentOutreach"("profileId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TalentSuppression_emailHash_key" ON "TalentSuppression"("emailHash");

-- AddForeignKey
ALTER TABLE "TalentProfile" ADD CONSTRAINT "TalentProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentProfile" ADD CONSTRAINT "TalentProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentProfileTag" ADD CONSTRAINT "TalentProfileTag_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentProfileTag" ADD CONSTRAINT "TalentProfileTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TalentTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentProfileTag" ADD CONSTRAINT "TalentProfileTag_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentPool" ADD CONSTRAINT "TalentPool_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentPool" ADD CONSTRAINT "TalentPool_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentPoolMember" ADD CONSTRAINT "TalentPoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "TalentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentPoolMember" ADD CONSTRAINT "TalentPoolMember_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentPoolMember" ADD CONSTRAINT "TalentPoolMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentOutreach" ADD CONSTRAINT "TalentOutreach_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentOutreach" ADD CONSTRAINT "TalentOutreach_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentOutreach" ADD CONSTRAINT "TalentOutreach_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

