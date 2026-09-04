/**
 * Recompute a study.
 *
 * Idempotent and safe to run as often as you like — every run replaces the
 * stored coefficients and stamps the date, so the results always describe the
 * data as it stood when the button was pressed.
 */

import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { runStudy } from "@/lib/validation/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("MANAGE_VALIDATION");
  const { studyId } = await ctx.params;

  // Checked before running: findUniqueOrThrow inside the service would turn a
  // mistyped id into a 500, which reads like the server is broken rather than
  // like the study does not exist.
  const exists = await prisma.validationStudy.findUnique({
    where: { id: studyId },
    select: { id: true },
  });
  if (!exists) return apiError("That study does not exist.", 404);

  const result = await runStudy(studyId, user.id);
  return apiOk({
    n: result.n,
    supported: result.coefficients.filter((c) => c.verdict === "SUPPORTED").length,
    warnings: result.warnings,
  });
});
