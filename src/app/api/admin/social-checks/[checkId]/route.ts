/**
 * The reviewer's actions: record findings and close the review.
 *
 * Only the assigned reviewer may write here, and every finding is validated
 * against the protected-characteristic rule before it is stored — the check
 * that matters most, because a finding once written tends to get read.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { validateFinding } from "@/lib/ats/social-check";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_finding"),
    category: z.enum([
      "VIOLENT_THREATS",
      "HARASSMENT_OR_ABUSE",
      "ILLEGAL_ACTIVITY",
      "CONFIDENTIALITY_BREACH",
      "MISREPRESENTATION",
      "SAFETY_RISK",
    ]),
    description: z.string().min(1).max(2000),
    sourceUrl: z.string().url().max(500).nullable().optional(),
  }),
  z.object({ action: z.literal("remove_finding"), findingId: z.string() }),
  z.object({
    action: z.literal("complete"),
    reviewerNotes: z.string().max(5000).nullable().optional(),
  }),
  z.object({ action: z.literal("cancel") }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await getCurrentUser();
  if (!user) return apiError("Not signed in.", 401);
  const { checkId } = await ctx.params;
  const body = await parseBody(req, schema);

  const check = await prisma.socialMediaCheck.findUnique({
    where: { id: checkId },
    include: {
      findings: true,
      application: { select: { reference: true, requisitionId: true } },
    },
  });
  if (!check) return apiError("Review not found.", 404);
  if (check.reviewerId !== user.id) {
    return apiError(
      "Only the assigned reviewer can work on this. That separation is what keeps what they see out of the decision.",
      403,
    );
  }

  if (body.action === "cancel") {
    await prisma.socialMediaCheck.update({
      where: { id: checkId },
      data: { status: "CANCELLED" },
    });
    return apiOk({ ok: true });
  }

  if (check.status !== "AWAITING_REVIEW") {
    return apiError(
      check.status === "CONSENT_REQUESTED"
        ? "The candidate has not responded to the consent request yet."
        : "This review is not open.",
      409,
    );
  }

  switch (body.action) {
    case "add_finding": {
      const validation = validateFinding({
        category: body.category,
        description: body.description,
      });
      if (!validation.ok) return apiError(validation.errors.join(" "), 422);
      const finding = await prisma.socialMediaFinding.create({
        data: {
          checkId,
          category: body.category,
          description: body.description.trim(),
          sourceUrl: body.sourceUrl || null,
        },
      });
      return apiOk({ findingId: finding.id });
    }

    case "remove_finding": {
      await prisma.socialMediaFinding.deleteMany({
        where: { id: body.findingId, checkId },
      });
      return apiOk({ ok: true });
    }

    case "complete": {
      const outcome =
        check.findings.length > 0 ? "FINDINGS_TO_DISCUSS" : "NOTHING_FOUND";
      await prisma.$transaction(async (tx) => {
        await tx.socialMediaCheck.update({
          where: { id: checkId },
          data: {
            status: "COMPLETED",
            outcome,
            reviewerNotes: body.reviewerNotes ?? null,
            reviewedAt: new Date(),
          },
        });
        await logRequisitionEvent(tx, {
          requisitionId: check.application.requisitionId,
          type: "SOCIAL_CHECK_COMPLETED",
          summary: `Social media review completed for ${check.application.reference}: ${
            outcome === "NOTHING_FOUND"
              ? "nothing to raise"
              : `${check.findings.length} finding(s) to discuss`
          }.`,
          actorId: user.id,
        });
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.SOCIAL_CHECK_COMPLETED,
        entityType: "SocialMediaCheck",
        entityId: checkId,
        newValue: { outcome, findings: check.findings.length },
      });
      return apiOk({ outcome });
    }
  }
});
