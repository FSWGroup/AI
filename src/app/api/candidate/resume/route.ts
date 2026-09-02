/**
 * Resume endpoints:
 *  POST — exchange a resume token (from the emailed magic link / recovery
 *         screen) for the attempt cookie, restoring the exact session.
 *  PUT  — email the resume link to the candidate's address on file, given a
 *         valid invitation token. The link never goes anywhere else.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getEmailProvider } from "@/lib/email";
import {
  getAttemptByResumeToken,
  setAttemptCookie,
} from "@/lib/attempt/candidate-auth";
import { getCandidateState } from "@/lib/attempt/state";

const resumeSchema = z.object({ resumeToken: z.string().min(16).max(200) });

export const POST = withErrorHandling(async (req) => {
  const { resumeToken } = await parseBody(req, resumeSchema);
  if (!rateLimit(`resume:${resumeToken.slice(0, 12)}`, 20, 60_000)) {
    return apiError("Too many attempts. Please wait a moment.", 429);
  }
  const attempt = await getAttemptByResumeToken(resumeToken);
  if (!attempt || attempt.status === "INVALIDATED") {
    return apiError(
      "This resume link is not valid. Please contact your hiring representative.",
      404,
    );
  }
  await setAttemptCookie(resumeToken);
  const state = await getCandidateState(attempt);
  return apiOk({ state });
});

const emailSchema = z.object({ invitationToken: z.string().min(16).max(200) });

export const PUT = withErrorHandling(async (req) => {
  const { invitationToken } = await parseBody(req, emailSchema);
  if (!rateLimit(`resend:${invitationToken.slice(0, 12)}`, 3, 10 * 60_000)) {
    return apiError("A resume link was recently sent. Please check your email.", 429);
  }
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(invitationToken) },
    include: {
      candidate: true,
      attempts: { orderBy: { attemptNumber: "desc" } },
    },
  });
  const attempt = invitation?.attempts.find(
    (a) => a.status === "NOT_STARTED" || a.status === "IN_PROGRESS" || a.status === "INTERRUPTED",
  );
  // Respond identically whether or not the invitation exists (no enumeration).
  if (invitation && attempt) {
    // We cannot recover the raw resume token (only its hash is stored), so
    // rotate it: issue a fresh token and store the new hash.
    const { generateToken } = await import("@/lib/crypto");
    const newToken = generateToken();
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { resumeTokenHash: hashToken(newToken) },
    });
    await getEmailProvider().send({
      to: invitation.candidate.email,
      template: "reminder",
      subject: "Your FSW Talent Scout assessment resume link",
      bodyText:
        `Hello ${invitation.candidate.firstName},\n\n` +
        `Use this secure link to resume your assessment exactly where you left off:\n\n` +
        `${env.appBaseUrl}/assessment/resume/${newToken}\n\n` +
        `This link is personal to you. Do not share it.\n\n` +
        `Record ID: ${attempt.recordId}`,
    });
  }
  return apiOk({
    message:
      "If your assessment is on file, a resume link has been emailed to the address we have for you.",
  });
});
