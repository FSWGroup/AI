-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isCertification" BOOLEAN NOT NULL DEFAULT false,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "validityMonths" INTEGER,
    "courseId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerSkill" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 3,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "acquiredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "documentId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSkillRequirement" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "requisitionId" TEXT,
    "jobFamily" TEXT,
    "jobLevel" TEXT,
    "minLevel" INTEGER NOT NULL DEFAULT 3,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "JobSkillRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompCycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "budgetPct" DECIMAL(5,2),
    "budgetAmount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "guidance" TEXT,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompCycleBudget" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "note" TEXT,

    CONSTRAINT "CompCycleBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompProposal" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "currentAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "rateType" TEXT NOT NULL DEFAULT 'ANNUAL',
    "proposedAmount" DECIMAL(14,2),
    "increasePct" DECIMAL(6,3),
    "reason" TEXT NOT NULL DEFAULT 'MERIT',
    "proposedTitle" TEXT,
    "proposedLevel" TEXT,
    "justification" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "proposedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerWorkerId" TEXT NOT NULL,
    "candidateId" TEXT,
    "requisitionId" TEXT,
    "candidateName" TEXT NOT NULL,
    "candidateEmail" TEXT,
    "candidatePhone" TEXT,
    "relationship" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "bonusAmount" DECIMAL(12,2),
    "bonusCurrency" TEXT NOT NULL DEFAULT 'USD',
    "bonusStatus" TEXT NOT NULL DEFAULT 'NONE',
    "bonusEligibleAt" TIMESTAMP(3),
    "bonusApprovedById" TEXT,
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentPoolEntry" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "addedById" TEXT,
    "reason" TEXT,
    "jobFamily" TEXT,
    "strengthNote" TEXT,
    "reviewBy" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentPoolEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 30,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "locationId" TEXT,
    "departmentId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 30,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "assignedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakRule" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "afterMinutes" INTEGER NOT NULL,
    "breakMinutes" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'MEAL',
    "appliesToMinors" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "Skill_category_active_idx" ON "Skill"("category", "active");

-- CreateIndex
CREATE INDEX "WorkerSkill_skillId_expiresAt_idx" ON "WorkerSkill"("skillId", "expiresAt");

-- CreateIndex
CREATE INDEX "WorkerSkill_expiresAt_idx" ON "WorkerSkill"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSkill_workerId_skillId_key" ON "WorkerSkill"("workerId", "skillId");

-- CreateIndex
CREATE INDEX "JobSkillRequirement_requisitionId_idx" ON "JobSkillRequirement"("requisitionId");

-- CreateIndex
CREATE INDEX "JobSkillRequirement_jobFamily_jobLevel_idx" ON "JobSkillRequirement"("jobFamily", "jobLevel");

-- CreateIndex
CREATE INDEX "CompCycle_status_idx" ON "CompCycle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CompCycleBudget_cycleId_managerId_key" ON "CompCycleBudget"("cycleId", "managerId");

-- CreateIndex
CREATE INDEX "CompProposal_cycleId_status_idx" ON "CompProposal"("cycleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompProposal_cycleId_workerId_key" ON "CompProposal"("cycleId", "workerId");

-- CreateIndex
CREATE INDEX "Referral_referrerWorkerId_idx" ON "Referral"("referrerWorkerId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "Referral_candidateEmail_idx" ON "Referral"("candidateEmail");

-- CreateIndex
CREATE INDEX "TalentPoolEntry_status_jobFamily_idx" ON "TalentPoolEntry"("status", "jobFamily");

-- CreateIndex
CREATE UNIQUE INDEX "TalentPoolEntry_candidateId_key" ON "TalentPoolEntry"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftTemplate_name_key" ON "ShiftTemplate"("name");

-- CreateIndex
CREATE INDEX "Shift_date_status_idx" ON "Shift"("date", "status");

-- CreateIndex
CREATE INDEX "Shift_locationId_date_idx" ON "Shift"("locationId", "date");

-- CreateIndex
CREATE INDEX "ShiftAssignment_workerId_idx" ON "ShiftAssignment"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_shiftId_workerId_key" ON "ShiftAssignment"("shiftId", "workerId");

-- CreateIndex
CREATE INDEX "BreakRule_jurisdiction_active_idx" ON "BreakRule"("jurisdiction", "active");

-- AddForeignKey
ALTER TABLE "WorkerSkill" ADD CONSTRAINT "WorkerSkill_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSkill" ADD CONSTRAINT "WorkerSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkillRequirement" ADD CONSTRAINT "JobSkillRequirement_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkillRequirement" ADD CONSTRAINT "JobSkillRequirement_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "JobRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompCycleBudget" ADD CONSTRAINT "CompCycleBudget_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "CompCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompProposal" ADD CONSTRAINT "CompProposal_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "CompCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompProposal" ADD CONSTRAINT "CompProposal_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerWorkerId_fkey" FOREIGN KEY ("referrerWorkerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentPoolEntry" ADD CONSTRAINT "TalentPoolEntry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

