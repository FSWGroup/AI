/**
 * Complete assessment export: one PDF containing everything the portal shows
 * about an attempt, built for sending to a colleague.
 *
 * Rendered with pdf-lib rather than headless Chromium so it works on every
 * host the platform deploys to, including serverless functions with no
 * browser binary.
 *
 * Because the file leaves the system the moment it is downloaded, the export
 * is audited with the recipient's own identity on the cover page. The webcam
 * recording is never included: access to recordings is separately gated and
 * a PDF cannot carry that gate with it.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { assertAttemptAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { summarizeIntegrity, INTEGRITY_LABELS } from "@/lib/scoring/integrity";
import { buildFullReportPdf } from "@/lib/report/full-report-pdf";
import type { ReportPayload } from "@/lib/report/generate";
import type { CandidateFitAnalysis } from "@/lib/ai/candidate-analysis";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Filesystem-safe, recognisable in a downloads folder or an email. */
function fileName(candidateName: string, recordId: string): string {
  const slug = candidateName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `FSW-Talent Scout-${slug || "Assessment"}-${recordId}.pdf`;
}

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("VIEW_REPORTS");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      candidate: { select: { email: true, phone: true } },
      invitation: { select: { createdAt: true } },
      sections: { orderBy: { orderIndex: "asc" } },
      accommodations: true,
      consents: true,
      integrityEvents: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!attempt) return apiError("Candidate not found.", 404);

  const report = await prisma.report.findFirst({
    where: { attemptId, status: "READY" },
    orderBy: { version: "desc" },
  });
  if (!report?.payload) {
    return apiError(
      "The report is not ready yet. The export becomes available once the assessment is completed and scored.",
      409,
    );
  }

  const counts = new Map<string, number>();
  for (const e of attempt.integrityEvents) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const integrity = summarizeIntegrity(
    [...counts.entries()].map(([type, count]) => ({ type, count })),
  );

  // The most recent successful interview brief, if one was ever generated.
  const analysis = await prisma.aiAnalysis.findFirst({
    where: { attemptId, kind: "CANDIDATE_FIT", status: "READY" },
    orderBy: { createdAt: "desc" },
    include: { document: { select: { id: true } } },
  });

  const payload = report.payload as unknown as ReportPayload;
  const pdf = await buildFullReportPdf({
    payload,
    candidate: attempt.candidate,
    invitedAt: attempt.invitation?.createdAt.toISOString() ?? null,
    startedAt: attempt.startedAt?.toISOString() ?? null,
    sections: attempt.sections.map((s) => ({
      sectionKey: s.sectionKey,
      status: s.status,
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      timed: s.timed,
      durationSeconds: s.durationSeconds,
    })),
    accommodations: attempt.accommodations.map((a) => ({
      type: a.type,
      timeMultiplier: a.timeMultiplier,
      note: a.note,
    })),
    consents: attempt.consents.map((c) => ({
      consentType: c.consentType,
      noticeVersion: c.noticeVersion,
      consentedAt: c.consentedAt.toISOString(),
    })),
    integrityEvents: attempt.integrityEvents.map((e) => ({
      type: e.type,
      occurredAt: e.occurredAt.toISOString(),
      meta: e.meta,
    })),
    integrityLevel: integrity.level,
    integrityLabel: INTEGRITY_LABELS[integrity.level],
    aiBrief:
      analysis?.output != null
        ? {
            analysis: analysis.output as unknown as CandidateFitAnalysis,
            model: analysis.model,
            generatedAt: analysis.completedAt?.toISOString() ?? null,
            hadResume: analysis.documentId != null,
          }
        : null,
    exportedBy: user.name || user.email,
    exportedAt: new Date(),
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.REPORT_EXPORTED,
    entityType: "Report",
    entityId: report.id,
    newValue: {
      format: "pdf",
      includedAiBrief: analysis?.output != null,
      integrityEventCount: attempt.integrityEvents.length,
    },
  });

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName(
        payload.meta.candidateName,
        payload.meta.recordId,
      )}"`,
      "Content-Length": String(pdf.byteLength),
      // Personal data: never let a shared cache hold on to it.
      "Cache-Control": "private, no-store",
    },
  });
});
