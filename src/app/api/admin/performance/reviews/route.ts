/**
 * Filing a performance review.
 *
 * A rater may only rate people they manage, and may only file one review per
 * hire per cycle. A draft can be revised; a submitted review cannot, because
 * a criterion that can be edited after the study has run is not a criterion.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit } from "@/lib/audit";
import {
  CRITERION_BY_KEY,
  PERFORMANCE_RATING_MAX,
  PERFORMANCE_RATING_MIN,
} from "@/content/performance-criteria";

export const runtime = "nodejs";

const schema = z.object({
  hireId: z.string().min(1),
  cycleId: z.string().min(1),
  overallRating: z
    .number()
    .int()
    .min(PERFORMANCE_RATING_MIN)
    .max(PERFORMANCE_RATING_MAX)
    .nullish(),
  wouldRehire: z.boolean().nullish(),
  comment: z.string().max(4000).nullish(),
  ratings: z
    .array(
      z.object({
        criterionKey: z.string().min(1),
        value: z.number().int().min(PERFORMANCE_RATING_MIN).max(PERFORMANCE_RATING_MAX),
        note: z.string().max(1000).nullish(),
      }),
    )
    .default([]),
  submit: z.boolean().default(false),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("SUBMIT_PERFORMANCE_REVIEW");
  const body = await parseBody(req, schema);

  const [hire, cycle] = await Promise.all([
    prisma.hire.findUnique({ where: { id: body.hireId } }),
    prisma.performanceCycle.findUnique({ where: { id: body.cycleId } }),
  ]);
  if (!hire) return apiError("That employment record does not exist.", 404);
  if (!cycle) return apiError("That review cycle does not exist.", 404);
  if (cycle.status !== "OPEN") return apiError("That review cycle is not open.", 409);

  // An HR admin can rate anyone; a manager rates their own people. Widening
  // this would let anyone with the permission file ratings on colleagues they
  // have never worked with, and those ratings would go straight into a study.
  const isOwnReport = hire.managerId === user.id;
  if (!isOwnReport && !can(user.role, "MANAGE_HIRES")) {
    return apiError("You can only review people who report to you.", 403);
  }

  const existing = await prisma.performanceReview.findUnique({
    where: {
      hireId_cycleId_raterId: {
        hireId: body.hireId,
        cycleId: body.cycleId,
        raterId: user.id,
      },
    },
  });
  if (existing?.status === "SUBMITTED") {
    return apiError(
      "You have already submitted this review. A submitted rating is the evidence a validity study rests on, so it cannot be edited afterwards.",
      409,
    );
  }

  const allowed = new Set(cycle.criterionKeys);
  const ratings = (body.ratings ?? []).filter(
    (r) => allowed.has(r.criterionKey) && CRITERION_BY_KEY.has(r.criterionKey),
  );

  if (body.submit) {
    if (body.overallRating === null || body.overallRating === undefined) {
      return apiError("An overall effectiveness rating is needed before submitting.", 422);
    }
    if (ratings.length < cycle.criterionKeys.length) {
      return apiError(
        "Every criterion in this cycle needs a rating before the review can be submitted. A partly filled form produces a criterion on a different scale from everyone else's.",
        422,
      );
    }
  }

  const review = await prisma.$transaction(async (tx) => {
    const saved = await tx.performanceReview.upsert({
      where: {
        hireId_cycleId_raterId: {
          hireId: body.hireId,
          cycleId: body.cycleId,
          raterId: user.id,
        },
      },
      create: {
        hireId: body.hireId,
        cycleId: body.cycleId,
        raterId: user.id,
        overallRating: body.overallRating ?? null,
        wouldRehire: body.wouldRehire ?? null,
        comment: body.comment ?? null,
        status: body.submit ? "SUBMITTED" : "DRAFT",
        submittedAt: body.submit ? new Date() : null,
      },
      update: {
        overallRating: body.overallRating ?? null,
        wouldRehire: body.wouldRehire ?? null,
        comment: body.comment ?? null,
        status: body.submit ? "SUBMITTED" : "DRAFT",
        submittedAt: body.submit ? new Date() : null,
      },
    });
    await tx.performanceRating.deleteMany({ where: { reviewId: saved.id } });
    if (ratings.length > 0) {
      await tx.performanceRating.createMany({
        data: ratings.map((r) => ({
          reviewId: saved.id,
          criterionKey: r.criterionKey,
          value: r.value,
          note: r.note ?? null,
        })),
      });
    }
    return saved;
  });

  if (body.submit) {
    await audit({
      userId: user.id,
      action: "performance_review.submitted",
      entityType: "PerformanceReview",
      entityId: review.id,
      newValue: { hireId: body.hireId, cycleId: body.cycleId },
    });
  }

  return apiOk({ id: review.id, status: review.status });
});
