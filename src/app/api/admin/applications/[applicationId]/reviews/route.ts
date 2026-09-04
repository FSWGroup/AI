/** Open a review round: ask named people to assess a candidate independently. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { assertApplicationAccess } from "@/lib/auth/scope";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.object({
  name: z.string().min(2).max(160),
  reviewerIds: z.array(z.string()).min(1).max(20),
  kitId: z.string().nullable().optional(),
  blind: z.boolean().default(true),
  dueAt: z.string().datetime().nullable().optional(),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await getCurrentUser();
  if (!user) return apiError("Not signed in.", 401);
  if (!can(user.role, "MANAGE_PIPELINE")) {
    return apiError("You cannot open review rounds.", 403);
  }
  const { applicationId } = await ctx.params;
  // MANAGE_PIPELINE and its siblings are held globally by HIRING_MANAGER, so
  // the permission answers "may you do this?" and nothing answered "to whose
  // candidate?". The scope check is what answers that.
  await assertApplicationAccess(user, applicationId);
  const body = await parseBody(req, schema);

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, reference: true, requisitionId: true, status: true },
  });
  if (!application) return apiError("Application not found.", 404);
  if (application.status !== "ACTIVE") {
    return apiError("This application is not active.", 409);
  }

  const round = await prisma.$transaction(async (tx) => {
    const created = await tx.reviewRound.create({
      data: {
        applicationId,
        requisitionId: application.requisitionId,
        name: body.name.trim(),
        kitId: body.kitId || null,
        blind: body.blind,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        requestedById: user.id,
      },
    });
    // A review row per reviewer, created now so "who still owes one" is
    // answerable from the moment the round opens.
    await tx.candidateReview.createMany({
      data: body.reviewerIds.map((reviewerId) => ({
        roundId: created.id,
        reviewerId,
      })),
      skipDuplicates: true,
    });
    await logRequisitionEvent(tx, {
      requisitionId: application.requisitionId,
      type: "REVIEW_ROUND_OPENED",
      summary: `${user.name} asked ${body.reviewerIds.length} ${body.reviewerIds.length === 1 ? "person" : "people"} to review ${application.reference}.`,
      actorId: user.id,
      meta: { applicationId, roundId: created.id },
    });
    return created;
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.REVIEW_ROUND_OPENED,
    entityType: "ReviewRound",
    entityId: round.id,
    newValue: { applicationId, reviewers: body.reviewerIds.length, blind: body.blind },
  });

  return apiOk({ roundId: round.id });
});
