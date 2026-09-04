/**
 * Offer actions: approval decisions, sending, rescinding, and re-rendering
 * the letter preview.
 *
 * Sending is the irreversible step, so it is gated hard: the state machine,
 * the approval chain, an unfilled-placeholder check, and a deadline check all
 * have to pass. A letter that goes out with {{baseSalary}} in it, or with no
 * approval behind it, is a problem no amount of apology fixes.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCompanyName } from "@/lib/org-settings";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAnyUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/index";
import { canDecide, chainStatus, type ApprovalStep } from "@/lib/ats/approvals";
import {
  canTransition,
  checkReadyToSend,
  renderTemplate,
  transitionError,
  unresolvedFields,
} from "@/lib/ats/offers";
import { mergeContextForOffer } from "@/lib/ats/offer-letter";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit_for_approval") }),
  z.object({
    action: z.literal("decide"),
    decision: z.enum(["APPROVED", "REJECTED"]),
    comment: z.string().max(1000).nullable().optional(),
  }),
  z.object({ action: z.literal("approve_without_chain") }),
  z.object({ action: z.literal("send") }),
  z.object({
    action: z.literal("rescind"),
    reason: z.string().max(1000).nullable().optional(),
  }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requireAnyUser();
  const { offerId } = await ctx.params;
  const body = await parseBody(req, schema);

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      approvals: {
        orderBy: { stepIndex: "asc" },
        include: { approver: { select: { name: true } } },
      },
      template: true,
      application: {
        include: {
          candidate: true,
          requisition: {
            include: {
              team: { include: { user: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!offer) return apiError("Offer not found.", 404);

  const companyName = await getCompanyName();

  const steps: ApprovalStep[] = offer.approvals.map((a) => ({
    stepIndex: a.stepIndex,
    approverId: a.approverId,
    approverName: a.approver.name,
    decision: a.decision,
    comment: a.comment,
    decidedAt: a.decidedAt,
  }));

  switch (body.action) {
    case "submit_for_approval": {
      if (!can(user.role, "MANAGE_OFFERS")) return apiError("Not permitted.", 403);
      if (!canTransition(offer.status, "PENDING_APPROVAL")) {
        return apiError(transitionError(offer.status, "PENDING_APPROVAL"), 409);
      }
      if (steps.length === 0) {
        return apiError("Add at least one approver, or approve it directly.", 422);
      }
      await prisma.offer.update({
        where: { id: offerId },
        data: { status: "PENDING_APPROVAL" },
      });
      return apiOk({ ok: true });
    }

    case "approve_without_chain": {
      if (!can(user.role, "MANAGE_OFFERS")) return apiError("Not permitted.", 403);
      if (steps.length > 0) {
        return apiError(
          "This offer has an approval chain. It has to go through it.",
          409,
        );
      }
      if (!canTransition(offer.status, "APPROVED")) {
        return apiError(transitionError(offer.status, "APPROVED"), 409);
      }
      await prisma.offer.update({ where: { id: offerId }, data: { status: "APPROVED" } });
      return apiOk({ ok: true });
    }

    case "decide": {
      if (offer.status !== "PENDING_APPROVAL") {
        return apiError("This offer is not awaiting approval.", 409);
      }
      const check = canDecide(steps, user.id);
      if (!check.allowed) return apiError(check.reason ?? "You cannot decide.", 403);
      const current = chainStatus(steps).currentStep!;

      await prisma.$transaction(async (tx) => {
        await tx.offerApproval.update({
          where: { offerId_stepIndex: { offerId, stepIndex: current.stepIndex } },
          data: {
            decision: body.decision,
            comment: body.comment ?? null,
            decidedAt: new Date(),
          },
        });
        const updated = steps.map((s) =>
          s.stepIndex === current.stepIndex ? { ...s, decision: body.decision } : s,
        );
        const status = chainStatus(updated);
        if (status.state === "REJECTED") {
          await tx.offer.update({ where: { id: offerId }, data: { status: "DRAFT" } });
        } else if (status.state === "APPROVED") {
          await tx.offer.update({ where: { id: offerId }, data: { status: "APPROVED" } });
        }
      });

      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.OFFER_APPROVAL,
        entityType: "Offer",
        entityId: offerId,
        newValue: { decision: body.decision, step: current.stepIndex },
      });
      return apiOk({ ok: true });
    }

    case "send": {
      if (!can(user.role, "MANAGE_OFFERS")) return apiError("Not permitted.", 403);
      if (!offer.template) {
        return apiError("Choose an offer letter template first.", 422);
      }

      const context = mergeContextForOffer(offer, companyName);
      const unresolved = unresolvedFields(offer.template.body, context);
      const readiness = checkReadyToSend({
        status: offer.status,
        approvalsComplete:
          steps.length === 0 || chainStatus(steps).state === "APPROVED",
        hasTemplate: true,
        unresolved,
        candidateEmail: offer.application.candidate.email,
        expiresAt: offer.expiresAt,
      });
      if (!readiness.ready) {
        return apiError(readiness.blockers.join(" "), 409);
      }

      const token = generateToken();
      const letterBody = renderTemplate(offer.template.body, context);
      const offerUrl = `${env.appBaseUrl}/offer/${token}`;

      await prisma.$transaction(async (tx) => {
        await tx.offer.update({
          where: { id: offerId },
          data: {
            status: "SENT",
            letterBody,
            acceptTokenHash: hashToken(token),
            sentAt: new Date(),
          },
        });
        await logRequisitionEvent(tx, {
          requisitionId: offer.requisitionId,
          type: "OFFER_SENT",
          summary: `Offer ${offer.reference} sent to ${offer.application.candidate.firstName} ${offer.application.candidate.lastName}.`,
          actorId: user.id,
        });
      });

      const template = await prisma.recruitingEmailTemplate.findUnique({
        where: { key: "offer_sent" },
      });
      const emailContext = {
        ...context,
        offerUrl,
      } as unknown as Record<string, string>;
      await sendEmail({
        to: offer.application.candidate.email,
        template: "offer_sent",
        subject: renderTemplate(
          template?.subject ?? "Your offer from {{companyName}}",
          emailContext,
        ),
        bodyText: renderTemplate(
          template?.body ?? `Your offer is ready: {{offerUrl}}`,
          emailContext,
        ),
      });

      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.OFFER_SENT,
        entityType: "Offer",
        entityId: offerId,
      });

      // The link is returned so a recruiter can pass it on directly when no
      // email provider is wired.
      return apiOk({ ok: true, offerUrl });
    }

    case "rescind": {
      if (!can(user.role, "MANAGE_OFFERS")) return apiError("Not permitted.", 403);
      if (!canTransition(offer.status, "RESCINDED")) {
        return apiError(transitionError(offer.status, "RESCINDED"), 409);
      }
      await prisma.$transaction(async (tx) => {
        await tx.offer.update({
          where: { id: offerId },
          data: {
            status: "RESCINDED",
            declineReason: body.reason ?? null,
            acceptTokenHash: null,
          },
        });
        await logRequisitionEvent(tx, {
          requisitionId: offer.requisitionId,
          type: "OFFER_RESCINDED",
          summary: `Offer ${offer.reference} was rescinded.`,
          actorId: user.id,
        });
      });
      return apiOk({ ok: true });
    }
  }
});
