/**
 * The candidate's answer about being recorded.
 *
 * The only path by which a candidate's consent can be set. Nobody inside the
 * organization can record it on their behalf, because a consent an employer
 * can enter for you is not consent.
 */

import { z } from "zod";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { requestMeta } from "@/lib/auth/session";
import {
  loadConsentByToken,
  recordDecision,
} from "@/lib/interview-intel/service";

export const runtime = "nodejs";

// WITHDRAWN is here because the wording the candidate agreed to says it is:
// "you can change your mind during or after the interview". The link stays
// live after a yes so that sentence is something they can act on themselves,
// rather than a favour they have to ask an employee for.
const schema = z.object({
  decision: z.enum(["GRANTED", "DECLINED", "WITHDRAWN"]),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const { token } = await ctx.params;
  const meta = await requestMeta();
  if (!rateLimit(`interview-consent:${meta.ip}`, 20, 60_000)) {
    return apiError("Too many requests. Please wait a moment.", 429);
  }

  const consent = await loadConsentByToken(token);
  if (!consent) return apiError("That link is not valid.", 404);

  const body = await parseBody(req, schema);
  await recordDecision({
    interviewId: consent.interviewId,
    party: "CANDIDATE",
    userId: null,
    status: body.decision,
    ip: meta.ip,
    userAgent: req.headers.get("user-agent"),
  });

  return apiOk({ decision: body.decision });
});
