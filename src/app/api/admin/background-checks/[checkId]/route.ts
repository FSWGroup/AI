/**
 * Background check actions, including the FCRA adverse-action sequence.
 *
 * The gates are the product here. A recruiter cannot send an adverse action
 * notice on the same day as the pre-adverse notice, cannot send one on a
 * clear report, and cannot send one twice — not because a policy says so but
 * because the endpoint refuses.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCompanyName } from "@/lib/org-settings";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAnyUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { sendEmail } from "@/lib/email/index";
import { renderTemplate } from "@/lib/ats/offers";
import { getReport, CheckrApiError, isCheckrConfigured } from "@/lib/checkr/client";
import {
  canSendPreAdverse,
  canSendAdverseAction,
  MIN_WAIT_BUSINESS_DAYS,
  PRE_ADVERSE_TEMPLATE,
  ADVERSE_ACTION_TEMPLATE,
} from "@/lib/checkr/adverse-action";
import { logRequisitionEvent } from "@/lib/ats/service";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("send_pre_adverse") }),
  z.object({ action: z.literal("record_dispute"), note: z.string().max(2000).nullable().optional() }),
  z.object({
    action: z.literal("send_adverse_action"),
    reason: z.string().max(2000).nullable().optional(),
  }),
  z.object({ action: z.literal("cancel_adverse_action") }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requireAnyUser();
  if (!can(user.role, "MANAGE_BACKGROUND_CHECKS")) {
    return apiError("You cannot manage background checks.", 403);
  }
  const { checkId } = await ctx.params;
  const body = await parseBody(req, schema);

  const check = await prisma.backgroundCheck.findUnique({
    where: { id: checkId },
    include: {
      application: {
        include: {
          candidate: true,
          requisition: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!check) return apiError("Background check not found.", 404);

  const companyName = await getCompanyName();
  const state = {
    stage: check.adverseStage,
    preAdverseSentAt: check.preAdverseSentAt,
    disputeReceivedAt: check.disputeReceivedAt,
    adverseActionSentAt: check.adverseActionSentAt,
  };

  switch (body.action) {
    case "refresh": {
      if (!isCheckrConfigured()) return apiError("Checkr is not configured.", 503);
      if (!check.checkrReportId) {
        return apiError("No report has been created yet.", 409);
      }
      try {
        const report = await getReport(check.checkrReportId);
        const result =
          report.assessment === "clear"
            ? "CLEAR"
            : report.assessment === "consider"
              ? "CONSIDER"
              : null;
        await prisma.$transaction(async (tx) => {
          await tx.backgroundCheck.update({
            where: { id: checkId },
            data: {
              status: report.status === "complete" ? "COMPLETE" : "PENDING",
              result: result ?? undefined,
              completedAt: report.completed_at ? new Date(report.completed_at) : null,
              reportSummary: report as unknown as never,
            },
          });
          await tx.backgroundCheckEvent.create({
            data: {
              checkId,
              type: "report.refreshed",
              summary: `Report status ${report.status}${result ? `, assessment ${result.toLowerCase()}` : ""}.`,
              actorId: user.id,
            },
          });
        });
        return apiOk({ status: report.status, result });
      } catch (err) {
        if (err instanceof CheckrApiError) return apiError(err.message, 502);
        throw err;
      }
    }

    case "send_pre_adverse": {
      const gate = canSendPreAdverse({
        state,
        reportResult: check.result,
        reportComplete: check.status === "COMPLETE",
      });
      if (!gate.allowed) return apiError(gate.reason!, 409);

      const context = {
        candidateFirstName: check.application.candidate.firstName,
        jobTitle: check.application.requisition.title,
        companyName,
        waitDays: String(MIN_WAIT_BUSINESS_DAYS),
      };
      await prisma.$transaction(async (tx) => {
        await tx.backgroundCheck.update({
          where: { id: checkId },
          data: { adverseStage: "PRE_ADVERSE_SENT", preAdverseSentAt: new Date() },
        });
        await tx.backgroundCheckEvent.create({
          data: {
            checkId,
            type: "pre_adverse.sent",
            summary: "Pre-adverse action notice sent to the candidate.",
            actorId: user.id,
          },
        });
        await logRequisitionEvent(tx, {
          requisitionId: check.application.requisitionId,
          type: "PRE_ADVERSE_SENT",
          summary: `Pre-adverse notice sent for ${check.application.reference}.`,
          actorId: user.id,
        });
      });

      await sendEmail({
        to: check.application.candidate.email,
        template: "rejection",
        subject: `About your background check — ${companyName}`,
        bodyText: renderTemplate(PRE_ADVERSE_TEMPLATE, context),
      });

      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.PRE_ADVERSE_SENT,
        entityType: "BackgroundCheck",
        entityId: checkId,
      });
      return apiOk({
        ok: true,
        note: "Attach a copy of the report and the CFPB summary of rights before this reaches the candidate.",
      });
    }

    case "record_dispute": {
      if (check.adverseStage !== "PRE_ADVERSE_SENT") {
        return apiError("There is no pending pre-adverse notice to dispute.", 409);
      }
      await prisma.$transaction(async (tx) => {
        await tx.backgroundCheck.update({
          where: { id: checkId },
          data: { adverseStage: "DISPUTED", disputeReceivedAt: new Date() },
        });
        await tx.backgroundCheckEvent.create({
          data: {
            checkId,
            type: "dispute.received",
            summary: body.note ?? "Candidate disputed the report.",
            actorId: user.id,
          },
        });
      });
      return apiOk({ ok: true });
    }

    case "send_adverse_action": {
      const gate = canSendAdverseAction({ state });
      if (!gate.allowed) {
        return apiError(
          gate.reason ?? "Not permitted yet.",
          409,
        );
      }
      const context = {
        candidateFirstName: check.application.candidate.firstName,
        jobTitle: check.application.requisition.title,
        companyName,
        preAdverseDate: check.preAdverseSentAt
          ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
              check.preAdverseSentAt,
            )
          : "",
        checkrPhone: "(844) 824-3257",
      };
      await prisma.$transaction(async (tx) => {
        await tx.backgroundCheck.update({
          where: { id: checkId },
          data: {
            adverseStage: "ADVERSE_ACTION_SENT",
            adverseActionSentAt: new Date(),
            adverseActionReason: body.reason ?? null,
          },
        });
        await tx.backgroundCheckEvent.create({
          data: {
            checkId,
            type: "adverse_action.sent",
            summary: "Adverse action notice sent to the candidate.",
            actorId: user.id,
          },
        });
        await logRequisitionEvent(tx, {
          requisitionId: check.application.requisitionId,
          type: "ADVERSE_ACTION_SENT",
          summary: `Adverse action taken on ${check.application.reference}.`,
          actorId: user.id,
        });
      });

      await sendEmail({
        to: check.application.candidate.email,
        template: "rejection",
        subject: `Your application with ${companyName}`,
        bodyText: renderTemplate(ADVERSE_ACTION_TEMPLATE, context),
      });

      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.ADVERSE_ACTION_SENT,
        entityType: "BackgroundCheck",
        entityId: checkId,
      });
      return apiOk({ ok: true });
    }

    case "cancel_adverse_action": {
      if (check.adverseStage === "ADVERSE_ACTION_SENT") {
        return apiError("Adverse action has already been taken.", 409);
      }
      await prisma.backgroundCheck.update({
        where: { id: checkId },
        data: { adverseStage: "CANCELLED" },
      });
      return apiOk({ ok: true });
    }
  }
});
