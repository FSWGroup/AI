/**
 * Save or file an independent review.
 *
 * Only the reviewer may write to their own, and a filed review is sealed —
 * the same rule as interview scorecards, and for the same reason: a review
 * that can be revised after reading the panel is not an independent one.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAnyUser } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { validateSubmission } from "@/lib/ats/scorecards";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.object({
  action: z.enum(["save", "submit"]),
  recommendation: z.enum(["STRONG_NO", "NO", "YES", "STRONG_YES"]).nullable().optional(),
  summary: z.string().max(10000).nullable().optional(),
  ratings: z
    .array(
      z.object({
        criterionName: z.string().min(1).max(200),
        rating: z.number().int().min(1).max(4).nullable(),
        note: z.string().max(5000).nullable().optional(),
      }),
    )
    .max(30)
    .default([]),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requireAnyUser();
  const { reviewId } = await ctx.params;
  const body = await parseBody(req, schema);
  const ratings = body.ratings ?? [];

  const review = await prisma.candidateReview.findUnique({
    where: { id: reviewId },
    include: {
      round: {
        include: {
          kit: { include: { competencies: { orderBy: { orderIndex: "asc" } } } },
          application: { select: { reference: true, requisitionId: true } },
        },
      },
    },
  });
  if (!review) return apiError("Review not found.", 404);
  if (review.reviewerId !== user.id) {
    return apiError("A review can only be written by the person asked for it.", 403);
  }
  if (review.status === "SUBMITTED") {
    return apiError(
      "This review was filed and cannot be changed. Add a note to the application if you have something to add.",
      409,
    );
  }
  if (review.round.status === "CLOSED") {
    return apiError("This review round is closed.", 409);
  }

  if (body.action === "submit") {
    const required = review.round.kit?.competencies.map((c) => c.name) ?? [];
    const check = validateSubmission({
      recommendation: body.recommendation ?? null,
      summary: body.summary ?? null,
      ratings: ratings.map((r) => ({
        competencyName: r.criterionName,
        rating: r.rating,
      })),
      requiredCompetencies: required,
    });
    if (!check.ok) return apiError(check.errors.join(" "), 422);
  }

  await prisma.$transaction(async (tx) => {
    await tx.candidateReview.update({
      where: { id: reviewId },
      data: {
        recommendation: body.recommendation ?? null,
        summary: body.summary ?? null,
        status: body.action === "submit" ? "SUBMITTED" : "DRAFT",
        submittedAt: body.action === "submit" ? new Date() : null,
      },
    });
    for (const r of ratings) {
      await tx.candidateReviewRating.upsert({
        where: {
          reviewId_criterionName: { reviewId, criterionName: r.criterionName },
        },
        create: {
          reviewId,
          criterionName: r.criterionName,
          rating: r.rating,
          note: r.note ?? null,
        },
        update: { rating: r.rating, note: r.note ?? null },
      });
    }
    if (body.action === "submit") {
      await logRequisitionEvent(tx, {
        requisitionId: review.round.application.requisitionId,
        type: "REVIEW_SUBMITTED",
        summary: `${user.name} filed a review for ${review.round.application.reference}.`,
        actorId: user.id,
      });
    }
  });

  if (body.action === "submit") {
    await audit({
      userId: user.id,
      action: AUDIT_ACTIONS.REVIEW_SUBMITTED,
      entityType: "CandidateReview",
      entityId: reviewId,
      newValue: { recommendation: body.recommendation },
    });
  }

  return apiOk({ ok: true });
});
