/**
 * Attempt administration: invalidate, authorize retest, grant accommodation,
 * recalculate with the current scoring model (explicit, audited — historical
 * reports are never silently recalculated).
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission, requestMeta } from "@/lib/auth/session";
import { assertAttemptAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getEmailProvider } from "@/lib/email";
import { scoreAttempt } from "@/lib/attempt/score-attempt";
import { generateReport } from "@/lib/report/generate";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invalidate"), reason: z.string().min(3).max(500) }),
  z.object({ action: z.literal("authorize_retest") }),
  z.object({
    action: z.literal("accommodation"),
    type: z.enum([
      "EXTENDED_TIME",
      "CAMERA_EXEMPT",
      "UNTIMED",
      "ALTERNATE_PRESENTATION",
      "IN_PERSON_ADMINISTRATION",
    ]),
    timeMultiplier: z.number().min(1).max(3).optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal("recalculate") }),
  z.object({ action: z.literal("add_note"), body: z.string().min(1).max(4000) }),
  z.object({ action: z.literal("resume_link") }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_ATTEMPTS");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);
  const body = await parseBody(req, schema);
  const meta = await requestMeta();

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { invitation: { include: { candidate: true, jobOpening: true } } },
  });
  if (!attempt) return apiError("Attempt not found.", 404);

  switch (body.action) {
    case "invalidate": {
      await prisma.attempt.update({
        where: { id: attemptId },
        data: { status: "INVALIDATED", invalidatedReason: body.reason },
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.ATTEMPT_INVALIDATED,
        entityType: "Attempt",
        entityId: attemptId,
        previousValue: { status: attempt.status },
        newValue: { status: "INVALIDATED", reason: body.reason },
        ip: meta.ip,
      });
      return apiOk({ ok: true });
    }

    case "authorize_retest": {
      // Never overwrite an old attempt: issue a fresh invitation link.
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
      const { generateAssessmentCode } = await import("@/lib/crypto");
      const invitation = await prisma.invitation.create({
        data: {
          candidateId: attempt.candidateId,
          jobOpeningId: attempt.jobOpeningId,
          assessmentVersionId: attempt.assessmentVersionId,
          tokenHash: hashToken(token),
          code: generateAssessmentCode(),
          expiresAt,
          invitedById: user.id,
        },
      });
      await getEmailProvider().send({
        to: attempt.invitation.candidate.email,
        template: "retest_invitation",
        subject: "FSW Talent Scout — retest invitation",
        bodyText:
          `Hello ${attempt.invitation.candidate.firstName},\n\n` +
          `You have been authorized to retake the FSW Talent Scout assessment for ` +
          `${attempt.invitation.jobOpening.title}.\n\n` +
          `Start here: ${env.appBaseUrl}/assessment/${token}\n\n` +
          `This link expires on ${expiresAt.toDateString()}.`,
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.RETEST_AUTHORIZED,
        entityType: "Attempt",
        entityId: attemptId,
        newValue: { newInvitationId: invitation.id },
        ip: meta.ip,
      });
      return apiOk({
        ok: true,
        launchUrl: env.isProduction ? undefined : `${env.appBaseUrl}/assessment/${token}`,
      });
    }

    case "accommodation": {
      await prisma.accommodationOverride.create({
        data: {
          attemptId,
          type: body.type,
          timeMultiplier: body.timeMultiplier,
          note: body.note,
          approvedById: user.id,
        },
      });
      await prisma.attempt.update({
        where: { id: attemptId },
        data: {
          timeMultiplier:
            body.type === "EXTENDED_TIME"
              ? (body.timeMultiplier ?? 1.5)
              : attempt.timeMultiplier,
          cameraExempt: body.type === "CAMERA_EXEMPT" ? true : attempt.cameraExempt,
          untimed: body.type === "UNTIMED" ? true : attempt.untimed,
        },
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.ACCOMMODATION_GRANTED,
        entityType: "Attempt",
        entityId: attemptId,
        newValue: { type: body.type, timeMultiplier: body.timeMultiplier },
        ip: meta.ip,
      });
      return apiOk({ ok: true });
    }

    case "recalculate": {
      if (attempt.status !== "COMPLETED") {
        return apiError("Only completed attempts can be recalculated.", 409);
      }
      await scoreAttempt(attemptId);
      const reportId = await generateReport(attemptId);
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.SCORE_RECALCULATED,
        entityType: "Attempt",
        entityId: attemptId,
        newValue: { reportId },
        ip: meta.ip,
      });
      return apiOk({ ok: true, reportId });
    }

    case "resume_link": {
      // Rotate the resume token and hand the fresh link to the admin — the
      // supported path when a candidate loses their session and no email
      // provider is wired. Old links stop working immediately.
      if (!["NOT_STARTED", "IN_PROGRESS", "INTERRUPTED"].includes(attempt.status)) {
        return apiError("Only open attempts can issue a resume link.", 409);
      }
      const newToken = generateToken();
      await prisma.attempt.update({
        where: { id: attemptId },
        data: { resumeTokenHash: hashToken(newToken) },
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.RESUME_LINK_ISSUED,
        entityType: "Attempt",
        entityId: attemptId,
        ip: meta.ip,
      });
      return apiOk({
        ok: true,
        resumeUrl: `${env.appBaseUrl}/assessment/resume/${newToken}`,
      });
    }

    case "add_note": {
      const note = await prisma.candidateNote.create({
        data: {
          candidateId: attempt.candidateId,
          authorId: user.id,
          body: body.body,
        },
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.NOTE_CREATED,
        entityType: "CandidateNote",
        entityId: note.id,
        ip: meta.ip,
      });
      return apiOk({ ok: true });
    }
  }
});
