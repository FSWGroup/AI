/**
 * Order a Checkr background check.
 *
 * Gated to a candidate who has accepted an offer. Running criminal-history
 * checks earlier is restricted or banned outright in many jurisdictions
 * (ban-the-box), and there is no business reason to order a paid report on
 * someone who has not yet said yes.
 *
 * We create the Checkr candidate and send an invitation. Checkr collects the
 * SSN, date of birth, and the FCRA disclosure and authorization directly —
 * this platform never holds any of them.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAnyUser } from "@/lib/auth/session";
import { assertApplicationAccess } from "@/lib/auth/scope";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  createCandidate,
  createInvitation,
  isCheckrConfigured,
  CheckrApiError,
} from "@/lib/checkr/client";
import { logRequisitionEvent } from "@/lib/ats/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  packageSlug: z.string().min(1).max(120),
  workLocationCountry: z.string().length(2).default("US"),
  workLocationState: z.string().max(10).nullable().optional(),
  workLocationCity: z.string().max(120).nullable().optional(),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requireAnyUser();
  if (!can(user.role, "MANAGE_BACKGROUND_CHECKS")) {
    return apiError("You cannot order background checks.", 403);
  }
  if (!isCheckrConfigured()) {
    return apiError(
      "Background checks are not configured. Set CHECKR_API_KEY to enable them.",
      503,
    );
  }

  const { applicationId } = await ctx.params;
  // MANAGE_PIPELINE and its siblings are held globally by HIRING_MANAGER, so
  // the permission answers "may you do this?" and nothing answered "to whose
  // candidate?". The scope check is what answers that.
  await assertApplicationAccess(user, applicationId);
  const body = await parseBody(req, schema);

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      candidate: true,
      backgroundCheck: true,
      offers: { where: { status: "ACCEPTED" }, select: { id: true } },
    },
  });
  if (!application) return apiError("Application not found.", 404);
  if (application.backgroundCheck) {
    return apiError("A background check already exists for this candidate.", 409);
  }
  if (application.offers.length === 0) {
    return apiError(
      "Order a background check once the candidate has accepted an offer. Running one earlier is restricted in many jurisdictions and there is no reason to pay for a report on someone who has not said yes.",
      409,
    );
  }

  const country = body.workLocationCountry ?? "US";
  const workLocation = {
    country,
    state: body.workLocationState ?? null,
    city: body.workLocationCity ?? null,
  };

  try {
    const checkrCandidate = await createCandidate({
      email: application.candidate.email,
      firstName: application.candidate.firstName,
      lastName: application.candidate.lastName,
      workLocation,
    });
    const invitation = await createInvitation({
      candidateId: checkrCandidate.id,
      packageSlug: body.packageSlug,
      workLocation,
    });

    const check = await prisma.$transaction(async (tx) => {
      const created = await tx.backgroundCheck.create({
        data: {
          applicationId,
          offerId: application.offers[0].id,
          status: "INVITATION_SENT",
          packageSlug: body.packageSlug,
          workLocationCountry: country,
          workLocationState: body.workLocationState ?? null,
          workLocationCity: body.workLocationCity ?? null,
          checkrCandidateId: checkrCandidate.id,
          checkrInvitationId: invitation.id,
          invitationUrl: invitation.invitation_url,
          invitedAt: new Date(),
          requestedById: user.id,
        },
      });
      await tx.backgroundCheckEvent.create({
        data: {
          checkId: created.id,
          type: "invitation.sent",
          summary: `Invitation sent to ${application.candidate.email} for package ${body.packageSlug}.`,
          actorId: user.id,
        },
      });
      await logRequisitionEvent(tx, {
        requisitionId: application.requisitionId,
        type: "BACKGROUND_CHECK_ORDERED",
        summary: `Background check ordered for ${application.reference}.`,
        actorId: user.id,
      });
      return created;
    });

    await audit({
      userId: user.id,
      action: AUDIT_ACTIONS.BACKGROUND_CHECK_ORDERED,
      entityType: "BackgroundCheck",
      entityId: check.id,
      newValue: { packageSlug: body.packageSlug, applicationId },
    });

    return apiOk({
      checkId: check.id,
      invitationUrl: invitation.invitation_url,
    });
  } catch (err) {
    if (err instanceof CheckrApiError) {
      return apiError(err.message, err.status >= 500 ? 502 : 422);
    }
    throw err;
  }
});
