/**
 * Opens an invitation: validates the invitation token, creates the attempt
 * (freezing its question set) on first open, and issues the attempt cookie.
 * If an attempt already exists but this browser has no cookie, the candidate
 * must use their resume link (we offer to email it) — the invitation token
 * alone never re-authenticates an in-progress attempt.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { hashToken } from "@/lib/crypto";
import { createAttempt } from "@/lib/attempt/engine";
import { getCandidateState } from "@/lib/attempt/state";
import {
  getAttemptFromCookie,
  setAttemptCookie,
} from "@/lib/attempt/candidate-auth";

const schema = z.object({ token: z.string().min(16).max(200) });

export const POST = withErrorHandling(async (req) => {
  const { token } = await parseBody(req, schema);
  if (!rateLimit(`open:${token.slice(0, 12)}`, 20, 60_000)) {
    return apiError("Too many attempts. Please wait a moment.", 429);
  }

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { attempts: { orderBy: { attemptNumber: "desc" } } },
  });
  if (!invitation || invitation.status === "REVOKED") {
    return apiError(
      "This assessment link is not valid. Please contact your hiring representative.",
      404,
    );
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    return apiError(
      "Your assessment link has expired. Please contact your hiring representative.",
      410,
    );
  }

  const activeAttempt = invitation.attempts.find(
    (a) => a.status !== "INVALIDATED" && a.status !== "EXPIRED",
  );

  if (activeAttempt) {
    if (activeAttempt.status === "COMPLETED") {
      return apiOk({ alreadyCompleted: true });
    }
    // Same browser (cookie present and matching) → continue seamlessly.
    const cookieAttempt = await getAttemptFromCookie();
    if (cookieAttempt && cookieAttempt.id === activeAttempt.id) {
      const state = await getCandidateState(cookieAttempt);
      return apiOk({ state });
    }
    // Different browser / lost cookie → require the resume link.
    return apiOk({ resumeRequired: true, recordId: activeAttempt.recordId });
  }

  // First open: create the attempt with a frozen question set.
  const { attempt, resumeToken } = await createAttempt({
    invitationId: invitation.id,
    candidateId: invitation.candidateId,
    jobOpeningId: invitation.jobOpeningId,
    assessmentVersionId: invitation.assessmentVersionId,
    attemptNumber: invitation.attempts.length + 1,
  });
  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: "OPENED" },
  });
  await setAttemptCookie(resumeToken);
  const state = await getCandidateState(attempt);
  return apiOk({ state, resumeToken });
});
