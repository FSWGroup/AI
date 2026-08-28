"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import {
  createComplianceRule,
  createExemption,
  updateComplianceRule,
  verifyRule,
  type ComplianceRuleInput,
  type CreateExemptionInput,
} from "@/lib/services/compliance";
import { assignTraining, type AssignTrainingResult } from "@/lib/services/assignment";

function refresh() {
  revalidatePath("/admin/compliance");
}

export async function createComplianceRuleAction(input: ComplianceRuleInput): Promise<ActionResult> {
  return runAction("compliance.create_rule", async () => {
    if (!input.name || !input.jurisdiction || !input.requirement) return fail("Name, jurisdiction, and requirement are required.");
    const actor = await assertPermission("compliance.manage");
    await createComplianceRule(actor, input);
    refresh();
    return ok();
  });
}

export async function updateComplianceRuleAction(id: string, input: Partial<ComplianceRuleInput>): Promise<ActionResult> {
  return runAction("compliance.update_rule", async () => {
    const actor = await assertPermission("compliance.manage");
    await updateComplianceRule(actor, id, input);
    refresh();
    return ok();
  });
}

export async function verifyRuleAction(ruleId: string): Promise<ActionResult> {
  return runAction("compliance.verify_rule", async () => {
    const actor = await assertPermission("compliance.manage");
    await verifyRule(actor, ruleId);
    refresh();
    return ok();
  });
}

export async function createExemptionAction(input: CreateExemptionInput): Promise<ActionResult> {
  return runAction("compliance.create_exemption", async () => {
    if (!input.reason) return fail("A reason is required.");
    const actor = await assertPermission("compliance.manage");
    await createExemption(actor, input);
    refresh();
    return ok();
  });
}

export async function bulkAssignNonCompliantAction(input: {
  userIds: string[];
  courseId: string;
  reason: string;
}): Promise<ActionResult<AssignTrainingResult>> {
  return runAction("compliance.bulk_assign", async () => {
    if (input.userIds.length === 0) return fail("There is no one to assign.");
    const actor = await assertPermission("training.assign");
    const result = await assignTraining(actor, {
      userIds: input.userIds,
      targetType: "COURSE",
      courseId: input.courseId,
      reason: input.reason,
    });
    refresh();
    return ok(result);
  });
}
