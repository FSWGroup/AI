"use server";

import { assertPermission } from "@/lib/auth/guard";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { deleteMedia, updateMediaMetadata, getMediaUsage, type MediaUsage } from "@/lib/services/media";
import { revalidatePath } from "next/cache";

export async function deleteMediaAction(id: string): Promise<ActionResult<{ usage?: MediaUsage }>> {
  return runAction("media.delete", async () => {
    const actor = await assertPermission("media.delete");
    const result = await deleteMedia(actor, id);
    if (!result.ok) return fail(result.reason ?? "Couldn't delete that file.", undefined);
    revalidatePath("/admin/media");
    return ok({});
  });
}

export async function getMediaUsageAction(id: string): Promise<ActionResult<{ usage: MediaUsage }>> {
  return runAction("media.usage", async () => {
    await assertPermission("media.view");
    const usage = await getMediaUsage(id);
    return ok({ usage });
  });
}

export async function updateMediaAction(id: string, input: { title: string; altText: string }): Promise<ActionResult> {
  return runAction("media.update", async () => {
    await assertPermission("media.upload");
    await updateMediaMetadata(id, { title: input.title || null, altText: input.altText || null });
    revalidatePath("/admin/media");
    return ok();
  });
}
