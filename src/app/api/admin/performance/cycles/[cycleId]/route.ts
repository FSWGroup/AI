/** Open or close a review cycle. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  status: z.enum(["DRAFT", "OPEN", "CLOSED"]),
});

export const PATCH = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_VALIDATION");
  const { cycleId } = await ctx.params;
  const body = await parseBody(req, patchSchema);

  const existing = await prisma.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!existing) return apiError("That cycle does not exist.", 404);

  if (body.status === "DRAFT" && existing.status !== "DRAFT") {
    // Reviews already filed against an open cycle stay filed. Sending it back
    // to draft would hide them from the people who wrote them.
    return apiError("A cycle that has been opened cannot go back to draft.", 409);
  }

  await prisma.performanceCycle.update({
    where: { id: cycleId },
    data: {
      status: body.status,
      ...(body.status === "OPEN" && !existing.opensAt ? { opensAt: new Date() } : {}),
      ...(body.status === "CLOSED" ? { closesAt: new Date() } : {}),
    },
  });

  await audit({
    userId: user.id,
    action: "performance_cycle.status_changed",
    entityType: "PerformanceCycle",
    entityId: cycleId,
    previousValue: { status: existing.status },
    newValue: { status: body.status },
  });

  return apiOk({ ok: true });
});
