import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { itemEnvelope, notFound } from "@/app/api/v1/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reports.view");
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const record = await prisma.completionRecord.findUnique({
    where: { id },
    include: { certificate: { select: { certificateNumber: true, verificationToken: true } } },
  });
  if (!record) return notFound("Completion");

  return itemEnvelope({
    id: record.id,
    userId: record.userId,
    targetType: record.targetType,
    title: record.titleSnapshot,
    versionLabel: record.versionLabel,
    scorePercent: record.scorePercent,
    attemptCount: record.attemptCount,
    durationMinutes: record.durationMinutes,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    expiresAt: record.expiresAt,
    certificateNumber: record.certificate?.certificateNumber ?? null,
  });
}
