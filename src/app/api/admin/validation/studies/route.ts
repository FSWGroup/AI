/** Validity studies: list and create. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { CRITERION_BY_KEY } from "@/content/performance-criteria";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  jobProfileId: z.string().min(1).nullish(),
  criterionKind: z.enum([
    "OVERALL_RATING",
    "COMPETENCY_RATING",
    "COMPOSITE_RATING",
    "METRIC",
    "RETENTION",
  ]),
  criterionKeys: z.array(z.string()).default([]),
  retentionDays: z.number().int().min(1).max(3650).nullish(),
  cycleKinds: z
    .array(z.enum(["DAY_30", "DAY_90", "DAY_180", "ANNUAL", "AD_HOC"]))
    .default([]),
  hiredFrom: z.string().nullish(),
  hiredTo: z.string().nullish(),
  correctRangeRestriction: z.boolean().default(true),
  correctAttenuation: z.boolean().default(true),
});

export const GET = withErrorHandling(async () => {
  await requirePermission("VIEW_VALIDATION");
  const studies = await prisma.validationStudy.findMany({
    include: {
      jobProfile: { select: { name: true } },
      _count: { select: { coefficients: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return apiOk({ studies });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_VALIDATION");
  const body = await parseBody(req, createSchema);

  const keys = body.criterionKeys ?? [];
  if (body.criterionKind === "COMPETENCY_RATING" && keys.length !== 1) {
    return apiError("Name exactly one performance criterion for this study.", 422);
  }
  if (body.criterionKind === "COMPOSITE_RATING" && keys.length < 2) {
    return apiError("A composite criterion needs at least two performance criteria.", 422);
  }
  if (body.criterionKind === "METRIC" && keys.length !== 1) {
    return apiError("Name exactly one metric key for this study.", 422);
  }
  if (
    (body.criterionKind === "COMPETENCY_RATING" ||
      body.criterionKind === "COMPOSITE_RATING") &&
    keys.some((k) => !CRITERION_BY_KEY.has(k))
  ) {
    return apiError("One of those performance criteria is not recognised.", 422);
  }

  // Dates, parsed once and checked. `new Date("not-a-date")` is an Invalid
  // Date, which Prisma rejects at the driver with a 500.
  const hiredFrom = body.hiredFrom ? new Date(body.hiredFrom) : null;
  const hiredTo = body.hiredTo ? new Date(body.hiredTo) : null;
  if (hiredFrom && Number.isNaN(hiredFrom.getTime())) {
    return apiError("That start date is not a date.", 422);
  }
  if (hiredTo && Number.isNaN(hiredTo.getTime())) {
    return apiError("That end date is not a date.", 422);
  }
  if (hiredFrom && hiredTo && hiredFrom > hiredTo) {
    return apiError(
      "The hire window ends before it starts, so no hire can fall inside it. The study would run to n = 0 and be stamped as computed.",
      422,
    );
  }

  if (body.jobProfileId) {
    const profile = await prisma.jobProfile.findUnique({
      where: { id: body.jobProfileId },
      select: { id: true },
    });
    if (!profile) return apiError("That job profile does not exist.", 422);
  }

  const study = await prisma.validationStudy.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      jobProfileId: body.jobProfileId ?? null,
      criterionKind: body.criterionKind,
      criterionKeys: keys,
      retentionDays:
        body.criterionKind === "RETENTION" ? (body.retentionDays ?? 365) : null,
      cycleKinds: body.cycleKinds ?? [],
      hiredFrom,
      hiredTo,
      correctRangeRestriction: body.correctRangeRestriction ?? true,
      correctAttenuation: body.correctAttenuation ?? true,
      createdById: user.id,
    },
  });

  await audit({
    userId: user.id,
    action: "validation_study.created",
    entityType: "ValidationStudy",
    entityId: study.id,
    newValue: { name: study.name, criterionKind: study.criterionKind },
  });

  return apiOk({ id: study.id }, { status: 201 });
});
