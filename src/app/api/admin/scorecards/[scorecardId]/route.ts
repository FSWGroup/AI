/**
 * Save and submit a scorecard.
 *
 * Only the author may write to their own scorecard, and a submitted one is
 * sealed. An interview evaluation that can be edited after the fact — after
 * hearing what everyone else thought — is not an independent evaluation, and
 * the whole point of collecting them separately is independence.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAnyUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { validateSubmission } from "@/lib/ats/scorecards";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.object({
  action: z.enum(["save", "submit"]),
  recommendation: z
    .enum(["STRONG_NO", "NO", "YES", "STRONG_YES"])
    .nullable()
    .optional(),
  summary: z.string().max(10000).nullable().optional(),
  ratings: z
    .array(
      z.object({
        competencyName: z.string().min(1).max(200),
        rating: z.number().int().min(1).max(4).nullable(),
        note: z.string().max(5000).nullable().optional(),
      }),
    )
    .max(30)
    .default([]),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requireAnyUser();
  if (!can(user.role, "SUBMIT_SCORECARD")) {
    return apiError("You cannot submit scorecards.", 403);
  }
  const { scorecardId } = await ctx.params;
  const body = await parseBody(req, schema);
  const ratings = body.ratings ?? [];

  const scorecard = await prisma.scorecard.findUnique({
    where: { id: scorecardId },
    include: {
      ratings: true,
      application: { select: { id: true, reference: true, requisitionId: true } },
      interview: { include: { kit: { include: { competencies: true } } } },
    },
  });
  if (!scorecard) return apiError("Scorecard not found.", 404);
  if (scorecard.authorId !== user.id) {
    return apiError("A scorecard can only be written by its author.", 403);
  }
  if (scorecard.status === "SUBMITTED") {
    return apiError(
      "This scorecard was submitted and cannot be changed. Add a note to the application if you need to add something.",
      409,
    );
  }

  if (body.action === "submit") {
    const required =
      scorecard.interview?.kit?.competencies.map((c) => c.name) ??
      scorecard.ratings.map((r) => r.competencyName);
    const check = validateSubmission({
      recommendation: body.recommendation ?? null,
      summary: body.summary ?? null,
      ratings,
      requiredCompetencies: required,
    });
    if (!check.ok) return apiError(check.errors.join(" "), 422);
  }

  await prisma.$transaction(async (tx) => {
    await tx.scorecard.update({
      where: { id: scorecardId },
      data: {
        recommendation: body.recommendation ?? null,
        summary: body.summary ?? null,
        status: body.action === "submit" ? "SUBMITTED" : "DRAFT",
        submittedAt: body.action === "submit" ? new Date() : null,
      },
    });
    for (const r of ratings) {
      await tx.scorecardRating.upsert({
        where: {
          scorecardId_competencyName: {
            scorecardId,
            competencyName: r.competencyName,
          },
        },
        create: {
          scorecardId,
          competencyName: r.competencyName,
          rating: r.rating,
          note: r.note ?? null,
        },
        update: { rating: r.rating, note: r.note ?? null },
      });
    }
    if (body.action === "submit") {
      await tx.application.update({
        where: { id: scorecard.applicationId },
        data: { lastActivityAt: new Date() },
      });
      await logRequisitionEvent(tx, {
        requisitionId: scorecard.application.requisitionId,
        type: "SCORECARD_SUBMITTED",
        summary: `${user.name} submitted a scorecard for ${scorecard.application.reference}.`,
        actorId: user.id,
      });
    }
  });

  if (body.action === "submit") {
    await audit({
      userId: user.id,
      action: AUDIT_ACTIONS.SCORECARD_SUBMITTED,
      entityType: "Scorecard",
      entityId: scorecardId,
      newValue: { recommendation: body.recommendation },
    });
  }

  return apiOk({ ok: true });
});
