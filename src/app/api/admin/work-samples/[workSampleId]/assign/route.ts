/** Send a work sample to a candidate and return the link. */

import { z } from "zod";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { assignWorkSample } from "@/lib/worksample/service";

export const runtime = "nodejs";

const schema = z.object({ applicationId: z.string().min(1) });

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_WORK_SAMPLES");
  const { workSampleId } = await ctx.params;
  const body = await parseBody(req, schema);

  const result = await assignWorkSample({
    workSampleId,
    applicationId: body.applicationId,
    actorId: user.id,
    baseUrl: env.appBaseUrl,
  });
  if ("error" in result) return apiError(result.error, 409);

  // The raw token is returned once, here. It is stored only as a hash, so a
  // lost link is reissued rather than looked up.
  return apiOk(result, { status: 201 });
});
