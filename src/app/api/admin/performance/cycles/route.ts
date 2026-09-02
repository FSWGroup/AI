/**
 * Performance review cycles.
 *
 * A cycle is a round of ratings. Tenure-anchored cycles (`dueAfterDays`) fall
 * due per person — everyone gets a 90-day review 90 days in. Calendar cycles
 * fall due for everyone at once.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { DEFAULT_CYCLE_CRITERIA, CRITERION_BY_KEY } from "@/content/performance-criteria";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(["DAY_30", "DAY_90", "DAY_180", "ANNUAL", "AD_HOC"]),
  dueAfterDays: z.number().int().min(0).max(3650).nullish(),
  criterionKeys: z.array(z.string()).min(1).optional(),
  instructions: z.string().max(4000).nullish(),
});

export const GET = withErrorHandling(async () => {
  await requirePermission("VIEW_VALIDATION");
  const cycles = await prisma.performanceCycle.findMany({
    include: { _count: { select: { reviews: true } } },
    orderBy: { createdAt: "desc" },
  });
  return apiOk({ cycles });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_VALIDATION");
  const body = await parseBody(req, createSchema);

  // Unknown criterion keys would produce a rating form with blank rows and a
  // study that silently drops them.
  const keys = (body.criterionKeys ?? DEFAULT_CYCLE_CRITERIA).filter((k) =>
    CRITERION_BY_KEY.has(k),
  );

  const cycle = await prisma.performanceCycle.create({
    data: {
      name: body.name,
      kind: body.kind,
      dueAfterDays: body.dueAfterDays ?? defaultDueDays(body.kind),
      criterionKeys: keys.length > 0 ? keys : DEFAULT_CYCLE_CRITERIA,
      instructions: body.instructions ?? null,
      status: "DRAFT",
    },
  });

  await audit({
    userId: user.id,
    action: "performance_cycle.created",
    entityType: "PerformanceCycle",
    entityId: cycle.id,
    newValue: { name: cycle.name, kind: cycle.kind },
  });

  return apiOk({ id: cycle.id }, { status: 201 });
});

function defaultDueDays(kind: string): number | null {
  switch (kind) {
    case "DAY_30":
      return 30;
    case "DAY_90":
      return 90;
    case "DAY_180":
      return 180;
    case "ANNUAL":
      return 365;
    default:
      return null;
  }
}
