import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_status"),
    status: z.enum(["DRAFT", "REVIEW", "APPROVED", "RETIRED"]),
  }),
  z.object({
    action: z.literal("new_version"),
    prompt: z.string().min(3).max(4000),
    choices: z.array(z.string().min(1).max(500)).min(2).max(6).optional(),
    correctIndex: z.number().int().min(0).max(5).nullable().optional(),
    explanation: z.string().max(2000).optional(),
    difficulty: z.number().int().min(1).max(3).optional(),
    reverseCoded: z.boolean().optional(),
  }),
]);

/** Allowed workflow transitions: Draft → Review → Approved → Retired. */
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["APPROVED", "DRAFT"],
  APPROVED: ["RETIRED"],
  RETIRED: [],
};

export const PATCH = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_QUESTIONS");
  const { questionId } = await ctx.params;
  const body = await parseBody(req, schema);

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!question) return apiError("Question not found.", 404);

  if (body.action === "set_status") {
    if (!TRANSITIONS[question.status]?.includes(body.status)) {
      return apiError(
        `Cannot move a ${question.status.toLowerCase()} question to ${body.status.toLowerCase()}.`,
        409,
      );
    }
    await prisma.question.update({
      where: { id: questionId },
      data: { status: body.status },
    });
    if (body.status === "APPROVED") {
      await prisma.questionVersion.update({
        where: {
          questionId_version: { questionId, version: question.currentVersion },
        },
        data: { reviewedById: user.id, approvedAt: new Date() },
      });
    }
    await audit({
      userId: user.id,
      action:
        body.status === "APPROVED"
          ? AUDIT_ACTIONS.QUESTION_APPROVED
          : AUDIT_ACTIONS.QUESTION_STATUS_CHANGED,
      entityType: "Question",
      entityId: questionId,
      previousValue: { status: question.status },
      newValue: { status: body.status },
    });
    return apiOk({ ok: true });
  }

  // New immutable version; the question returns to DRAFT for re-review.
  // Historical attempts keep rendering the version they served.
  const latest = question.versions[0];
  const nextVersion = question.currentVersion + 1;
  await prisma.$transaction([
    prisma.questionVersion.create({
      data: {
        questionId,
        version: nextVersion,
        construct: question.construct,
        subtype: question.subtype,
        kind: question.kind,
        prompt: body.prompt,
        choices: body.choices ?? (latest.choices ?? undefined),
        correctIndex:
          body.correctIndex === undefined ? latest.correctIndex : body.correctIndex,
        explanation: body.explanation ?? latest.explanation,
        difficulty: body.difficulty ?? latest.difficulty,
        reverseCoded: body.reverseCoded ?? latest.reverseCoded,
        pairKey: latest.pairKey,
        impressionManagement: latest.impressionManagement,
      },
    }),
    prisma.question.update({
      where: { id: questionId },
      data: { currentVersion: nextVersion, status: "DRAFT" },
    }),
  ]);
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.QUESTION_UPDATED,
    entityType: "Question",
    entityId: questionId,
    previousValue: { version: question.currentVersion },
    newValue: { version: nextVersion },
  });
  return apiOk({ ok: true, version: nextVersion });
});
