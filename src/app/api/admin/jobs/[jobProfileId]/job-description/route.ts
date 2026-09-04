/**
 * Job description management and AI benchmark proposal.
 *
 * PUT   — save the job description text on the profile (audited).
 * POST  — analyze it and return a proposed benchmark configuration.
 *
 * The proposal is NEVER applied automatically. It is returned for a human
 * to review in the benchmark editor, adjust, and save. That keeps a person
 * accountable for the selection criteria, which is what makes the benchmark
 * defensible.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { requirePermission, requestMeta } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { AI_MODEL, AiNotConfiguredError, isAiConfigured } from "@/lib/ai/client";
import { recordAnalysis } from "@/lib/ai/analysis-record";
import {
  JOB_DESCRIPTION_PROMPT_VERSION,
  analyzeJobDescription,
} from "@/lib/ai/job-description";

export const runtime = "nodejs";
export const maxDuration = 300;

const saveSchema = z.object({
  jobDescription: z.string().max(50_000),
});

export const PUT = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_BENCHMARKS");
  const { jobProfileId } = await ctx.params;
  const { jobDescription } = await parseBody(req, saveSchema);

  const existing = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
    select: { jobDescription: true },
  });
  if (!existing) return apiError("Job profile not found.", 404);

  await prisma.jobProfile.update({
    where: { id: jobProfileId },
    data: { jobDescription: jobDescription || null },
  });
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.JOB_DESCRIPTION_UPDATED,
    entityType: "JobProfile",
    entityId: jobProfileId,
    previousValue: { characters: existing.jobDescription?.length ?? 0 },
    newValue: { characters: jobDescription.length },
  });
  return apiOk({ ok: true });
});

const analyzeSchema = z.object({
  jobDescription: z.string().min(80).max(50_000),
  jobTitle: z.string().max(200).optional(),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_BENCHMARKS");
  const { jobProfileId } = await ctx.params;

  if (!isAiConfigured()) {
    return apiError(new AiNotConfiguredError().message, 501);
  }
  if (!rateLimit(`ai-jd:${user.id}`, 20, 60 * 60_000)) {
    return apiError("Too many analyses requested. Please wait a few minutes.", 429);
  }

  const body = await parseBody(req, analyzeSchema);
  const profile = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
    include: { openings: { take: 1 } },
  });
  if (!profile) return apiError("Job profile not found.", 404);

  const { output: proposal, record: saved } = await recordAnalysis({
    create: {
      kind: "JOB_DESCRIPTION",
      jobProfileId,
      model: AI_MODEL,
      promptVersion: JOB_DESCRIPTION_PROMPT_VERSION,
      requestedById: user.id,
    },
    run: async () => {
      const result = await analyzeJobDescription({
        jobTitle: body.jobTitle || profile.openings[0]?.title || profile.name,
        jobDescription: body.jobDescription,
      });
      return { ...result, output: result.proposal };
    },
    // Persist the description alongside the proposal so the benchmark's
    // job-relevance rationale is always recoverable.
    onSuccess: async () => {
      await prisma.jobProfile.update({
        where: { id: jobProfileId },
        data: { jobDescription: body.jobDescription },
      });
    },
  });

  const meta = await requestMeta();
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.AI_JOB_DESCRIPTION_ANALYSIS,
    entityType: "AiAnalysis",
    entityId: saved.id,
    newValue: {
      jobProfileId,
      model: AI_MODEL,
      promptVersion: JOB_DESCRIPTION_PROMPT_VERSION,
      applied: false,
    },
    ip: meta.ip,
  });

  return apiOk({ analysisId: saved.id, proposal });
});
