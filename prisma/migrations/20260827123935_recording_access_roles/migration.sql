-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "recordingAccessRoles" TEXT[] DEFAULT ARRAY['SUPER_ADMIN', 'HR_ADMIN']::TEXT[];
