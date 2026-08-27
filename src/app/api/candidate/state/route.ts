import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { getAttemptFromCookie } from "@/lib/attempt/candidate-auth";
import { getCandidateState } from "@/lib/attempt/state";

export const GET = withErrorHandling(async () => {
  const attempt = await getAttemptFromCookie();
  if (!attempt) return apiError("No active assessment session.", 401);
  const state = await getCandidateState(attempt);
  return apiOk({ state });
});
