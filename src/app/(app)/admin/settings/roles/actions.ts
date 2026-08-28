"use server";

import { assertPermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

/** Replaces one role's full permission set. Used by the roles × permissions grid. */
export async function saveRolePermissions(roleId: string, permissions: string[]): Promise<ActionResult> {
  return runAction("roles.save", async () => {
    const actor = await assertPermission("settings.manage");
    const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, key: true } });
    if (!role) return fail("That role no longer exists.");

    const validPermissions = [...new Set(permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p)))];

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      ...(validPermissions.length > 0
        ? [prisma.rolePermission.createMany({ data: validPermissions.map((permission) => ({ roleId, permission })) })]
        : []),
    ]);

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.ROLE_CHANGED,
      entityType: "ROLE",
      entityId: roleId,
      metadata: { roleKey: role.key, permissionCount: validPermissions.length },
    });

    revalidatePath("/admin/settings/roles");
    return ok();
  });
}
