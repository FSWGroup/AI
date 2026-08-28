"use server";

import { getActor, AuthenticationError } from "@/lib/auth/guard";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/notifications";
import { ok, runAction, type ActionResult } from "@/lib/action-result";
import { revalidatePath } from "next/cache";

export async function markReadAction(id: string): Promise<ActionResult> {
  return runAction("notifications.read", async () => {
    const actor = await getActor();
    if (!actor) throw new AuthenticationError();
    await markNotificationRead(actor.id, id);
    revalidatePath("/notifications");
    return ok();
  });
}

export async function markAllReadAction(): Promise<ActionResult<{ count: number }>> {
  return runAction("notifications.read_all", async () => {
    const actor = await getActor();
    if (!actor) throw new AuthenticationError();
    const count = await markAllNotificationsRead(actor.id);
    revalidatePath("/notifications");
    return ok({ count });
  });
}
