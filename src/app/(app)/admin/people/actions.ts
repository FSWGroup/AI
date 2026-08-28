"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import {
  bulkUpdate,
  createPerson,
  deactivatePerson,
  exportPersonData,
  reactivatePerson,
  setUserRoles,
  type CreatePersonInput,
  type DeactivateResult,
} from "@/lib/services/people";
import { assignTraining, type AssignTrainingResult } from "@/lib/services/assignment";
import { notify } from "@/lib/notifications";
import type { TrainingTargetType } from "@prisma/client";

export async function createPersonAction(input: CreatePersonInput): Promise<ActionResult<{ id: string }>> {
  return runAction("people.create", async () => {
    if (!input.email || !input.name) return fail("Name and email are required.");
    const actor = await assertPermission("people.edit");
    const person = await createPerson(actor, input);
    revalidatePath("/admin/people");
    return ok(person);
  });
}

export async function reactivatePersonAction(userId: string): Promise<ActionResult> {
  return runAction("people.reactivate", async () => {
    const actor = await assertPermission("people.deactivate");
    await reactivatePerson(actor, userId);
    revalidatePath("/admin/people");
    revalidatePath(`/people/${userId}`);
    return ok();
  });
}

export async function setUserRolesAction(userId: string, roleKeys: string[]): Promise<ActionResult> {
  return runAction("people.set_roles", async () => {
    const actor = await assertPermission("people.edit");
    await setUserRoles(actor, userId, roleKeys);
    revalidatePath(`/admin/people/${userId}/edit`);
    return ok();
  });
}

export async function bulkAssignTrainingAction(input: {
  userIds: string[];
  targetType: TrainingTargetType;
  courseId?: string | null;
  sopId?: string | null;
  pathId?: string | null;
  dueAt?: string | null;
  reason?: string | null;
}): Promise<ActionResult<AssignTrainingResult>> {
  return runAction("people.bulk_assign", async () => {
    if (input.userIds.length === 0) return fail("Select at least one person first.");
    if (!input.courseId && !input.sopId && !input.pathId) return fail("Choose a course, SOP, or learning path.");
    const actor = await assertPermission("training.assign");
    const result = await assignTraining(actor, {
      userIds: input.userIds,
      targetType: input.targetType,
      courseId: input.courseId ?? null,
      sopId: input.sopId ?? null,
      pathId: input.pathId ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      reason: input.reason || null,
    });
    revalidatePath("/admin/people");
    return ok(result);
  });
}

export async function bulkRemindAction(userIds: string[]): Promise<ActionResult<{ notified: number }>> {
  return runAction("people.bulk_remind", async () => {
    if (userIds.length === 0) return fail("Select at least one person first.");
    await assertPermission("training.assign");

    let notified = 0;
    for (const userId of userIds) {
      const outstanding = await prisma.assignment.count({
        where: { userId, status: { in: ["ASSIGNED", "IN_PROGRESS", "OVERDUE"] } },
      });
      if (outstanding === 0) continue;
      await notify({
        userId,
        type: "TRAINING_DUE_SOON",
        title: "Reminder: outstanding training",
        body: `You have ${outstanding} training item${outstanding === 1 ? "" : "s"} outstanding.`,
        linkUrl: "/my-training",
        dedupeKey: `reminder-nudge:${userId}:${new Date().toDateString()}`,
      });
      notified += 1;
    }
    return ok({ notified });
  });
}

export async function bulkMoveDepartmentAction(input: {
  userIds: string[];
  departmentId: string;
}): Promise<ActionResult<{ updated: number; skipped: number }>> {
  return runAction("people.bulk_move_department", async () => {
    if (input.userIds.length === 0) return fail("Select at least one person first.");
    if (!input.departmentId) return fail("Choose a department.");
    const actor = await assertPermission("people.edit");
    const result = await bulkUpdate(actor, input.userIds, { departmentId: input.departmentId });
    revalidatePath("/admin/people");
    return ok({ updated: result.updated.length, skipped: result.skipped.length });
  });
}

export async function bulkChangeManagerAction(input: {
  userIds: string[];
  managerId: string;
}): Promise<ActionResult<{ updated: number; skipped: number }>> {
  return runAction("people.bulk_change_manager", async () => {
    if (input.userIds.length === 0) return fail("Select at least one person first.");
    if (!input.managerId) return fail("Choose a manager.");
    const actor = await assertPermission("people.edit");
    const result = await bulkUpdate(actor, input.userIds, { managerId: input.managerId });
    revalidatePath("/admin/people");
    return ok({ updated: result.updated.length, skipped: result.skipped.length });
  });
}

export async function bulkDeactivateAction(
  userIds: string[],
): Promise<ActionResult<{ updated: number; skipped: number; details: DeactivateResult[] }>> {
  return runAction("people.bulk_deactivate", async () => {
    if (userIds.length === 0) return fail("Select at least one person first.");
    const actor = await assertPermission("people.deactivate");
    const details: DeactivateResult[] = [];
    const skipped: string[] = [];
    for (const userId of userIds) {
      try {
        details.push(await deactivatePerson(actor, userId, { reason: "Bulk deactivation from admin console" }));
      } catch {
        skipped.push(userId);
      }
    }
    revalidatePath("/admin/people");
    return ok({ updated: userIds.length - skipped.length, skipped: skipped.length, details });
  });
}

export async function bulkExportAction(userIds: string[]): Promise<ActionResult<Record<string, unknown>[]>> {
  return runAction("people.bulk_export", async () => {
    if (userIds.length === 0) return fail("Select at least one person first.");
    const actor = await assertPermission("privacy.manage");
    const records: Record<string, unknown>[] = [];
    for (const userId of userIds) {
      records.push(await exportPersonData(actor, userId));
    }
    return ok(records);
  });
}
