import { prisma } from "@/lib/db";
import type { Permission } from "@/lib/permissions";

/**
 * Actor identity and record-level scoping.
 *
 * Deliberately free of any session or framework dependency: these functions take
 * an Actor and answer questions about what it may reach. That keeps the scoping
 * rules — the part that actually protects personnel data — testable in isolation
 * and reusable from pages, API routes, background jobs, and the public REST API.
 *
 * Session resolution lives in guard.ts, which re-exports everything here.
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

export function actorHas(actor: Actor | null, permission: Permission): boolean {
  return Boolean(actor?.permissions.has(permission));
}

export function actorHasAny(actor: Actor | null, permissions: Permission[]): boolean {
  return permissions.some((p) => actorHas(actor, p));
}

export function actorHasAll(actor: Actor | null, permissions: Permission[]): boolean {
  return permissions.every((p) => actorHas(actor, p));
}

/** True when the actor's capabilities amount to platform-wide reporting reach. */
export function hasPlatformScope(actor: Actor): boolean {
  if (!actor.permissions.has("reports.view") || !actor.permissions.has("people.view")) {
    return false;
  }
  return (
    actor.permissions.has("training.assign") ||
    actor.permissions.has("compliance.view") ||
    actor.permissions.has("audit.view") ||
    actor.permissions.has("people.edit")
  );
}

/**
 * The set of user IDs an actor may view.
 *
 * Returns "ALL" for platform-wide scope; otherwise the actor plus their full
 * reporting subtree (not merely direct reports), resolved in one recursive CTE
 * so depth does not cost extra queries.
 */
export async function getVisibleUserIds(actor: Actor): Promise<string[] | "ALL"> {
  if (hasPlatformScope(actor)) return "ALL";

  const ids = new Set<string>([actor.id]);

  if (actor.permissions.has("team.view")) {
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

/**
 * True when the actor may act on the given person — assign training, approve a
 * sign-off, edit their record.
 *
 * `training.assign` is platform-wide. `team.assign` is limited to the actor's
 * subtree and deliberately excludes the actor themselves, so a manager cannot
 * self-assign through the team path.
 */
export async function canManageUser(actor: Actor, targetUserId: string): Promise<boolean> {
  if (actor.permissions.has("training.assign")) return true;
  if (!actor.permissions.has("team.assign")) return false;

  const visible = await getVisibleUserIds(actor);
  if (visible === "ALL") return true;
  return visible.includes(targetUserId) && targetUserId !== actor.id;
}

/**
 * Build an Actor from a user ID by reading their roles and permissions.
 * Shared by session resolution and by API-key/job contexts that have a user ID
 * but no session.
 */
export async function buildActor(userId: string): Promise<Actor | null> {
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

  const { roles: _roles, ...rest } = user;
  return { ...rest, permissions, roleKeys };
}
