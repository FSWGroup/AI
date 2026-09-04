/**
 * Begin the substantive assessment. Requires:
 *  - rules acknowledgment on file
 *  - recording consent on file (unless the attempt is camera-exempt)
 */

import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";
import { getCandidateState } from "@/lib/attempt/state";

export const POST = withErrorHandling(async () => {
  const attempt = await requireAttempt();
  if (attempt.status === "COMPLETED") {
    return apiError("This assessment is already complete.", 409);
  }
  if (attempt.status === "IN_PROGRESS") {
    return apiOk({ state: await getCandidateState(attempt) });
  }

  const consents = await prisma.consentRecord.findMany({
    where: { attemptId: attempt.id },
  });
  if (!consents.some((c) => c.consentType === "rules")) {
    return apiError("Please acknowledge the assessment rules first.", 409);
  }
  if (
    !attempt.cameraExempt &&
    !consents.some((c) => c.consentType === "recording")
  ) {
    return apiError("Recording consent is required before beginning.", 409);
  }

  await prisma.attempt.update({
    where: { id: attempt.id },
    data: { status: "IN_PROGRESS", startedAt: new Date(), entryStep: "assessment" },
  });
  await prisma.invitation.update({
    where: { id: attempt.invitationId },
    data: { status: "STARTED" },
  });
  await prisma.integrityEvent.create({
    data: { attemptId: attempt.id, type: "ATTEMPT_STARTED" },
  });
  const state = await getCandidateState(attempt);
  return apiOk({ state });
});
