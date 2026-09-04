/** Re-fetch the OPEN section's questions after a refresh/reconnect. */

import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";
import { sweepExpiredSections, sectionRemainingSeconds } from "@/lib/attempt/engine";
import { getSectionQuestions } from "@/lib/attempt/state";

export const GET = withErrorHandling(async (req) => {
  const attempt = await requireAttempt();
  const url = new URL(req.url);
  const sectionKey = url.searchParams.get("key");
  if (!sectionKey) return apiError("Missing section key.", 422);

  await sweepExpiredSections(attempt.id);
  const section = await prisma.attemptSection.findUnique({
    where: { attemptId_sectionKey: { attemptId: attempt.id, sectionKey } },
  });
  if (!section || section.status !== "IN_PROGRESS") {
    return apiError("This section is not open.", 409);
  }

  const questions = await getSectionQuestions(attempt, sectionKey);
  return apiOk({
    section: {
      key: section.sectionKey,
      timed: section.timed && !attempt.untimed,
      durationSeconds: section.durationSeconds,
      remainingSeconds: sectionRemainingSeconds(section),
    },
    questions,
  });
});
