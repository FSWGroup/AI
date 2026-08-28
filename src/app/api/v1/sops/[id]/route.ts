import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { itemEnvelope, notFound } from "@/app/api/v1/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "sop.view");
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const sop = await prisma.sop.findFirst({
    where: { id, isDeleted: false },
    select: {
      id: true,
      sopCode: true,
      kind: true,
      title: true,
      summary: true,
      category: true,
      status: true,
      reviewCycleDays: true,
      lastReviewedAt: true,
      nextReviewAt: true,
      currentVersion: { select: { versionNumber: true, publishedAt: true } },
    },
  });
  if (!sop) return notFound("SOP");

  return itemEnvelope({
    ...sop,
    currentVersionLabel: sop.currentVersion?.versionNumber ?? null,
    publishedAt: sop.currentVersion?.publishedAt ?? null,
    currentVersion: undefined,
  });
}
