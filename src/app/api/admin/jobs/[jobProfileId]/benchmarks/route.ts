import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import type { Construct } from "@prisma/client";

const benchmarkSchema = z.object({
  construct: z.string().min(1).max(50),
  minScore: z.number().int().min(1).max(9),
  maxScore: z.number().int().min(1).max(9),
  required: z.boolean(),
  enabled: z.boolean(),
  weight: z.number().min(0).max(5),
  note: z.string().max(500).nullable().optional(),
});

const schema = z.object({
  benchmarks: z.array(benchmarkSchema).max(20),
  concernRules: z
    .array(
      z.object({
        construct: z.string().min(1).max(50),
        maxBand: z.number().int().min(1).max(9),
        enabled: z.boolean(),
      }),
    )
    .max(20)
    .optional(),
});

export const PUT = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_BENCHMARKS");
  const { jobProfileId } = await ctx.params;
  const body = await parseBody(req, schema);

  const profile = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
    include: { benchmarks: true, concernRules: true },
  });
  if (!profile) return apiError("Job profile not found.", 404);

  for (const b of body.benchmarks) {
    if (b.minScore > b.maxScore) {
      return apiError(`Invalid range for ${b.construct}: min exceeds max.`, 422);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const b of body.benchmarks) {
      await tx.jobDimensionBenchmark.upsert({
        where: {
          jobProfileId_construct: {
            jobProfileId,
            construct: b.construct as Construct,
          },
        },
        create: {
          jobProfileId,
          construct: b.construct as Construct,
          minScore: b.minScore,
          maxScore: b.maxScore,
          required: b.required,
          enabled: b.enabled,
          weight: b.weight,
          note: b.note ?? null,
        },
        update: {
          minScore: b.minScore,
          maxScore: b.maxScore,
          required: b.required,
          enabled: b.enabled,
          weight: b.weight,
          note: b.note ?? null,
        },
      });
    }
    for (const r of body.concernRules ?? []) {
      await tx.areaOfConcernRule.upsert({
        where: {
          jobProfileId_construct: {
            jobProfileId,
            construct: r.construct as Construct,
          },
        },
        create: {
          jobProfileId,
          construct: r.construct as Construct,
          maxBand: r.maxBand,
          enabled: r.enabled,
        },
        update: { maxBand: r.maxBand, enabled: r.enabled },
      });
    }
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.BENCHMARK_UPDATED,
    entityType: "JobProfile",
    entityId: jobProfileId,
    previousValue: {
      benchmarks: profile.benchmarks.map((b) => ({
        construct: b.construct,
        min: b.minScore,
        max: b.maxScore,
        enabled: b.enabled,
      })),
    },
    newValue: {
      benchmarks: body.benchmarks.map((b) => ({
        construct: b.construct,
        min: b.minScore,
        max: b.maxScore,
        enabled: b.enabled,
      })),
    },
  });
  return apiOk({ ok: true });
});
