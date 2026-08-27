import "server-only";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isJobScoped } from "./rbac";

/**
 * Prisma `where` fragment limiting attempts/invitations to job profiles the
 * user is assigned to (insecure-direct-object-reference protection for
 * job-scoped roles). Unscoped roles see everything their permission allows.
 */
export async function scopedJobProfileIds(user: User): Promise<string[] | null> {
  if (!isJobScoped(user.role)) return null;
  const assignments = await prisma.jobProfileAssignment.findMany({
    where: { userId: user.id },
    select: { jobProfileId: true },
  });
  return assignments.map((a) => a.jobProfileId);
}

export async function attemptScopeWhere(
  user: User,
): Promise<Prisma.AttemptWhereInput> {
  const ids = await scopedJobProfileIds(user);
  if (ids === null) return {};
  return { jobOpening: { jobProfileId: { in: ids } } };
}

export async function assertAttemptAccess(
  user: User,
  attemptId: string,
): Promise<void> {
  const ids = await scopedJobProfileIds(user);
  if (ids === null) return;
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { jobOpening: { select: { jobProfileId: true } } },
  });
  if (!attempt || !ids.includes(attempt.jobOpening.jobProfileId)) {
    const { AuthError } = await import("./session");
    throw new AuthError("You do not have access to this candidate.", 403);
  }
}
