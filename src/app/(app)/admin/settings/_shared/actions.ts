"use server";

import { assertPermission } from "@/lib/auth/guard";
import { getSettings, updateSettingSection, type AppSettings } from "@/lib/settings";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { revalidatePath } from "next/cache";

type SectionKey = "brand" | "training" | "privacy" | "features" | "languages";

/**
 * Generic settings-section save used by every simple settings sub-page
 * (training defaults, content review, notifications, privacy, features,
 * languages, brand, video). Merges the given partial fields into the current
 * section, writes through updateSettingSection, and audits settings.changed
 * with only the changed keys — never full values, since some sections may
 * later carry sensitive-ish fields.
 */
export async function saveSettingsSection(
  section: SectionKey,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  return runAction("settings.save", async () => {
    const actor = await assertPermission("settings.manage");
    const current = await getSettings();
    const merged = { ...(current[section] as Record<string, unknown>), ...patch };

    await updateSettingSection(section, merged, actor.id);
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: "APP_SETTING",
      entityId: section,
      metadata: { changedKeys: Object.keys(patch) },
    });

    revalidatePath("/admin/settings");
    return ok();
  });
}

export async function getSettingsSnapshot(): Promise<AppSettings> {
  return getSettings();
}

export async function saveOrganizationName(name: string): Promise<ActionResult> {
  return runAction("settings.organization.save", async () => {
    const actor = await assertPermission("settings.manage");
    const trimmed = name.trim();
    if (!trimmed) return fail("Organization name can't be empty.");

    const { prisma } = await import("@/lib/db");
    const existing = await prisma.organization.findFirst();
    if (existing) {
      await prisma.organization.update({ where: { id: existing.id }, data: { name: trimmed } });
    } else {
      await prisma.organization.create({ data: { name: trimmed } });
    }

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: "ORGANIZATION",
      metadata: { name: trimmed },
    });

    revalidatePath("/admin/settings/organization");
    return ok();
  });
}
