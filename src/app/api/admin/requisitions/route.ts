/** Create and list requisitions. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { requisitionReference, seedPipeline, logRequisitionEvent } from "@/lib/ats/service";

const createSchema = z.object({
  title: z.string().min(2).max(200),
  departmentId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  employmentType: z
    .enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERNSHIP"])
    .default("FULL_TIME"),
  workArrangement: z.enum(["ONSITE", "HYBRID", "REMOTE"]).default("ONSITE"),
  openings: z.number().int().min(1).max(100).default(1),
  salaryMin: z.number().int().min(0).nullable().optional(),
  salaryMax: z.number().int().min(0).nullable().optional(),
  salaryCurrency: z.string().length(3).default("PHP"),
  salaryPeriod: z.enum(["HOUR", "DAY", "MONTH", "YEAR"]).default("MONTH"),
  salaryPublish: z.boolean().default(false),
  summary: z.string().max(600).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  responsibilities: z.string().max(20000).nullable().optional(),
  requirements: z.string().max(20000).nullable().optional(),
  benefits: z.string().max(5000).nullable().optional(),
  jobProfileId: z.string().nullable().optional(),
  approverIds: z.array(z.string()).max(5).default([]),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_REQUISITIONS");
  const body = await parseBody(req, createSchema);
  const approverIds = body.approverIds ?? [];

  if (
    body.salaryMin != null &&
    body.salaryMax != null &&
    body.salaryMin > body.salaryMax
  ) {
    return apiError("The minimum salary is above the maximum.", 422);
  }

  const requisition = await prisma.$transaction(async (tx) => {
    const created = await tx.requisition.create({
      data: {
        reference: requisitionReference(),
        title: body.title.trim(),
        departmentId: body.departmentId || null,
        locationId: body.locationId || null,
        employmentType: body.employmentType,
        workArrangement: body.workArrangement,
        openings: body.openings,
        salaryMin: body.salaryMin ?? null,
        salaryMax: body.salaryMax ?? null,
        salaryCurrency: body.salaryCurrency,
        salaryPeriod: body.salaryPeriod,
        salaryPublish: body.salaryPublish,
        summary: body.summary || null,
        description: body.description || null,
        responsibilities: body.responsibilities || null,
        requirements: body.requirements || null,
        benefits: body.benefits || null,
        jobProfileId: body.jobProfileId || null,
        createdById: user.id,
        status: "DRAFT",
      },
    });
    await seedPipeline(tx, created.id);
    // The creator is the recruiter on their own requisition by default.
    await tx.hiringTeamMember.create({
      data: { requisitionId: created.id, userId: user.id, role: "RECRUITER" },
    });
    if (approverIds.length > 0) {
      await tx.requisitionApproval.createMany({
        data: approverIds.map((approverId, stepIndex) => ({
          requisitionId: created.id,
          approverId,
          stepIndex,
        })),
      });
    }
    await logRequisitionEvent(tx, {
      requisitionId: created.id,
      type: "CREATED",
      summary: `Requisition created by ${user.name}.`,
      actorId: user.id,
    });
    return created;
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.REQUISITION_CREATED,
    entityType: "Requisition",
    entityId: requisition.id,
    newValue: { reference: requisition.reference, title: requisition.title },
  });

  return apiOk({ requisitionId: requisition.id, reference: requisition.reference });
});
