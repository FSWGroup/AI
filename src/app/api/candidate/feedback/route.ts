/**
 * Candidate-facing feedback report.
 *
 * Authenticated by the candidate's own attempt cookie — never by record ID
 * or any other guessable value — and returned only once the attempt is
 * submitted and its report is READY.
 *
 * The response is built by buildCandidateFeedback(), which strips benchmark
 * comparisons, validity indicators, integrity data, and raw bands. The full
 * report payload is never sent to the candidate's browser.
 */

import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";
import { buildCandidateFeedback } from "@/lib/report/candidate-feedback";
import type { ReportPayload } from "@/lib/report/generate";

export const GET = withErrorHandling(async () => {
  const attempt = await requireAttempt();
  if (attempt.status !== "COMPLETED") {
    return apiError("Your summary is available once you submit.", 409);
  }

  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  if (!settings?.candidateFeedbackEnabled) {
    return apiError("Candidate summaries are not enabled.", 404);
  }

  const [report, candidate, templates] = await Promise.all([
    prisma.report.findFirst({
      where: { attemptId: attempt.id, status: "READY" },
      orderBy: { version: "desc" },
    }),
    prisma.candidate.findUniqueOrThrow({
      where: { id: attempt.candidateId },
      select: { firstName: true },
    }),
    prisma.developmentTemplate.findMany({ where: { active: true } }),
  ]);

  if (!report?.payload) {
    return apiError("Your summary is still being prepared. Check back shortly.", 202);
  }

  const developmentTemplates = new Map<string, string[]>(
    templates.map((t) => [
      t.construct as string,
      ((t.recommendations as unknown as string[]) ?? []).filter(
        (r) => typeof r === "string",
      ),
    ]),
  );

  const feedback = buildCandidateFeedback(
    report.payload as unknown as ReportPayload,
    candidate.firstName,
    developmentTemplates,
  );

  return apiOk({ feedback });
});
