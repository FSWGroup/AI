"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import { assessSkill, type AssessSkillInput } from "@/lib/services/skills";

export async function assessSkillAction(input: AssessSkillInput): Promise<ActionResult<{ id: string }>> {
  return runAction("team.assess_skill", async () => {
    if (!input.userId || !input.skillId) return fail("Choose a person and a skill.");
    const actor = await assertPermission("skills.assess");
    const result = await assessSkill(actor, input);
    revalidatePath("/team/approvals");
    revalidatePath("/team/skills");
    return ok(result);
  });
}
