import "server-only";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import type { Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { cache } from "react";

/**
 * Server-side authorization. Every mutation and every data read that is not
 * unambiguously public flows through here.
 *
 * UI-level hiding is never trusted: pages call requirePermission(), server
 * actions call requirePermission(), API routes call requireApiActor().
 */

export interface Actor {
  id: string;
  email: string;
  name: string;
  image: string | null;
  status: string;
  timezone: string;
  language: string;
  businessUnitId: string | null;
  departmentId: string | null;
  teamId: string | null;
  positionId: string | null;
  locationId: string | null;
  managerId: string | null;
  workerType: string;
  country: string;
  permissions: Set<Permission>;
  roleKeys: string[];
}

export class AuthorizationError extends Error {
  readonly permission: string;
  constructor(permission: string) {
    super(`Missing required permission: ${permission}`);
    this.name = "AuthorizationError";
    this.permission = permission;
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationError";
  }
}

/**
 * Resolve the current actor with their effective permission set.
 * Memoized per request via React cache so a page with many guarded sections
 * issues one query, not one per check.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      status: true,
      timezone: true,
      language: true,
      businessUnitId: true,
      departmentId: true,
      teamId: true,
      positionId: true,
      locationId: true,
      managerId: true,
      workerType: true,
      country: true,
      roles: {
        select: {
          role: {
            select: {
              key: true,
              permissions: { select: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!user || user.status === "INACTIVE") return null;

  const permissions = new Set<Permission>();
  const roleKeys: string[] = [];
  for (const { role } of user.roles) {
    roleKeys.push(role.key);
    for (const { permission } of role.permissions) {
      permissions.add(permission as Permission);
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    status: user.status,
    timezone: user.timezone,
    language: user.language,
    businessUnitId: user.businessUnitId,
    departmentId: user.departmentId,
    teamId: user.teamId,
    positionId: user.positionId,
    locationId: user.locationId,
    managerId: user.managerId,
    workerType: user.workerType,
    country: user.country,
    permissions,
    roleKeys,
  };
});

/** Require an authenticated actor; redirects to sign-in for page rendering. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  return actor;
}

export function actorHas(actor: Actor | null, permission: Permission): boolean {
  return Boolean(actor?.permissions.has(permission));
}

export function actorHasAny(actor: Actor | null, permissions: Permission[]): boolean {
  return permissions.some((p) => actorHas(actor, p));
}

/**
 * Require a permission for page rendering. Unauthenticated → sign-in,
 * authenticated but unauthorized → 403 page (not a redirect loop).
 */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (!actor.permissions.has(permission)) {
    redirect(`/forbidden?permission=${encodeURIComponent(permission)}`);
  }
  return actor;
}

export async function requireAnyPermission(permissions: Permission[]): Promise<Actor> {
  const actor = await requireActor();
  if (!permissions.some((p) => actor.permissions.has(p))) {
    redirect(`/forbidden?permission=${encodeURIComponent(permissions[0] ?? "unknown")}`);
  }
  return actor;
}

/**
 * Server-action variant: throws instead of redirecting so the action can return
 * a structured error to the client.
 */
export async function assertPermission(permission: Permission): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthenticationError();
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
  return actor;
}

export async function assertAnyPermission(permissions: Permission[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthenticationError();
  if (!permissions.some((p) => actor.permissions.has(p))) {
    throw new AuthorizationError(permissions.join(" or "));
  }
  return actor;
}

/**
 * Manager scope: the set of user IDs an actor may view through team.view,
 * walking the full reporting tree (not just direct reports).
 *
 * Actors with reports.view see everyone; managers see their subtree; everyone
 * else sees only themselves.
 */
export async function getVisibleUserIds(actor: Actor): Promise<string[] | "ALL"> {
  if (actor.permissions.has("reports.view") && actor.permissions.has("people.view")) {
    // Platform-wide reporting access.
    if (
      actor.permissions.has("training.assign") ||
      actor.permissions.has("compliance.view") ||
      actor.permissions.has("audit.view") ||
      actor.permissions.has("people.edit")
    ) {
      return "ALL";
    }
  }

  const ids = new Set<string>([actor.id]);
  if (actor.permissions.has("team.view")) {
    // Recursive CTE keeps this a single query regardless of org depth.
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT "id" FROM "User" WHERE "managerId" = ${actor.id}
        UNION
        SELECT u."id" FROM "User" u
        INNER JOIN subtree s ON u."managerId" = s."id"
      )
      SELECT "id" FROM subtree
    `;
    for (const row of rows) ids.add(row.id);
  }
  return [...ids];
}

/** True when the actor may view the given person's record. */
export async function canViewUser(actor: Actor, targetUserId: string): Promise<boolean> {
  if (actor.id === targetUserId) return true;
  const visible = await getVisibleUserIds(actor);
  if (visible === "ALL") return true;
  return visible.includes(targetUserId);
}

/** True when the actor may act on (assign/approve for) the given person. */
export async function canManageUser(actor: Actor, targetUserId: string): Promise<boolean> {
  if (actor.permissions.has("training.assign")) return true;
  if (!actor.permissions.has("team.assign")) return false;
  const visible = await getVisibleUserIds(actor);
  if (visible === "ALL") return true;
  return visible.includes(targetUserId) && targetUserId !== actor.id;
}
