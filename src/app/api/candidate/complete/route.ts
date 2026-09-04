import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";
import { completeAttempt } from "@/lib/attempt/complete";

export const POST = withErrorHandling(async () => {
  const attempt = await requireAttempt();
  if (attempt.status === "COMPLETED") return apiOk({ completed: true });
  if (attempt.status !== "IN_PROGRESS") {
    return apiError("The assessment is not in progress.", 409);
  }

  // All sections must be finished (completed or expired).
  const open = await prisma.attemptSection.count({
    where: { attemptId: attempt.id, status: { in: ["PENDING", "IN_PROGRESS"] } },
  });
  if (open > 0) {
    return apiError("Please finish all sections before submitting.", 409);
  }

  await completeAttempt(attempt.id);
  return apiOk({ completed: true });
});
