/**
 * Filing a grade on a work-sample submission.
 *
 * A grader sees the submission and the rubric, and does not see the
 * candidate's name or any other grader's view until they have committed
 * their own. A grade written after reading someone else's is not a second
 * opinion, and two of those are not agreement.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { assertApplicationAccess } from "@/lib/auth/scope";
import { audit } from "@/lib/audit";
import { MAX_LEVEL, MIN_LEVEL, validateGradeSubmission } from "@/lib/worksample/rubric";
import { refreshGradedStatus, toCriterionLike } from "@/lib/worksample/service";

export const runtime = "nodejs";

const schema = z.object({
  assignmentId: z.string().min(1),
  comment: z.string().max(8000).nullish(),
  ratings: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).nullable(),
        note: z.string().max(2000).nullish(),
      }),
    )
    .default([]),
  submit: z.boolean().default(false),
  /** Set when revising after a reconciliation conversation. */
  reconciled: z.boolean().default(false),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("GRADE_WORK_SAMPLES");
  const body = await parseBody(req, schema);

  const assignment = await prisma.workSampleAssignment.findUnique({
    where: { id: body.assignmentId },
    include: { workSample: { include: { criteria: { orderBy: { orderIndex: "asc" } } } } },
  });
  if (!assignment) return apiError("That submission does not exist.", 404);
  // "A hiring manager grades work samples for their own roles" is the rule the
  // permission table states; this is what enforces it. The assignmentId comes
  // straight off the request body, so without a scope check the permission
  // reads as "grades every work sample in the company", and two such grades
  // satisfy requiredGraders with people who have no business on the role.
  await assertApplicationAccess(user, assignment.applicationId);
  if (assignment.status === "ASSIGNED" || assignment.status === "STARTED") {
    return apiError("That work sample has not been submitted yet.", 409);
  }

  const criteria = toCriterionLike(assignment.workSample.criteria);
  const existing = await prisma.workSampleGrade.findUnique({
    where: {
      assignmentId_graderId: { assignmentId: assignment.id, graderId: user.id },
    },
  });

  // A submitted grade is reopened only as an explicit reconciliation, and the
  // revision is marked as one. An independent grade and a grade revised after
  // seeing a colleague's are different evidence, and the record has to say
  // which it is holding.
  if (existing?.status === "SUBMITTED" && !body.reconciled) {
    return apiError(
      "You have already filed this grade. If you and the other grader are reconciling, revise it as a reconciliation so the record shows it was revised after discussion.",
      409,
    );
  }

  // A filed grade is never dropped back to a draft.
  //
  // `reconciled: true, submit: false` took the upsert's update branch, which
  // set the row back to DRAFT, nulled `submittedAt` and deleted every rating
  // — while `refreshGradedStatus` and the audit call, both behind
  // `if (body.submit)`, did not run. So a grade could be wiped with the
  // assignment still reading GRADED and nothing in the log, by a grader who
  // had already seen the other grade because filing is what opens the blind.
  if (existing?.status === "SUBMITTED" && !body.submit) {
    return apiError(
      "A filed grade cannot be turned back into a draft. Revise it and file it again — the record has to show what you concluded, not that you withdrew it.",
      409,
    );
  }

  const ratings = (body.ratings ?? [])
    .filter((r) => criteria.some((c) => c.id === r.criterionId))
    .map((r) => ({ ...r, note: r.note ?? null }));

  if (body.submit) {
    const errors = validateGradeSubmission(
      { ratings, comment: body.comment ?? null },
      criteria,
    );
    if (errors.length > 0) return apiError(errors.join(" "), 422);
  }

  const grade = await prisma.$transaction(async (tx) => {
    const saved = await tx.workSampleGrade.upsert({
      where: {
        assignmentId_graderId: { assignmentId: assignment.id, graderId: user.id },
      },
      create: {
        assignmentId: assignment.id,
        graderId: user.id,
        status: body.submit ? "SUBMITTED" : "DRAFT",
        comment: body.comment ?? null,
        submittedAt: body.submit ? new Date() : null,
        reconciled: body.reconciled ?? false,
      },
      update: {
        status: body.submit ? "SUBMITTED" : "DRAFT",
        comment: body.comment ?? null,
        submittedAt: body.submit ? new Date() : null,
        ...(body.reconciled ? { reconciled: true } : {}),
      },
    });
    await tx.workSampleRating.deleteMany({ where: { gradeId: saved.id } });
    if (ratings.length > 0) {
      await tx.workSampleRating.createMany({
        data: ratings.map((r) => ({
          gradeId: saved.id,
          criterionId: r.criterionId,
          criterionName: criteria.find((c) => c.id === r.criterionId)?.name ?? "",
          level: r.level,
          note: r.note ?? null,
        })),
      });
    }
    return saved;
  });

  if (body.submit || existing?.status === "SUBMITTED") {
    await refreshGradedStatus(assignment.id);
    await audit({
      userId: user.id,
      action: body.reconciled ? "work_sample.grade_reconciled" : "work_sample.graded",
      entityType: "WorkSampleGrade",
      entityId: grade.id,
      newValue: { reference: assignment.reference },
    });
  }

  return apiOk({ id: grade.id, status: grade.status });
});
