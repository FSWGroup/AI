-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "synthetic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "NormTable" ADD COLUMN     "syntheticSampleSize" INTEGER NOT NULL DEFAULT 0;

