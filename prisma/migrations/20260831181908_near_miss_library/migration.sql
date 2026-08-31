-- CreateEnum
CREATE TYPE "NearMissCategory" AS ENUM ('PRODUCT_SELECTION', 'ORDER_ACCURACY', 'WAREHOUSE_SAFETY', 'CUSTOMER_COMMITMENT', 'DATA_SECURITY', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "NearMissSeverity" AS ENUM ('NEAR_MISS', 'MINOR', 'SIGNIFICANT', 'SERIOUS');

-- CreateEnum
CREATE TYPE "NearMissStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'NEAR_MISS';

-- CreateTable
CREATE TABLE "NearMiss" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "NearMissCategory" NOT NULL,
    "severity" "NearMissSeverity" NOT NULL,
    "status" "NearMissStatus" NOT NULL DEFAULT 'REPORTED',
    "departmentId" TEXT,
    "businessUnitId" TEXT,
    "locationId" TEXT,
    "occurredOn" TIMESTAMP(3),
    "whatHappened" TEXT NOT NULL,
    "howItWasCaught" TEXT,
    "whyItHappened" TEXT,
    "whatChanged" TEXT,
    "reportedById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "preventingSopId" TEXT,
    "teachingCourseId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NearMiss_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NearMiss_reference_key" ON "NearMiss"("reference");

-- CreateIndex
CREATE INDEX "NearMiss_status_severity_idx" ON "NearMiss"("status", "severity");

-- CreateIndex
CREATE INDEX "NearMiss_category_idx" ON "NearMiss"("category");

-- CreateIndex
CREATE INDEX "NearMiss_departmentId_idx" ON "NearMiss"("departmentId");

-- CreateIndex
CREATE INDEX "NearMiss_businessUnitId_idx" ON "NearMiss"("businessUnitId");

-- CreateIndex
CREATE INDEX "NearMiss_locationId_idx" ON "NearMiss"("locationId");

-- CreateIndex
CREATE INDEX "NearMiss_preventingSopId_idx" ON "NearMiss"("preventingSopId");

-- CreateIndex
CREATE INDEX "NearMiss_occurredOn_idx" ON "NearMiss"("occurredOn");

-- AddForeignKey
ALTER TABLE "NearMiss" ADD CONSTRAINT "NearMiss_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NearMiss" ADD CONSTRAINT "NearMiss_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NearMiss" ADD CONSTRAINT "NearMiss_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NearMiss" ADD CONSTRAINT "NearMiss_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NearMiss" ADD CONSTRAINT "NearMiss_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NearMiss" ADD CONSTRAINT "NearMiss_preventingSopId_fkey" FOREIGN KEY ("preventingSopId") REFERENCES "Sop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NearMiss" ADD CONSTRAINT "NearMiss_teachingCourseId_fkey" FOREIGN KEY ("teachingCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
