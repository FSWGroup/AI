import "server-only";
import { auth } from "@/lib/auth/config";
import type { Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  AuthenticationError,
  AuthorizationError,
  buildActor,
  type Actor,
} from "@/lib/auth/scope";

/**
 * Session-aware authorization.
 *
 * Every page, server action, and API route that is not unambiguously public
 * flows through here. UI-level hiding is never trusted as a control.
 *
 * Record-level scoping (getVisibleUserIds, canViewUser, canManageUser) lives in
 * ./scope.ts, which has no session or framework dependency, and is re-exported
 * below so callers have a single import site.
 */

export {
  AuthenticationError,
  AuthorizationError,
  actorHas,
  actorHasAll,
  actorHasAny,
  buildActor,
  canManageUser,
  canViewUser,
  getVisibleUserIds,
  hasPlatformScope,
  type Actor,
} from "@/lib/auth/scope";

/**
 * Resolve the current actor with their effective permission set.
 *
 * Memoized per request with React `cache`, so a page with many guarded sections
 * issues one query rather than one per check.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return buildActor(userId);
});

/** Require an authenticated actor; redirects to sign-in for page rendering. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  return actor;
}

/**
 * Require a permission for page rendering.
 *
 * Unauthenticated visitors go to sign-in; authenticated but unauthorized users
 * go to an explanatory /forbidden page rather than into a redirect loop.
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
 * Server-action and API-route variant: throws instead of redirecting, so the
 * caller can return a structured error to the client.
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

/** Require authentication only, throwing rather than redirecting. */
export async function assertAuthenticated(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthenticationError();
  return actor;
}
