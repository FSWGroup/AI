"use server";

import { getActor, AuthenticationError } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { ok, runAction, type ActionResult } from "@/lib/action-result";
import type { NotificationType } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function setNotificationPreferenceAction(
  type: NotificationType,
  channel: "inApp" | "email",
  value: boolean,
): Promise<ActionResult> {
  return runAction("notification_preference.save", async () => {
    const actor = await getActor();
    if (!actor) throw new AuthenticationError();

    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: actor.id, type } },
      create: { userId: actor.id, type, inApp: channel === "inApp" ? value : true, email: channel === "email" ? value : true },
      update: { [channel]: value },
    });

    revalidatePath("/settings/notifications");
    return ok();
  });
}
