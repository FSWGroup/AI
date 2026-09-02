/**
 * Employment records.
 *
 * Most hires arrive automatically when an offer is accepted. This endpoint
 * exists for the rest: people hired before the platform, people hired outside
 * it, and corrections. A hire entered by hand still has to be linked to an
 * attempt before it can appear in a study — a study needs a predictor, and
 * an employment record with no assessment behind it is a personnel row, not
 * a data point.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

const createSchema = z.object({
  candidateId: z.string().min(1),
  attemptId: z.string().min(1).nullish(),
  jobTitle: z.string().min(1).max(200),
  jobProfileId: z.string().min(1).nullish(),
  managerId: z.string().min(1).nullish(),
  hiredAt: z.string().min(1),
});

export const GET = withErrorHandling(async () => {
  await requirePermission("MANAGE_HIRES");
  const hires = await prisma.hire.findMany({
    include: {
      candidate: true,
      jobProfile: { select: { name: true } },
      manager: { select: { id: true, name: true } },
      _count: { select: { reviews: true } },
    },
    orderBy: { hiredAt: "desc" },
    take: 500,
  });
  return apiOk({
    hires: hires.map((h) => ({
      id: h.id,
      name: `${h.candidate.firstName} ${h.candidate.lastName}`,
      jobTitle: h.jobTitle,
      jobProfile: h.jobProfile?.name ?? null,
      manager: h.manager?.name ?? null,
      hiredAt: h.hiredAt,
      status: h.status,
      hasAttempt: h.attemptId !== null,
      reviewCount: h._count.reviews,
    })),
  });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_HIRES");
  const body = await parseBody(req, createSchema);

  const hiredAt = new Date(body.hiredAt);
  if (Number.isNaN(hiredAt.getTime())) return apiError("That hire date is not valid.", 422);

  if (body.attemptId) {
    const attempt = await prisma.attempt.findUnique({
      where: { id: body.attemptId },
      include: { hire: true },
    });
    if (!attempt) return apiError("That assessment attempt does not exist.", 404);
    if (attempt.candidateId !== body.candidateId) {
      return apiError("That attempt belongs to a different candidate.", 422);
    }
    if (attempt.hire) {
      return apiError(
        "That attempt is already linked to an employment record. One attempt supplies the predictor scores for one hire; linking it twice would count the same person twice in every study.",
        409,
      );
    }
  }

  const hire = await prisma.hire.create({
    data: {
      candidateId: body.candidateId,
      attemptId: body.attemptId ?? null,
      jobTitle: body.jobTitle,
      jobProfileId: body.jobProfileId ?? null,
      managerId: body.managerId ?? null,
      hiredAt,
      createdById: user.id,
    },
  });

  await audit({
    userId: user.id,
    action: "hire.recorded",
    entityType: "Hire",
    entityId: hire.id,
    newValue: { jobTitle: hire.jobTitle, manual: true },
  });

  return apiOk({ id: hire.id }, { status: 201 });
});
