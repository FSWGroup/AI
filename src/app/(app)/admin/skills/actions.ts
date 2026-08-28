"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import { createSkill, deleteSkillLevel, updateSkill, upsertSkillLevel, type SkillInput } from "@/lib/services/skills";

function refresh() {
  revalidatePath("/admin/skills");
}

export async function createSkillAction(input: SkillInput): Promise<ActionResult> {
  return runAction("skills.create", async () => {
    if (!input.name) return fail("Name is required.");
    const actor = await assertPermission("skills.manage");
    await createSkill(actor, input);
    refresh();
    return ok();
  });
}

export async function updateSkillAction(id: string, input: Partial<SkillInput>): Promise<ActionResult> {
  return runAction("skills.update", async () => {
    const actor = await assertPermission("skills.manage");
    await updateSkill(actor, id, input);
    refresh();
    return ok();
  });
}

export async function upsertSkillLevelAction(value: number, name: string): Promise<ActionResult> {
  return runAction("skills.upsert_level", async () => {
    if (!name) return fail("Name is required.");
    if (!Number.isInteger(value) || value < 0) return fail("Level value must be a non-negative integer.");
    const actor = await assertPermission("skills.manage");
    await upsertSkillLevel(actor, value, name);
    refresh();
    return ok();
  });
}

export async function deleteSkillLevelAction(value: number): Promise<ActionResult> {
  return runAction("skills.delete_level", async () => {
    const actor = await assertPermission("skills.manage");
    await deleteSkillLevel(actor, value);
    refresh();
    return ok();
  });
}
