-- CreateEnum
CREATE TYPE "SchedulingRequestStatus" AS ENUM ('OPEN', 'BOOKED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('CANDIDATE_DAY_BEFORE', 'CANDIDATE_HOUR_BEFORE', 'PANELIST_DAY_BEFORE');

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Asia/Manila';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Asia/Manila';

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityException" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingRequest" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kitId" TEXT,
    "stageId" TEXT,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 45,
    "notes" TEXT,
    "meetingDetail" TEXT,
    "status" "SchedulingRequestStatus" NOT NULL DEFAULT 'OPEN',
    "reference" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "earliestAt" TIMESTAMP(3) NOT NULL,
    "latestAt" TIMESTAMP(3) NOT NULL,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 12,
    "candidateTimeZone" TEXT,
    "interviewId" TEXT,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "maxReschedules" INTEGER NOT NULL DEFAULT 2,
    "cancelledReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingPanelist" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SchedulingPanelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReminder" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "userId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvailabilityRule_userId_dayOfWeek_idx" ON "AvailabilityRule"("userId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "AvailabilityException_userId_date_idx" ON "AvailabilityException"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingRequest_reference_key" ON "SchedulingRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingRequest_tokenHash_key" ON "SchedulingRequest"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingRequest_interviewId_key" ON "SchedulingRequest"("interviewId");

-- CreateIndex
CREATE INDEX "SchedulingRequest_applicationId_idx" ON "SchedulingRequest"("applicationId");

-- CreateIndex
CREATE INDEX "SchedulingRequest_status_idx" ON "SchedulingRequest"("status");

-- CreateIndex
CREATE INDEX "SchedulingPanelist_userId_idx" ON "SchedulingPanelist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingPanelist_requestId_userId_key" ON "SchedulingPanelist"("requestId", "userId");

-- CreateIndex
CREATE INDEX "ScheduledReminder_dueAt_sentAt_idx" ON "ScheduledReminder"("dueAt", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledReminder_interviewId_kind_userId_key" ON "ScheduledReminder"("interviewId", "kind", "userId");

-- AddForeignKey
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRequest" ADD CONSTRAINT "SchedulingRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRequest" ADD CONSTRAINT "SchedulingRequest_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "InterviewKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRequest" ADD CONSTRAINT "SchedulingRequest_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRequest" ADD CONSTRAINT "SchedulingRequest_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRequest" ADD CONSTRAINT "SchedulingRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingPanelist" ADD CONSTRAINT "SchedulingPanelist_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SchedulingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingPanelist" ADD CONSTRAINT "SchedulingPanelist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReminder" ADD CONSTRAINT "ScheduledReminder_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReminder" ADD CONSTRAINT "ScheduledReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

