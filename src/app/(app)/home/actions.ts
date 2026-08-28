"use server";

import { getActor, AuthenticationError } from "@/lib/auth/guard";
import { acknowledgeAnnouncement } from "@/lib/services/announcements";
import { ok, runAction, type ActionResult } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function acknowledgeAnnouncementAction(announcementId: string): Promise<ActionResult> {
  return runAction("announcement.acknowledge", async () => {
    const actor = await getActor();
    if (!actor) throw new AuthenticationError();

    await acknowledgeAnnouncement(actor.id, announcementId);
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "announcement.acknowledged",
      entityType: "ANNOUNCEMENT",
      entityId: announcementId,
    });

    revalidatePath("/home");
    return ok();
  });
}
