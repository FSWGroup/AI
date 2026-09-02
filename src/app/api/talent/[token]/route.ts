/**
 * The candidate's own answer about the talent pool.
 *
 * This endpoint is the only path to OPTED_IN anywhere in the system. Nothing
 * an employee can do sets that state, because it is the one fact here that
 * has to come from the person it is about.
 */

import { z } from "zod";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { requestMeta } from "@/lib/auth/session";
import { recordConsentDecision } from "@/lib/talent/service";

export const runtime = "nodejs";

const schema = z.object({
  decision: z.enum(["in", "out"]),
  interests: z.string().max(2000).nullish(),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const { token } = await ctx.params;
  const meta = await requestMeta();
  if (!rateLimit(`talent-consent:${meta.ip}`, 20, 60_000)) {
    return apiError("Too many requests. Please wait a moment.", 429);
  }
  const body = await parseBody(req, schema);
  const result = await recordConsentDecision({
    token,
    decision: body.decision,
    interests: body.interests ?? null,
  });
  if (!result.ok) return apiError(result.reason, 404);
  return apiOk({ decision: result.decision });
});
