/**
 * Candidate fit analysis: run and retrieve.
 *
 * The analysis combines the completed assessment report, the role's job
 * description and benchmark, and (optionally) an uploaded résumé. It is
 * advisory decision support — it never alters scores and never recommends a
 * hiring decision. Every run is audited with the model and prompt version.
 */

import { prisma } from "@/lib/db";
import { apiError, apiOk, rateLimit, withErrorHandling } from "@/lib/api";
import { requirePermission, requestMeta } from "@/lib/auth/session";
import { assertAttemptAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { AI_MODEL, AiNotConfiguredError, isAiConfigured } from "@/lib/ai/client";
import { recordAnalysis } from "@/lib/ai/analysis-record";
import { redactIdentity } from "@/lib/ai/redact";
import {
  CANDIDATE_FIT_PROMPT_VERSION,
  analyzeCandidateFit,
} from "@/lib/ai/candidate-analysis";
import type { ReportPayload } from "@/lib/report/generate";

export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("VIEW_REPORTS");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);

  const [analysis, documents] = await Promise.all([
    prisma.aiAnalysis.findFirst({
      where: { attemptId, kind: "CANDIDATE_FIT", status: "READY" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.candidateDocument.findMany({
      where: { attemptId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        createdAt: true,
        textSource: true,
        extractedText: true,
      },
    }),
  ]);

  return apiOk({
    configured: isAiConfigured(),
    analysis: analysis
      ? {
          id: analysis.id,
          output: analysis.output,
          model: analysis.model,
          promptVersion: analysis.promptVersion,
          createdAt: analysis.createdAt.toISOString(),
        }
      : null,
    documents: documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      createdAt: d.createdAt.toISOString(),
      textSource: d.textSource,
      characters: d.extractedText?.length ?? 0,
      needsText: (d.extractedText?.length ?? 0) < 50,
    })),
  });
});

export const POST = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("VIEW_REPORTS");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);

  if (!isAiConfigured()) {
    return apiError(new AiNotConfiguredError().message, 501);
  }
  if (!rateLimit(`ai-analysis:${user.id}`, 20, 60 * 60_000)) {
    return apiError("Too many analyses requested. Please wait a few minutes.", 429);
  }

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      candidate: true,
      jobOpening: { include: { jobProfile: true } },
      reports: { where: { status: "READY" }, orderBy: { version: "desc" }, take: 1 },
      documents: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!attempt) return apiError("Attempt not found.", 404);
  const report = attempt.reports[0];
  if (!report?.payload) {
    return apiError(
      "This candidate has no completed assessment report yet. The analysis needs results to work from.",
      409,
    );
  }

  // Strip direct identifiers before the model sees the résumé: LLMs show
  // measurable name-based preference in screening tasks, and a reviewer
  // reading a biased summary tends to inherit the bias rather than catch it.
  const resume = attempt.documents[0];
  const rawResume =
    resume?.extractedText && resume.extractedText.length >= 50
      ? resume.extractedText
      : null;
  const redaction = rawResume
    ? redactIdentity(rawResume, [
        attempt.candidate.firstName,
        attempt.candidate.lastName,
      ])
    : null;
  const resumeText = redaction?.text ?? null;

  const {
    output: analysis,
    inputTokens,
    outputTokens,
    record: saved,
  } = await recordAnalysis({
    create: {
      kind: "CANDIDATE_FIT",
      attemptId,
      documentId: resume?.id ?? null,
      model: AI_MODEL,
      promptVersion: CANDIDATE_FIT_PROMPT_VERSION,
      requestedById: user.id,
    },
    run: async () => {
      const result = await analyzeCandidateFit({
        report: report.payload as unknown as ReportPayload,
        jobTitle: attempt.jobOpening.title,
        jobProfileName: attempt.jobOpening.jobProfile.name,
        jobDescription: attempt.jobOpening.jobProfile.jobDescription,
        resumeText,
      });
      return { ...result, output: result.analysis };
    },
  });

  const meta = await requestMeta();
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.AI_CANDIDATE_ANALYSIS,
    entityType: "AiAnalysis",
    entityId: saved.id,
    newValue: {
      attemptId,
      model: AI_MODEL,
      promptVersion: CANDIDATE_FIT_PROMPT_VERSION,
      usedResume: Boolean(resumeText),
      redactedIdentifiers: redaction?.redactedCounts ?? null,
      inputTokens,
      outputTokens,
    },
    ip: meta.ip,
  });

  return apiOk({
    analysis: {
      id: saved.id,
      output: analysis,
      model: saved.model,
      promptVersion: saved.promptVersion,
      createdAt: saved.createdAt.toISOString(),
    },
    usedResume: Boolean(resumeText),
  });
});
