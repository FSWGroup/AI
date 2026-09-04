/** The offer letter as a PDF, including the acceptance block once signed. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCompanyName } from "@/lib/org-settings";
import { apiError, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { renderOfferLetterPdf, mergeContextForOffer } from "@/lib/ats/offer-letter";
import { renderTemplate } from "@/lib/ats/offers";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("MANAGE_OFFERS");
  const { offerId } = await ctx.params;

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      template: true,
      application: {
        include: {
          candidate: true,
          requisition: {
            include: { team: { include: { user: { select: { name: true } } } } },
          },
        },
      },
    },
  });
  if (!offer) return apiError("Offer not found.", 404);

  const companyName = await getCompanyName();

  // A sent offer uses its frozen letter; a draft renders a live preview so
  // the recruiter can see what will go out before committing to it.
  let letterBody = offer.letterBody;
  if (!letterBody) {
    if (!offer.template) {
      return apiError("Choose an offer letter template first.", 409);
    }
    letterBody = renderTemplate(
      offer.template.body,
      mergeContextForOffer(offer, companyName),
    );
  }

  const candidateName = `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`;
  const pdf = await renderOfferLetterPdf({
    letterBody,
    companyName,
    candidateName,
    offerReference: offer.reference,
    acceptance:
      offer.status === "ACCEPTED" && offer.signatureName && offer.respondedAt
        ? {
            signatureName: offer.signatureName,
            respondedAt: offer.respondedAt,
            ip: offer.signatureIp,
          }
        : null,
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.REPORT_EXPORTED,
    entityType: "Offer",
    entityId: offerId,
    newValue: { format: "pdf", kind: "offer_letter" },
  });

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Offer-${offer.reference}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});
