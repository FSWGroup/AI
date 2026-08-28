import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { itemEnvelope, notFound } from "@/app/api/v1/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "training.view");
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: {
      course: { select: { id: true, title: true } },
      sop: { select: { id: true, sopCode: true, title: true } },
      path: { select: { id: true, title: true } },
    },
  });
  if (!assignment) return notFound("Assignment");

  return itemEnvelope({
    id: assignment.id,
    userId: assignment.userId,
    targetType: assignment.targetType,
    target: assignment.course ?? assignment.sop ?? assignment.path ?? null,
    status: assignment.status,
    source: assignment.source,
    reason: assignment.reason,
    assignedAt: assignment.assignedAt,
    startedAt: assignment.startedAt,
    dueAt: assignment.dueAt,
    completedAt: assignment.completedAt,
    waivedAt: assignment.waivedAt,
    waivedReason: assignment.waivedReason,
  });
}
