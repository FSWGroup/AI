/**
 * Candidate offer response.
 *
 * Authenticated by the single-use token in the emailed link — the candidate
 * has no account. Accepting records a typed signature with the time, IP and
 * user agent, which is what makes an electronic acceptance evidentiary rather
 * than just a database flag.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { hashToken } from "@/lib/crypto";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { canTransition } from "@/lib/ats/offers";
import { logRequisitionEvent } from "@/lib/ats/service";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    signatureName: z.string().min(2).max(200),
  }),
  z.object({
    action: z.literal("decline"),
    reason: z.string().max(2000).nullable().optional(),
  }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const { token } = await ctx.params;
  const ip =
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;

  if (!rateLimit(`offer:${ip ?? "unknown"}`, 20, 10 * 60_000)) {
    return apiError("Too many attempts. Please try again shortly.", 429);
  }

  const offer = await prisma.offer.findUnique({
    where: { acceptTokenHash: hashToken(token) },
    include: { application: { include: { candidate: true } } },
  });
  if (!offer) return apiError("This offer link is not valid.", 404);

  if (offer.status !== "SENT") {
    return apiError(
      offer.status === "ACCEPTED"
        ? "You have already accepted this offer."
        : "This offer is no longer open. Please contact your recruiter.",
      409,
    );
  }
  if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "EXPIRED" } });
    return apiError(
      "This offer has passed its response date. Please contact your recruiter.",
      410,
    );
  }

  const body = await parseBody(req, schema);
  const target = body.action === "accept" ? "ACCEPTED" : "DECLINED";
  if (!canTransition(offer.status, target)) {
    return apiError("This offer cannot be changed.", 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.offer.update({
      where: { id: offer.id },
      data: {
        status: target,
        respondedAt: new Date(),
        // The token is spent either way: one decision per link.
        acceptTokenHash: null,
        ...(body.action === "accept"
          ? {
              signatureName: body.signatureName.trim(),
              signatureIp: ip,
              signatureUserAgent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
            }
          : { declineReason: body.reason ?? null }),
      },
    });
    await tx.application.update({
      where: { id: offer.applicationId },
      data: { lastActivityAt: new Date() },
    });
    await logRequisitionEvent(tx, {
      requisitionId: offer.requisitionId,
      type: body.action === "accept" ? "OFFER_ACCEPTED" : "OFFER_DECLINED",
      // No actorId: the candidate is not a system user. The summary names
      // them, and the audit row records the decision separately.
      summary: `${offer.application.candidate.firstName} ${offer.application.candidate.lastName} ${body.action === "accept" ? "accepted" : "declined"} offer ${offer.reference}.`,
      meta: { offerId: offer.id, decision: target },
    });
  });

  await audit({
    actorLabel: "candidate",
    action: AUDIT_ACTIONS.OFFER_RESPONDED,
    entityType: "Offer",
    entityId: offer.id,
    newValue: { decision: target },
  });

  return apiOk({ status: target });
});
