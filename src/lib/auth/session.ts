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

/**
 * Require any one of several permissions.
 *
 * For endpoints two different roles reach for different reasons — a work
 * sample's rubric is read both by the person who wrote it and by the people
 * marking against it — where the alternative is gating on some third, broader
 * permission that both happen to hold and that a fourth role holds too.
 */
export async function requireAnyPermission(
  permissions: Permission[],
): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not signed in.", 401);
  if (!permissions.some((p) => can(user.role, p))) {
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

/**
 * Headers set by the edge itself, which a client cannot forge because the
 * platform overwrites whatever arrived. Checked before anything else.
 */
const PLATFORM_IP_HEADERS = [
  "x-nf-client-connection-ip", // Netlify
  "cf-connecting-ip", // Cloudflare
  "true-client-ip", // Akamai, Cloudflare Enterprise
  "x-vercel-forwarded-for", // Vercel
];

/**
 * How many proxies sit in front of this app and APPEND to X-Forwarded-For.
 *
 * Zero by default, which means no X-Forwarded-For entry is believed at all.
 * That is the only safe default: with N configured but no proxy actually in
 * front, a client sending a single forged entry has that entry sitting at
 * exactly the position the Nth-from-the-right rule reads, and the forgery
 * wins — which is the bug this whole function exists to fix, reintroduced by
 * a default that assumes an architecture nobody declared.
 *
 * The recognised platform headers below need no configuration and cover the
 * deployments this actually ships on. Anything else — a self-hosted nginx,
 * say — must state its hop count, because only the operator knows it.
 */
const TRUSTED_PROXY_HOPS = Math.max(
  0,
  Number(process.env.TRUSTED_PROXY_HOPS ?? "0") || 0,
);

/**
 * The client's address, as far as it can be established.
 *
 * Reading the LEFTMOST X-Forwarded-For entry — the obvious thing, and what
 * this used to do — reads a value the client wrote. Every proxy appends; only
 * the entries a proxy added are trustworthy. So a caller sending
 * `X-Forwarded-For: 10.0.0.1` simply became 10.0.0.1, and since every public
 * token route keys its rate limit on this, sending a different value each time
 * turned the limits off entirely. It also meant an attacker chose what the
 * audit log recorded about them.
 *
 * The order here is: a header the edge sets and overwrites, then — only when
 * TRUSTED_PROXY_HOPS says a proxy is really there — the X-Forwarded-For entry
 * our own outermost proxy contributed, counting from the right, which is the
 * end proxies append to. Nothing falls back to the leftmost entry.
 *
 * Returning undefined is a deliberate outcome, not a failure: callers key
 * their rate limits on it, and one shared bucket for callers we cannot tell
 * apart is the right answer. Pretending to tell them apart is not.
 */
export function clientIpFrom(get: (name: string) => string | null): string | undefined {
  for (const name of PLATFORM_IP_HEADERS) {
    const value = get(name)?.trim();
    if (value) return value.split(",")[0].trim();
  }

  const forwarded = TRUSTED_PROXY_HOPS > 0 ? get("x-forwarded-for") : null;
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    // hops=1 → the last entry, which our own proxy appended.
    const index = hops.length - TRUSTED_PROXY_HOPS;
    if (index >= 0 && hops[index]) return hops[index];
    // Fewer entries than configured hops: the chain is not what we were told
    // it is, so trust none of it.
    return undefined;
  }

  return get("x-real-ip")?.trim() || undefined;
}

export async function requestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers();
  return {
    ip: clientIpFrom((name) => h.get(name)),
    userAgent: h.get("user-agent") ?? undefined,
  };
}
