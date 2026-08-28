import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { parsePagination, listEnvelope, badRequest } from "@/app/api/v1/_lib/http";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { notify } from "@/lib/notifications";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "training.view");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const page = parsePagination(url);
  const userId = url.searchParams.get("userId");
  const status = url.searchParams.get("status");

  const where = {
    ...(userId ? { userId } : {}),
    ...(status ? { status: status as "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "WAIVED" | "EXPIRED" } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      orderBy: { assignedAt: "desc" },
      skip: page.skip,
      take: page.take,
      include: {
        course: { select: { id: true, title: true } },
        sop: { select: { id: true, sopCode: true, title: true } },
        path: { select: { id: true, title: true } },
      },
    }),
    prisma.assignment.count({ where }),
  ]);

  return listEnvelope(
    rows.map((a) => ({
      id: a.id,
      userId: a.userId,
      targetType: a.targetType,
      target: a.course ?? a.sop ?? a.path ?? null,
      status: a.status,
      source: a.source,
      reason: a.reason,
      assignedAt: a.assignedAt,
      dueAt: a.dueAt,
      completedAt: a.completedAt,
    })),
    page,
    total,
  );
}

const createSchema = z
  .object({
    userId: z.string().min(1),
    targetType: z.enum(["COURSE", "SOP", "LEARNING_PATH"]),
    courseId: z.string().optional(),
    sopId: z.string().optional(),
    pathId: z.string().optional(),
    dueAt: z.string().datetime().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => (v.targetType === "COURSE" ? Boolean(v.courseId) : v.targetType === "SOP" ? Boolean(v.sopId) : Boolean(v.pathId)), {
    message: "Provide the id matching targetType (courseId, sopId, or pathId).",
  });

/** POST /api/v1/assignments — assign training to a person (e.g. from an HRIS integration). */
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "training.assign");
  if ("error" in auth) return auth.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } });
  if (!user || user.status === "INACTIVE") return badRequest("That person does not exist or is inactive.");

  const assignment = await prisma.assignment.create({
    data: {
      userId: input.userId,
      targetType: input.targetType,
      courseId: input.courseId ?? null,
      sopId: input.sopId ?? null,
      pathId: input.pathId ?? null,
      source: "MANUAL",
      reason: input.reason ?? `Assigned via the public API (key: ${auth.ctx.apiKeyName})`,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ASSIGNMENT_CREATED,
    entityType: "ASSIGNMENT",
    entityId: assignment.id,
    metadata: { apiKeyId: auth.ctx.apiKeyId, userId: input.userId, targetType: input.targetType },
  });

  await notify({
    userId: input.userId,
    type: "TRAINING_ASSIGNED",
    title: "New training assigned",
    body: input.reason,
    linkUrl: input.targetType === "COURSE" ? `/courses/${input.courseId}` : input.targetType === "SOP" ? `/sops/${input.sopId}` : `/paths/${input.pathId}`,
    dedupeKey: `assignment:${assignment.id}`,
  });

  return Response.json({ data: { id: assignment.id, status: assignment.status, assignedAt: assignment.assignedAt } }, { status: 201 });
}
