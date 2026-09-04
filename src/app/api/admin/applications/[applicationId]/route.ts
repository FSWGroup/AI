/** Application actions: stage moves, rejection, reopening, notes, withdrawal. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { assertApplicationAccess } from "@/lib/auth/scope";
import { can } from "@/lib/auth/rbac";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  moveApplicationStage,
  rejectApplication,
  reopenApplication,
} from "@/lib/ats/service";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move_stage"),
    stageId: z.string(),
    note: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    action: z.literal("reject"),
    reasonId: z.string().nullable(),
    note: z.string().max(2000).nullable().optional(),
  }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("withdraw"), note: z.string().max(1000).nullable().optional() }),
  z.object({ action: z.literal("add_note"), body: z.string().min(1).max(5000) }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await getCurrentUser();
  if (!user) return apiError("Not signed in.", 401);
  if (!can(user.role, "MANAGE_PIPELINE")) {
    return apiError("You cannot change applications.", 403);
  }
  const { applicationId } = await ctx.params;
  // MANAGE_PIPELINE and its siblings are held globally by HIRING_MANAGER, so
  // the permission answers "may you do this?" and nothing answered "to whose
  // candidate?". The scope check is what answers that.
  await assertApplicationAccess(user, applicationId);
  const body = await parseBody(req, schema);

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, reference: true, requisitionId: true, status: true },
  });
  if (!application) return apiError("Application not found.", 404);

  switch (body.action) {
    case "move_stage": {
      const result = await moveApplicationStage({
        applicationId,
        toStageId: body.stageId,
        actorId: user.id,
        note: body.note ?? null,
      });
      if (!result.ok) return apiError(result.error ?? "That move is not allowed.", 409);
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.APPLICATION_STAGE_MOVED,
        entityType: "Application",
        entityId: applicationId,
        newValue: { stageId: body.stageId, effects: result.effects },
      });
      return apiOk({ ok: true, effects: result.effects });
    }

    case "reject": {
      if (application.status === "REJECTED") {
        return apiError("This application is already rejected.", 409);
      }
      await rejectApplication({
        applicationId,
        reasonId: body.reasonId,
        note: body.note ?? null,
        actorId: user.id,
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.APPLICATION_REJECTED,
        entityType: "Application",
        entityId: applicationId,
        newValue: { reasonId: body.reasonId },
      });
      return apiOk({ ok: true });
    }

    case "withdraw": {
      await prisma.application.update({
        where: { id: applicationId },
        data: {
          status: "WITHDRAWN",
          withdrawnAt: new Date(),
          rejectionNote: body.note ?? null,
          lastActivityAt: new Date(),
        },
      });
      return apiOk({ ok: true });
    }

    case "reopen": {
      if (application.status === "ACTIVE") {
        return apiError("This application is already active.", 409);
      }
      await reopenApplication({ applicationId, actorId: user.id });
      return apiOk({ ok: true });
    }

    case "add_note": {
      const note = await prisma.applicationNote.create({
        data: { applicationId, authorId: user.id, body: body.body },
      });
      await prisma.application.update({
        where: { id: applicationId },
        data: { lastActivityAt: new Date() },
      });
      return apiOk({ noteId: note.id });
    }
  }
});
