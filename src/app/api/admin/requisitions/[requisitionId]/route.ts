/**
 * Requisition actions: edit, approval decisions, status changes, hiring team,
 * and pipeline configuration.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { canDecide, chainStatus, type ApprovalStep } from "@/lib/ats/approvals";
import { validatePipeline } from "@/lib/ats/stages";
import { logRequisitionEvent } from "@/lib/ats/service";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    title: z.string().min(2).max(200).optional(),
    departmentId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    employmentType: z
      .enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERNSHIP"])
      .optional(),
    workArrangement: z.enum(["ONSITE", "HYBRID", "REMOTE"]).optional(),
    openings: z.number().int().min(1).max(100).optional(),
    salaryMin: z.number().int().min(0).nullable().optional(),
    salaryMax: z.number().int().min(0).nullable().optional(),
    salaryPublish: z.boolean().optional(),
    summary: z.string().max(600).nullable().optional(),
    description: z.string().max(20000).nullable().optional(),
    responsibilities: z.string().max(20000).nullable().optional(),
    requirements: z.string().max(20000).nullable().optional(),
    benefits: z.string().max(5000).nullable().optional(),
    internalNotes: z.string().max(20000).nullable().optional(),
    jobProfileId: z.string().nullable().optional(),
  }),
  z.object({ action: z.literal("submit_for_approval") }),
  z.object({
    action: z.literal("decide"),
    decision: z.enum(["APPROVED", "REJECTED"]),
    comment: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    action: z.literal("set_status"),
    status: z.enum(["OPEN", "ON_HOLD", "CLOSED", "FILLED", "DRAFT"]),
  }),
  z.object({
    action: z.literal("set_approvers"),
    approverIds: z.array(z.string()).max(5),
  }),
  z.object({
    action: z.literal("set_team"),
    members: z
      .array(
        z.object({
          userId: z.string(),
          role: z.enum([
            "RECRUITER",
            "HIRING_MANAGER",
            "INTERVIEWER",
            "COORDINATOR",
            "APPROVER",
          ]),
        }),
      )
      .max(30),
  }),
  z.object({
    action: z.literal("set_stages"),
    stages: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().min(1).max(60),
          kind: z.enum([
            "APPLIED",
            "SCREEN",
            "ASSESSMENT",
            "INTERVIEW",
            "REFERENCE",
            "OFFER",
            "HIRED",
          ]),
          interviewKitId: z.string().nullable().optional(),
        }),
      )
      .min(2)
      .max(15),
  }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await getCurrentUser();
  if (!user) return apiError("Not signed in.", 401);
  const { requisitionId } = await ctx.params;
  const body = await parseBody(req, schema);

  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: {
      approvals: { include: { approver: { select: { name: true } } } },
    },
  });
  if (!requisition) return apiError("Requisition not found.", 404);

  switch (body.action) {
    case "update": {
      if (!can(user.role, "MANAGE_REQUISITIONS")) {
        return apiError("You cannot edit requisitions.", 403);
      }
      const { action: _a, ...data } = body;
      const min = data.salaryMin ?? requisition.salaryMin;
      const max = data.salaryMax ?? requisition.salaryMax;
      if (min != null && max != null && min > max) {
        return apiError("The minimum salary is above the maximum.", 422);
      }
      await prisma.requisition.update({
        where: { id: requisitionId },
        data: Object.fromEntries(
          Object.entries(data).filter(([, v]) => v !== undefined),
        ),
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.REQUISITION_UPDATED,
        entityType: "Requisition",
        entityId: requisitionId,
      });
      return apiOk({ ok: true });
    }

    case "set_approvers": {
      if (!can(user.role, "MANAGE_REQUISITIONS")) {
        return apiError("You cannot edit requisitions.", 403);
      }
      if (requisition.status !== "DRAFT") {
        return apiError(
          "Approvers can only be changed while the requisition is a draft.",
          409,
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.requisitionApproval.deleteMany({ where: { requisitionId } });
        if (body.approverIds.length > 0) {
          await tx.requisitionApproval.createMany({
            data: body.approverIds.map((approverId, stepIndex) => ({
              requisitionId,
              approverId,
              stepIndex,
            })),
          });
        }
      });
      return apiOk({ ok: true });
    }

    case "submit_for_approval": {
      if (!can(user.role, "MANAGE_REQUISITIONS")) {
        return apiError("You cannot edit requisitions.", 403);
      }
      if (requisition.status !== "DRAFT") {
        return apiError("Only a draft can be submitted for approval.", 409);
      }
      if (requisition.approvals.length === 0) {
        return apiError("Add at least one approver first.", 422);
      }
      await prisma.$transaction(async (tx) => {
        await tx.requisition.update({
          where: { id: requisitionId },
          data: { status: "PENDING_APPROVAL" },
        });
        await tx.requisitionApproval.updateMany({
          where: { requisitionId },
          data: { decision: "PENDING", decidedAt: null, comment: null },
        });
        await logRequisitionEvent(tx, {
          requisitionId,
          type: "SUBMITTED",
          summary: `Submitted for approval by ${user.name}.`,
          actorId: user.id,
        });
      });
      return apiOk({ ok: true });
    }

    case "decide": {
      if (requisition.status !== "PENDING_APPROVAL") {
        return apiError("This requisition is not awaiting approval.", 409);
      }
      const steps: ApprovalStep[] = requisition.approvals.map((a) => ({
        stepIndex: a.stepIndex,
        approverId: a.approverId,
        approverName: a.approver.name,
        decision: a.decision,
        comment: a.comment,
        decidedAt: a.decidedAt,
      }));
      const check = canDecide(steps, user.id);
      if (!check.allowed) return apiError(check.reason ?? "You cannot decide.", 403);

      const current = chainStatus(steps).currentStep!;
      await prisma.$transaction(async (tx) => {
        await tx.requisitionApproval.update({
          where: {
            requisitionId_stepIndex: { requisitionId, stepIndex: current.stepIndex },
          },
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
          await tx.requisition.update({
            where: { id: requisitionId },
            data: { status: "REJECTED" },
          });
        } else if (status.state === "APPROVED") {
          await tx.requisition.update({
            where: { id: requisitionId },
            data: { status: "APPROVED" },
          });
        }
        await logRequisitionEvent(tx, {
          requisitionId,
          type: "APPROVAL",
          summary: `${user.name} ${body.decision === "APPROVED" ? "approved" : "rejected"} the requisition.`,
          actorId: user.id,
        });
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.REQUISITION_APPROVAL,
        entityType: "Requisition",
        entityId: requisitionId,
        newValue: { decision: body.decision, step: current.stepIndex },
      });
      return apiOk({ ok: true });
    }

    case "set_status": {
      if (!can(user.role, "MANAGE_REQUISITIONS")) {
        return apiError("You cannot change requisition status.", 403);
      }
      if (body.status === "OPEN" && requisition.status === "DRAFT") {
        return apiError(
          "A draft has to be approved before it can be opened.",
          409,
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.requisition.update({
          where: { id: requisitionId },
          data: {
            status: body.status,
            openedAt:
              body.status === "OPEN" && !requisition.openedAt
                ? new Date()
                : requisition.openedAt,
            closedAt:
              body.status === "CLOSED" || body.status === "FILLED"
                ? new Date()
                : null,
          },
        });
        await logRequisitionEvent(tx, {
          requisitionId,
          type: "STATUS",
          summary: `Status changed to ${body.status.toLowerCase().replace(/_/g, " ")} by ${user.name}.`,
          actorId: user.id,
        });
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.REQUISITION_STATUS,
        entityType: "Requisition",
        entityId: requisitionId,
        previousValue: { status: requisition.status },
        newValue: { status: body.status },
      });
      return apiOk({ ok: true });
    }

    case "set_team": {
      if (!can(user.role, "MANAGE_REQUISITIONS")) {
        return apiError("You cannot edit the hiring team.", 403);
      }
      await prisma.$transaction(async (tx) => {
        await tx.hiringTeamMember.deleteMany({ where: { requisitionId } });
        if (body.members.length > 0) {
          await tx.hiringTeamMember.createMany({
            data: body.members.map((m) => ({ ...m, requisitionId })),
            skipDuplicates: true,
          });
        }
      });
      return apiOk({ ok: true });
    }

    case "set_stages": {
      if (!can(user.role, "MANAGE_REQUISITIONS")) {
        return apiError("You cannot edit the pipeline.", 403);
      }
      const errors = validatePipeline(body.stages);
      if (errors.length > 0) {
        return apiError(errors.map((e) => e.message).join(" "), 422);
      }
      const existing = await prisma.pipelineStage.findMany({
        where: { requisitionId },
        include: { _count: { select: { applications: true } } },
      });
      const keptIds = new Set(body.stages.map((s) => s.id).filter(Boolean));
      const removedWithApplications = existing.filter(
        (s) => !keptIds.has(s.id) && s._count.applications > 0,
      );
      if (removedWithApplications.length > 0) {
        return apiError(
          `Move the candidates out of ${removedWithApplications
            .map((s) => s.name)
            .join(", ")} before removing ${removedWithApplications.length === 1 ? "that stage" : "those stages"}.`,
          409,
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.pipelineStage.deleteMany({
          where: { requisitionId, id: { notIn: [...keptIds] as string[] } },
        });
        // Two passes: park everything at negative indexes first, because the
        // (requisitionId, orderIndex) unique constraint would otherwise
        // collide mid-reorder.
        for (const [i, stage] of body.stages.entries()) {
          if (!stage.id) continue;
          await tx.pipelineStage.update({
            where: { id: stage.id },
            data: { orderIndex: -(i + 1) },
          });
        }
        for (const [i, stage] of body.stages.entries()) {
          if (stage.id) {
            await tx.pipelineStage.update({
              where: { id: stage.id },
              data: {
                name: stage.name,
                kind: stage.kind,
                orderIndex: i,
                interviewKitId: stage.interviewKitId ?? null,
              },
            });
          } else {
            await tx.pipelineStage.create({
              data: {
                requisitionId,
                name: stage.name,
                kind: stage.kind,
                orderIndex: i,
                interviewKitId: stage.interviewKitId ?? null,
              },
            });
          }
        }
      });
      return apiOk({ ok: true });
    }
  }
});
