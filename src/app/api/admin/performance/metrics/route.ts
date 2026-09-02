/**
 * Objective post-hire outcomes.
 *
 * Quota attainment, output per week, error rate — anything countable. Kept
 * separate from ratings because it carries no rater bias, which also means it
 * gets no correction for rater unreliability.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";

export const runtime = "nodejs";

const schema = z.object({
  hireId: z.string().min(1),
  key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "Use lower-case letters, digits and underscores."),
  label: z.string().min(1).max(160),
  value: z.number().finite(),
  unit: z.string().max(30).nullish(),
  higherIsBetter: z.boolean().default(true),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  source: z.string().max(200).nullish(),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_HIRES");
  const body = await parseBody(req, schema);

  const periodStart = new Date(body.periodStart);
  const periodEnd = new Date(body.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return apiError("Those dates are not valid.", 422);
  }
  if (periodEnd < periodStart) {
    return apiError("The period ends before it starts.", 422);
  }

  const hire = await prisma.hire.findUnique({ where: { id: body.hireId } });
  if (!hire) return apiError("That employment record does not exist.", 404);

  const metric = await prisma.performanceMetric.upsert({
    where: {
      hireId_key_periodStart_periodEnd: {
        hireId: body.hireId,
        key: body.key,
        periodStart,
        periodEnd,
      },
    },
    create: {
      hireId: body.hireId,
      key: body.key,
      label: body.label,
      value: body.value,
      unit: body.unit ?? null,
      higherIsBetter: body.higherIsBetter,
      periodStart,
      periodEnd,
      source: body.source ?? null,
      createdById: user.id,
    },
    update: {
      label: body.label,
      value: body.value,
      unit: body.unit ?? null,
      higherIsBetter: body.higherIsBetter,
      source: body.source ?? null,
    },
  });

  return apiOk({ id: metric.id }, { status: 201 });
});
