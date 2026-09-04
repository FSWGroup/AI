/** Update an employment record: manager, status, departure. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  managerId: z.string().min(1).nullish(),
  status: z
    .enum(["ACTIVE", "ON_LEAVE", "DEPARTED_VOLUNTARY", "DEPARTED_INVOLUNTARY"])
    .optional(),
  endedAt: z.string().nullish(),
  endReason: z.string().max(500).nullish(),
  attemptId: z.string().min(1).nullish(),
});

export const PATCH = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_HIRES");
  const { hireId } = await ctx.params;
  const body = await parseBody(req, patchSchema);

  const existing = await prisma.hire.findUnique({ where: { id: hireId } });
  if (!existing) return apiError("That employment record does not exist.", 404);

  const departing =
    body.status === "DEPARTED_VOLUNTARY" || body.status === "DEPARTED_INVOLUNTARY";
  const endedAt = body.endedAt ? new Date(body.endedAt) : undefined;
  if (endedAt && Number.isNaN(endedAt.getTime())) {
    return apiError("That end date is not valid.", 422);
  }
  if (departing && !endedAt && !existing.endedAt) {
    // Retention is measured in days, so a departure with no date is a
    // departure that cannot be studied.
    return apiError("A departure needs an end date before it can be recorded.", 422);
  }

  if (body.attemptId !== undefined && body.attemptId !== null) {
    const attempt = await prisma.attempt.findUnique({
      where: { id: body.attemptId },
      include: { hire: true },
    });
    if (!attempt || attempt.candidateId !== existing.candidateId) {
      return apiError("That attempt does not belong to this person.", 422);
    }
    if (attempt.hire && attempt.hire.id !== hireId) {
      return apiError("That attempt is already linked to another employment record.", 409);
    }
  }

  const updated = await prisma.hire.update({
    where: { id: hireId },
    data: {
      ...(body.managerId !== undefined ? { managerId: body.managerId } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(endedAt ? { endedAt } : {}),
      ...(body.status === "ACTIVE" ? { endedAt: null, endReason: null } : {}),
      ...(body.endReason !== undefined ? { endReason: body.endReason } : {}),
      ...(body.attemptId !== undefined ? { attemptId: body.attemptId } : {}),
    },
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.HIRE_UPDATED,
    entityType: "Hire",
    entityId: hireId,
    previousValue: { status: existing.status, endedAt: existing.endedAt },
    newValue: { status: updated.status, endedAt: updated.endedAt },
  });

  return apiOk({ ok: true });
});
