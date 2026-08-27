import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getAttemptFromCookie } from "@/lib/attempt/candidate-auth";
import { completeSection } from "@/lib/attempt/engine";
import { getCandidateState } from "@/lib/attempt/state";

const schema = z.object({ sectionKey: z.string().min(1).max(50) });

export const POST = withErrorHandling(async (req) => {
  const attempt = await getAttemptFromCookie();
  if (!attempt) return apiError("No active assessment session.", 401);
  const { sectionKey } = await parseBody(req, schema);
  await completeSection(attempt, sectionKey);
  await prisma.integrityEvent.create({
    data: { attemptId: attempt.id, type: "SECTION_COMPLETED", meta: { sectionKey } },
  });
  const state = await getCandidateState(attempt);
  return apiOk({ state });
});
