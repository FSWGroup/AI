import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getAttemptFromCookie } from "@/lib/attempt/candidate-auth";
import { startSection, sectionRemainingSeconds } from "@/lib/attempt/engine";
import { getSectionQuestions } from "@/lib/attempt/state";

const schema = z.object({ sectionKey: z.string().min(1).max(50) });

export const POST = withErrorHandling(async (req) => {
  const attempt = await getAttemptFromCookie();
  if (!attempt) return apiError("No active assessment session.", 401);
  if (attempt.status !== "IN_PROGRESS") {
    return apiError("The assessment is not in progress.", 409);
  }
  const { sectionKey } = await parseBody(req, schema);

  const section = await startSection(attempt, sectionKey);
  if (section.status === "COMPLETED" || section.status === "EXPIRED") {
    return apiError("This section is closed and cannot be reopened.", 409);
  }
  await prisma.integrityEvent.create({
    data: { attemptId: attempt.id, type: "SECTION_STARTED", meta: { sectionKey } },
  });

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
