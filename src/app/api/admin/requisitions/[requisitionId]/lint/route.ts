/** Lint a requisition's public copy. Read-only and cheap; safe to call live. */

import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { lintJobDescription } from "@/lib/ats/jd-linter";

export const GET = withErrorHandling(async (_req, ctx) => {
  await requirePermission("VIEW_REQUISITIONS");
  const { requisitionId } = await ctx.params;

  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: { location: true },
  });
  if (!requisition) return apiError("Requisition not found.", 404);

  return apiOk({
    result: lintJobDescription({
      title: requisition.title,
      summary: requisition.summary,
      description: requisition.description,
      responsibilities: requisition.responsibilities,
      requirements: requisition.requirements,
      benefits: requisition.benefits,
      salaryMin: requisition.salaryMin,
      salaryMax: requisition.salaryMax,
      salaryPublish: requisition.salaryPublish,
      locationRegion: requisition.location?.region ?? null,
      locationCountry: requisition.location?.country ?? "PH",
    }),
  });
});
