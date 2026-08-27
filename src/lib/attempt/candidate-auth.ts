import "server-only";
import { cookies } from "next/headers";
import type { Attempt } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * Candidate attempt authentication.
 *
 * The candidate's browser holds an httpOnly cookie containing the attempt's
 * resume token (also delivered via the emailed resume link). The cookie is
 * scoped to the assessment routes and is the only credential candidate API
 * routes accept — the invitation token is single-purpose and only opens the
 * flow. Record IDs and phone digits are never authentication secrets.
 */

const ATTEMPT_COOKIE = "fsw_attempt";

export async function setAttemptCookie(resumeToken: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ATTEMPT_COOKIE, resumeToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearAttemptCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ATTEMPT_COOKIE);
}

export async function getAttemptFromCookie(): Promise<Attempt | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ATTEMPT_COOKIE)?.value;
  if (!token) return null;
  return prisma.attempt.findUnique({
    where: { resumeTokenHash: hashToken(token) },
  });
}

export async function getAttemptByResumeToken(
  token: string,
): Promise<Attempt | null> {
  return prisma.attempt.findUnique({
    where: { resumeTokenHash: hashToken(token) },
  });
}
