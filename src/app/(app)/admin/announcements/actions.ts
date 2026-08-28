"use server";

import { assertPermission } from "@/lib/auth/guard";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { createAnnouncement, updateAnnouncement, deleteAnnouncement, type AnnouncementInput } from "@/lib/services/announcements";
import { revalidatePath } from "next/cache";

function parseInput(form: FormData): AnnouncementInput | null {
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const targetMode = String(form.get("targetMode") ?? "everyone") as AnnouncementInput["targetMode"];
  const targetId = String(form.get("targetId") ?? "").trim() || null;
  const startsAtRaw = String(form.get("startsAt") ?? "");
  const expiresAtRaw = String(form.get("expiresAt") ?? "");

  if (!title || !body) return null;

  return {
    title,
    body,
    targetMode,
    targetId,
    startsAt: startsAtRaw ? new Date(startsAtRaw) : new Date(),
    expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
    pinned: form.get("pinned") === "on",
    requiresAck: form.get("requiresAck") === "on",
  };
}

export async function createAnnouncementAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction("announcement.create", async () => {
    const actor = await assertPermission("announcements.manage");
    const input = parseInput(form);
    if (!input) return fail("Title and message are required.");
    const created = await createAnnouncement(actor, input);
    revalidatePath("/admin/announcements");
    return ok({ id: created.id });
  });
}

export async function updateAnnouncementAction(id: string, form: FormData): Promise<ActionResult> {
  return runAction("announcement.update", async () => {
    const actor = await assertPermission("announcements.manage");
    const input = parseInput(form);
    if (!input) return fail("Title and message are required.");
    await updateAnnouncement(actor, id, input);
    revalidatePath("/admin/announcements");
    revalidatePath(`/admin/announcements/${id}`);
    return ok();
  });
}

export async function deleteAnnouncementAction(id: string): Promise<ActionResult> {
  return runAction("announcement.delete", async () => {
    const actor = await assertPermission("announcements.manage");
    await deleteAnnouncement(actor, id);
    revalidatePath("/admin/announcements");
    return ok();
  });
}
