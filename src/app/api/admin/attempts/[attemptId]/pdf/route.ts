import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { assertAttemptAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { renderReportPdf } from "@/lib/report/pdf";
import { getStorage, reportPdfKey } from "@/lib/storage";
import type { ReportPayload } from "@/lib/report/generate";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("VIEW_REPORTS");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);

  const report = await prisma.report.findFirst({
    where: { attemptId, status: "READY" },
    orderBy: { version: "desc" },
  });
  if (!report?.payload) return apiError("No report is ready for this attempt.", 404);
  const payload = report.payload as unknown as ReportPayload;

  const storage = getStorage();
  const key = reportPdfKey(attemptId, report.id);
  let pdf = report.pdfObjectKey ? await storage.getObject(key) : null;
  if (!pdf) {
    pdf = await renderReportPdf({
      reportId: report.id,
      candidateName: payload.meta.candidateName,
      position: payload.meta.position,
      completedAt: payload.meta.completedAt,
    });
    await storage.putObject(key, pdf, "application/pdf");
    await prisma.report.update({
      where: { id: report.id },
      data: { pdfObjectKey: key },
    });
  }

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.REPORT_PDF_DOWNLOADED,
    entityType: "Report",
    entityId: report.id,
  });

  const filename = `FSW-WorkFit-${payload.meta.candidateName.replaceAll(/[^a-zA-Z0-9]+/g, "-")}-v${report.version}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
