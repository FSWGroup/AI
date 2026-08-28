"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import { bulkArchiveSops, bulkAssignOwner } from "@/lib/services/sop";

export async function bulkArchiveSopsAction(sopIds: string[]): Promise<ActionResult<{ count: number }>> {
  return runAction("sop.bulk_archive", async () => {
    if (sopIds.length === 0) return fail("Select at least one SOP first.");
    const actor = await assertPermission("sop.archive");
    const count = await bulkArchiveSops(actor, sopIds);
    revalidatePath("/admin/sops");
    return ok({ count });
  });
}

export async function bulkAssignOwnerAction(input: { sopIds: string[]; ownerId: string }): Promise<ActionResult<{ count: number }>> {
  return runAction("sop.bulk_assign_owner", async () => {
    if (input.sopIds.length === 0) return fail("Select at least one SOP first.");
    if (!input.ownerId) return fail("Choose an owner.");
    const actor = await assertPermission("sop.create");
    const count = await bulkAssignOwner(actor, input.sopIds, input.ownerId);
    revalidatePath("/admin/sops");
    return ok({ count });
  });
}
