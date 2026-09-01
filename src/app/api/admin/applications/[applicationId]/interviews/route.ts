/**
 * Schedule an interview and open a scorecard for each participant who is
 * expected to submit one.
 *
 * Creating the scorecards up front, rather than when someone gets round to
 * writing one, is what makes "who still owes a scorecard" answerable — and an
 * unanswered scorecard is the most common way a structured process quietly
 * reverts to a hallway conversation.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.object({
  title: z.string().min(2).max(160),
  stageId: z.string().nullable().optional(),
  kitId: z.string().nullable().optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480).default(45),
  meetingDetail: z.string().max(500).nullable().optional(),
  participantIds: z.array(z.string()).min(1).max(12),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await getCurrentUser();
  if (!user) return apiError("Not signed in.", 401);
  if (!can(user.role, "MANAGE_INTERVIEWS")) {
    return apiError("You cannot schedule interviews.", 403);
  }
  const { applicationId } = await ctx.params;
  const body = await parseBody(req, schema);

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, reference: true, requisitionId: true, status: true },
  });
  if (!application) return apiError("Application not found.", 404);
  if (application.status !== "ACTIVE") {
    return apiError("This application is not active.", 409);
  }

  const kit = body.kitId
    ? await prisma.interviewKit.findUnique({
        where: { id: body.kitId },
        include: { competencies: { orderBy: { orderIndex: "asc" } } },
      })
    : null;

  const interview = await prisma.$transaction(async (tx) => {
    const created = await tx.interview.create({
      data: {
        applicationId,
        stageId: body.stageId || null,
        kitId: kit?.id ?? null,
        title: body.title.trim(),
        scheduledAt: new Date(body.scheduledAt),
        durationMinutes: kit?.durationMinutes ?? body.durationMinutes,
        meetingDetail: body.meetingDetail || null,
        scheduledById: user.id,
      },
    });
    await tx.interviewParticipant.createMany({
      data: body.participantIds.map((userId) => ({
        interviewId: created.id,
        userId,
      })),
      skipDuplicates: true,
    });

    // One scorecard per participant, pre-seeded with the kit's competencies so
    // everyone rates the same things.
    for (const userId of body.participantIds) {
      const scorecard = await tx.scorecard.create({
        data: { applicationId, interviewId: created.id, authorId: userId },
      });
      if (kit && kit.competencies.length > 0) {
        await tx.scorecardRating.createMany({
          data: kit.competencies.map((c) => ({
            scorecardId: scorecard.id,
            competencyId: c.id,
            competencyName: c.name,
          })),
        });
      }
    }

    await tx.application.update({
      where: { id: applicationId },
      data: { lastActivityAt: new Date() },
    });
    await logRequisitionEvent(tx, {
      requisitionId: application.requisitionId,
      type: "INTERVIEW_SCHEDULED",
      summary: `${body.title} scheduled for application ${application.reference}.`,
      actorId: user.id,
      meta: { applicationId, interviewId: created.id },
    });
    return created;
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.INTERVIEW_SCHEDULED,
    entityType: "Interview",
    entityId: interview.id,
    newValue: { applicationId, participants: body.participantIds.length },
  });

  return apiOk({ interviewId: interview.id });
});
