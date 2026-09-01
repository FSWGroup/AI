/** Create an offer against an application. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { offerReference, logRequisitionEvent } from "@/lib/ats/service";

const schema = z.object({
  applicationId: z.string(),
  jobTitle: z.string().min(2).max(200),
  baseSalary: z.number().int().min(0),
  salaryCurrency: z.string().length(3).default("PHP"),
  salaryPeriod: z.enum(["HOUR", "DAY", "MONTH", "YEAR"]).default("MONTH"),
  signingBonus: z.number().int().min(0).nullable().optional(),
  variablePay: z.string().max(2000).nullable().optional(),
  benefitsSummary: z.string().max(4000).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  templateId: z.string().nullable().optional(),
  approverIds: z.array(z.string()).max(5).default([]),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_OFFERS");
  const body = await parseBody(req, schema);
  const approverIds = body.approverIds ?? [];

  const application = await prisma.application.findUnique({
    where: { id: body.applicationId },
    include: {
      candidate: true,
      requisition: {
        include: { department: true, location: true },
      },
      offers: { where: { status: { in: ["SENT", "ACCEPTED"] } } },
    },
  });
  if (!application) return apiError("Application not found.", 404);
  if (application.status !== "ACTIVE") {
    return apiError("Only an active application can receive an offer.", 409);
  }
  if (application.offers.length > 0) {
    return apiError(
      "This candidate already has an offer out or accepted. Rescind it before creating another.",
      409,
    );
  }

  const offer = await prisma.$transaction(async (tx) => {
    const created = await tx.offer.create({
      data: {
        reference: offerReference(),
        applicationId: application.id,
        requisitionId: application.requisitionId,
        jobTitle: body.jobTitle.trim(),
        departmentName: application.requisition.department?.name ?? null,
        locationName: application.requisition.location?.name ?? null,
        employmentType: application.requisition.employmentType,
        workArrangement: application.requisition.workArrangement,
        baseSalary: body.baseSalary,
        salaryCurrency: body.salaryCurrency,
        salaryPeriod: body.salaryPeriod,
        signingBonus: body.signingBonus ?? null,
        variablePay: body.variablePay || null,
        benefitsSummary:
          body.benefitsSummary || application.requisition.benefits || null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        templateId: body.templateId || null,
        createdById: user.id,
      },
    });
    if (approverIds.length > 0) {
      await tx.offerApproval.createMany({
        data: approverIds.map((approverId, stepIndex) => ({
          offerId: created.id,
          approverId,
          stepIndex,
        })),
      });
    }
    await logRequisitionEvent(tx, {
      requisitionId: application.requisitionId,
      type: "OFFER_CREATED",
      summary: `Offer ${created.reference} drafted for ${application.candidate.firstName} ${application.candidate.lastName}.`,
      actorId: user.id,
      meta: { offerId: created.id, applicationId: application.id },
    });
    return created;
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.OFFER_CREATED,
    entityType: "Offer",
    entityId: offer.id,
    newValue: { reference: offer.reference, applicationId: application.id },
  });

  return apiOk({ offerId: offer.id, reference: offer.reference });
});
