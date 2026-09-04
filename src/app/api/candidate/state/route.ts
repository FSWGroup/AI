import { apiOk, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";
import { getCandidateState } from "@/lib/attempt/state";

export const GET = withErrorHandling(async () => {
  const attempt = await requireAttempt();
  const state = await getCandidateState(attempt);
  return apiOk({ state });
});
