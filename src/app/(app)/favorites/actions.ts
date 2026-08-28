"use server";

import { getActor, AuthenticationError } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { ok, runAction, type ActionResult } from "@/lib/action-result";
import type { EntityType } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function removeFavoriteAction(entityType: EntityType, entityId: string): Promise<ActionResult> {
  return runAction("favorites.remove", async () => {
    const actor = await getActor();
    if (!actor) throw new AuthenticationError();

    await prisma.favorite.deleteMany({ where: { userId: actor.id, entityType, entityId } });
    revalidatePath("/favorites");
    return ok();
  });
}
