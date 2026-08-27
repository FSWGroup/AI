/**
 * Autosave a response. Correctness is computed server-side and never
 * returned. Saves are rejected once the section's server deadline passes.
 */

import { z } from "zod";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getAttemptFromCookie } from "@/lib/attempt/candidate-auth";
import { saveResponse } from "@/lib/attempt/engine";

const schema = z.object({
  attemptQuestionId: z.string().min(1).max(50),
  value: z.number().int().min(0).max(10),
  responseTimeMs: z.number().int().min(0).max(3_600_000).optional(),
});

export const POST = withErrorHandling(async (req) => {
  const attempt = await getAttemptFromCookie();
  if (!attempt) return apiError("No active assessment session.", 401);
  if (attempt.status !== "IN_PROGRESS") {
    return apiError("The assessment is not in progress.", 409);
  }
  const body = await parseBody(req, schema);
  const result = await saveResponse({
    attempt,
    attemptQuestionId: body.attemptQuestionId,
    value: body.value,
    responseTimeMs: body.responseTimeMs,
  });
  if (!result.saved) {
    return apiError(result.reason ?? "Could not save the answer.", 409);
  }
  return apiOk({ saved: true });
});
