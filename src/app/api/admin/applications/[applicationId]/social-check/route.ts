/**
 * Start a social media review: record who asked, and send the candidate the
 * consent-and-disclosure link.
 *
 * Nothing is looked at until the candidate has read the statement and chosen
 * which profiles to share. That order is the whole design — searching first
 * and asking afterwards is not consent.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/index";
import {
  canStartCheck,
  canReview,
  CONSENT_STATEMENT_VERSION,
} from "@/lib/ats/social-check";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.object({
  reviewerId: z.string(),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await getCurrentUser();
  if (!user) return apiError("Not signed in.", 401);
  if (!can(user.role, "MANAGE_SOCIAL_CHECKS")) {
    return apiError("You cannot start a social media review.", 403);
  }
  const { applicationId } = await ctx.params;
  const body = await parseBody(req, schema);

  const [application, settings] = await Promise.all([
    prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidate: true,
        stage: true,
        socialMediaCheck: true,
        requisition: {
          include: { team: true },
        },
      },
    }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  if (!application) return apiError("Application not found.", 404);
  if (application.socialMediaCheck) {
    return apiError("A social media review already exists for this candidate.", 409);
  }

  const gate = canStartCheck({
    applicationStatus: application.status,
    stageKind: application.stage?.kind ?? null,
    enabled: settings?.socialCheckEnabled ?? false,
  });
  if (!gate.allowed) return apiError(gate.reason ?? "Not available.", 409);

  // Anyone on the hiring team who decides is disqualified from reviewing.
  const deciderIds = application.requisition.team
    .filter((t) => t.role === "HIRING_MANAGER" || t.role === "RECRUITER")
    .map((t) => t.userId);
  const reviewerGate = canReview({
    reviewerId: body.reviewerId,
    hiringTeamDeciderIds: deciderIds,
  });
  if (!reviewerGate.allowed) return apiError(reviewerGate.reason!, 422);

  const reviewer = await prisma.user.findUnique({ where: { id: body.reviewerId } });
  if (!reviewer || !reviewer.active) return apiError("Reviewer not found.", 404);
  if (!can(reviewer.role, "CONDUCT_SOCIAL_REVIEW")) {
    return apiError("That person is not permitted to conduct social reviews.", 422);
  }

  const token = generateToken();
  const check = await prisma.$transaction(async (tx) => {
    const created = await tx.socialMediaCheck.create({
      data: {
        applicationId,
        status: "CONSENT_REQUESTED",
        consentTokenHash: hashToken(token),
        consentRequestedAt: new Date(),
        consentStatementVersion: CONSENT_STATEMENT_VERSION,
        reviewerId: body.reviewerId,
        requestedById: user.id,
      },
    });
    await logRequisitionEvent(tx, {
      requisitionId: application.requisitionId,
      type: "SOCIAL_CHECK_REQUESTED",
      summary: `Social media review requested for ${application.reference}; consent link sent.`,
      actorId: user.id,
    });
    return created;
  });

  const url = `${env.appBaseUrl}/social-check/${token}`;
  const settingsName = settings?.companyName ?? "FSW Group";
  await sendEmail({
    to: application.candidate.email,
    template: "interview_invitation",
    subject: `A quick step in your application with ${settingsName}`,
    bodyText: `Hi ${application.candidate.firstName},

As part of the final stage of your application we ask candidates to review and, if they choose, take part in a short social media check.

It is voluntary, you choose what to share, and declining does not count against you. Everything it involves is explained here:

${url}

${settingsName} Recruiting`,
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.SOCIAL_CHECK_REQUESTED,
    entityType: "SocialMediaCheck",
    entityId: check.id,
    newValue: { applicationId, reviewerId: body.reviewerId },
  });

  return apiOk({ checkId: check.id, consentUrl: url });
});
