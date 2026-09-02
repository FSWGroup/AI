-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "checkrDefaultPackage" TEXT,
ADD COLUMN     "socialCheckEnabled" BOOLEAN NOT NULL DEFAULT false;

