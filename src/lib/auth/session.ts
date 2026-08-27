import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { can, type Permission } from "./rbac";

const SESSION_COOKIE = "fsw_session";
const SESSION_TTL_HOURS = 12;

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Current signed-in admin user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) {
    return null;
  }
  return session.user;
});

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** Require a signed-in user holding the given permission. */
export async function requirePermission(permission: Permission): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not signed in.", 401);
  if (!can(user.role, permission)) {
    throw new AuthError("You do not have permission to do that.", 403);
  }
  return user;
}

export async function requireAnyUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not signed in.", 401);
  return user;
}

/**
 * Job-profile scoping: HIRING_MANAGER (and scoped viewers) can only touch
 * candidates/attempts belonging to job profiles they are assigned to.
 */
export async function assertJobProfileAccess(
  user: User,
  jobProfileId: string,
): Promise<void> {
  if (user.role !== ("HIRING_MANAGER" as UserRole)) return;
  const assignment = await prisma.jobProfileAssignment.findUnique({
    where: { userId_jobProfileId: { userId: user.id, jobProfileId } },
  });
  if (!assignment) {
    throw new AuthError("You do not have access to this job profile.", 403);
  }
}

export async function requestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers();
  return {
    ip:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}
