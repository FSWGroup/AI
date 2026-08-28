"use server";

import { revalidatePath } from "next/cache";
import { assertAnyPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import { assignTraining, unassign, waiveAssignment, type AssignTrainingResult } from "@/lib/services/assignment";
import type { TrainingTargetType } from "@prisma/client";

export async function assignToTeamAction(input: {
  userIds: string[];
  targetType: TrainingTargetType;
  courseId?: string | null;
  sopId?: string | null;
  pathId?: string | null;
  dueAt?: string | null;
  reason?: string | null;
}): Promise<ActionResult<AssignTrainingResult>> {
  return runAction("team.assign", async () => {
    if (input.userIds.length === 0) return fail("Select at least one person first.");
    if (!input.courseId && !input.sopId && !input.pathId) return fail("Choose a course, SOP, or learning path.");
    const actor = await assertAnyPermission(["team.assign", "training.assign"]);
    const result = await assignTraining(actor, {
      userIds: input.userIds,
      targetType: input.targetType,
      courseId: input.courseId ?? null,
      sopId: input.sopId ?? null,
      pathId: input.pathId ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      reason: input.reason || null,
    });
    revalidatePath("/team/assignments");
    revalidatePath("/team/status");
    return ok(result);
  });
}

export async function unassignFromTeamAction(assignmentId: string, reason: string): Promise<ActionResult> {
  return runAction("team.unassign", async () => {
    const actor = await assertAnyPermission(["team.assign", "training.assign"]);
    await unassign(actor, assignmentId, reason || "Removed by manager");
    revalidatePath("/team/assignments");
    revalidatePath("/team/status");
    return ok();
  });
}

export async function waiveTeamAssignmentAction(assignmentId: string, reason: string): Promise<ActionResult> {
  return runAction("team.waive", async () => {
    if (!reason) return fail("A reason is required to waive an assignment.");
    const actor = await assertAnyPermission(["team.assign", "training.assign"]);
    await waiveAssignment(actor, assignmentId, reason);
    revalidatePath("/team/assignments");
    revalidatePath("/team/status");
    return ok();
  });
}
