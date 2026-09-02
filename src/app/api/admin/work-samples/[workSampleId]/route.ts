/** Activate or retire a work sample. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { validateRubric } from "@/lib/worksample/rubric";
import { toCriterionLike } from "@/lib/worksample/service";

export const runtime = "nodejs";

const schema = z.object({ status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]) });

export const PATCH = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_WORK_SAMPLES");
  const { workSampleId } = await ctx.params;
  const body = await parseBody(req, schema);

  const sample = await prisma.workSample.findUnique({
    where: { id: workSampleId },
    include: { criteria: true },
  });
  if (!sample) return apiError("That work sample does not exist.", 404);

  if (body.status === "ACTIVE") {
    const problems = validateRubric(toCriterionLike(sample.criteria));
    if (problems.length > 0) {
      return apiError(
        `The rubric is not ready to go out: ${problems.map((p) => p.message).join(" ")}`,
        409,
      );
    }
  }

  await prisma.workSample.update({
    where: { id: workSampleId },
    data: { status: body.status },
  });

  await audit({
    userId: user.id,
    action: "work_sample.status_changed",
    entityType: "WorkSample",
    entityId: workSampleId,
    previousValue: { status: sample.status },
    newValue: { status: body.status },
  });

  return apiOk({ ok: true });
});
