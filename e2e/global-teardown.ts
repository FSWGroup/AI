import { PrismaClient } from "@prisma/client";

export default async function globalTeardown(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // Retire the E2E form so ordinary invitations go back to the standard
    // form (invitation creation picks the highest ACTIVE version).
    await prisma.assessmentVersion.updateMany({
      where: { name: "FSW WorkFit E2E", versionNumber: 99 },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
  } finally {
    await prisma.$disconnect();
  }
}
