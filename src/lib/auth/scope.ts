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

/**
 * Job scoping for the recruiting side of the product.
 *
 * The assessment side scopes through `Attempt.jobOpening`; a requisition,
 * an application, an interview and a work-sample assignment all hang off
 * `Requisition.jobProfileId` instead. Without these a hiring manager with a
 * permission that was written for their own roles — grading, interviewing,
 * scheduling — holds it over every role in the company, because the
 * permission check answers "may you grade?" and nothing answers "grade
 * whose?".
 *
 * A requisition with no job profile attached is treated as out of scope for
 * a job-scoped role rather than as open to everyone: a missing link is not
 * a grant.
 */
async function assertScopedTo(
  user: User,
  jobProfileId: string | null | undefined,
  message: string,
): Promise<void> {
  const ids = await scopedJobProfileIds(user);
  if (ids === null) return;
  if (!jobProfileId || !ids.includes(jobProfileId)) {
    const { AuthError } = await import("./session");
    throw new AuthError(message, 403);
  }
}

export async function assertRequisitionAccess(
  user: User,
  requisitionId: string,
): Promise<void> {
  const ids = await scopedJobProfileIds(user);
  if (ids === null) return;
  const req = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    select: { jobProfileId: true },
  });
  await assertScopedTo(user, req?.jobProfileId, "You do not have access to this requisition.");
}

export async function assertApplicationAccess(
  user: User,
  applicationId: string,
): Promise<void> {
  const ids = await scopedJobProfileIds(user);
  if (ids === null) return;
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { requisition: { select: { jobProfileId: true } } },
  });
  await assertScopedTo(
    user,
    application?.requisition.jobProfileId,
    "You do not have access to this candidate.",
  );
}

export async function assertInterviewAccess(
  user: User,
  interviewId: string,
): Promise<void> {
  const ids = await scopedJobProfileIds(user);
  if (ids === null) return;
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: {
      application: { select: { requisition: { select: { jobProfileId: true } } } },
    },
  });
  await assertScopedTo(
    user,
    interview?.application.requisition.jobProfileId,
    "You do not have access to this interview.",
  );
}

/** Requisition-scope `where` fragment, for list queries. */
export async function requisitionScopeWhere(
  user: User,
): Promise<Prisma.RequisitionWhereInput> {
  const ids = await scopedJobProfileIds(user);
  if (ids === null) return {};
  return { jobProfileId: { in: ids } };
}
