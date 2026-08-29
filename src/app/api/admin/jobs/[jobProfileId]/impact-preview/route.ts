/**
 * Live benchmark impact preview.
 *
 * Answers two questions about a proposed benchmark, before it is saved:
 *  1. How would it screen the candidates already assessed for this role?
 *     (Always available — needs no demographic data at all.)
 *  2. Does it produce selection-rate disparities that fail the four-fifths
 *     screen? (Only when the compliance module is on and enough candidates
 *     have voluntarily self-identified.)
 *
 * Returns aggregates only. Individual demographic data is never included in
 * the response and is never joined into any candidate-facing query.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import {
  analyzeCategory,
  outcomesByCategory,
  previewPool,
  type BenchmarkRule,
  type CandidateBands,
} from "@/lib/analytics/impact";

export const runtime = "nodejs";

const schema = z.object({
  benchmarks: z
    .array(
      z.object({
        construct: z.string().min(1).max(50),
        minScore: z.number().int().min(1).max(9),
        maxScore: z.number().int().min(1).max(9),
        enabled: z.boolean(),
        required: z.boolean(),
      }),
    )
    .max(20),
});

const CATEGORIES: { key: string; label: string }[] = [
  { key: "sex", label: "Sex" },
  { key: "raceEthnicity", label: "Race / ethnicity" },
];

export const POST = withErrorHandling(async (req, ctx) => {
  await requirePermission("MANAGE_BENCHMARKS");
  const { jobProfileId } = await ctx.params;
  const { benchmarks } = await parseBody(req, schema);

  const profile = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
    select: { id: true },
  });
  if (!profile) return apiError("Job profile not found.", 404);

  const attempts = await prisma.attempt.findMany({
    where: {
      status: "COMPLETED",
      jobOpening: { jobProfileId },
    },
    select: { id: true, scores: { select: { construct: true, band: true } } },
  });

  const rules: BenchmarkRule[] = benchmarks;
  const candidates: CandidateBands[] = attempts.map((a) => ({
    attemptId: a.id,
    bands: Object.fromEntries(a.scores.map((s) => [s.construct, s.band])),
  }));

  const pool = previewPool(candidates, rules);

  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  let impact: ReturnType<typeof analyzeCategory>[] | null = null;
  let eeoCoverage: { withSelfId: number; total: number } | null = null;

  if (settings?.eeoModuleEnabled && candidates.length > 0) {
    const records = await prisma.eeoRecord.findMany({
      where: { attemptRef: { in: candidates.map((c) => c.attemptId) } },
      select: { attemptRef: true, data: true },
    });
    const byAttempt = new Map(
      records.map((r) => [r.attemptRef, r.data as Record<string, string>]),
    );
    const withDemographics: CandidateBands[] = candidates.map((c) => ({
      ...c,
      demographics: byAttempt.get(c.attemptId) ?? null,
    }));
    eeoCoverage = { withSelfId: records.length, total: candidates.length };
    impact = CATEGORIES.map((cat) =>
      analyzeCategory(
        cat.label,
        outcomesByCategory(withDemographics, rules, cat.key),
      ),
    ).filter((a) => a.totalApplicants > 0);
    if (impact.length === 0) impact = null;
  }

  return apiOk({
    pool,
    impact,
    eeoCoverage,
    eeoEnabled: Boolean(settings?.eeoModuleEnabled),
  });
});
