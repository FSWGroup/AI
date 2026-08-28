"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import {
  deactivatePerson,
  setSensitiveField,
  updatePerson,
  type DeactivateResult,
  type UpdatePersonInput,
} from "@/lib/services/people";
import type { ProfileChangeResult } from "@/lib/services/assignment";

export async function updatePersonAction(
  userId: string,
  input: UpdatePersonInput,
): Promise<ActionResult<ProfileChangeResult | null>> {
  return runAction("people.update", async () => {
    if (!userId) return fail("Missing person.");
    const actor = await assertPermission("people.edit");
    const result = await updatePerson(actor, userId, input);
    revalidatePath(`/admin/people/${userId}/edit`);
    revalidatePath(`/people/${userId}`);
    revalidatePath("/admin/people");
    return ok(result);
  });
}

export async function deactivatePersonAction(userId: string, reason?: string): Promise<ActionResult<DeactivateResult>> {
  return runAction("people.deactivate_one", async () => {
    const actor = await assertPermission("people.deactivate");
    const result = await deactivatePerson(actor, userId, { reason });
    revalidatePath(`/admin/people/${userId}/edit`);
    revalidatePath(`/people/${userId}`);
    revalidatePath("/admin/people");
    return ok(result);
  });
}

export async function setSensitiveFieldAction(userId: string, fieldKey: string, value: string): Promise<ActionResult> {
  return runAction("people.set_sensitive_field", async () => {
    if (!fieldKey) return fail("Missing field.");
    const actor = await assertPermission("people.sensitive_edit");
    await setSensitiveField(actor, userId, fieldKey, value);
    return ok();
  });
}
