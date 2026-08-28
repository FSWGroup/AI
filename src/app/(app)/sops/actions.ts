"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, type ActionResult } from "@/lib/action-result";
import { toggleFavorite } from "@/lib/services/sop";

export async function toggleFavoriteAction(sopId: string): Promise<ActionResult<{ favorited: boolean }>> {
  return runAction("sop.toggle_favorite", async () => {
    const actor = await assertPermission("sop.view");
    const favorited = await toggleFavorite(actor, sopId);
    revalidatePath("/sops");
    revalidatePath(`/sops/${sopId}`);
    return ok({ favorited });
  });
}
