/** The technical report for a study, as a PDF. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { computeStudyResult } from "@/lib/validation/service";
import { buildTechnicalReport } from "@/lib/validation/technical-report";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("VIEW_VALIDATION");
  const { studyId } = await ctx.params;

  const [study, settings] = await Promise.all([
    prisma.validationStudy.findUnique({
      where: { id: studyId },
      include: { jobProfile: { select: { name: true } } },
    }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  if (!study) return apiError("That study does not exist.", 404);

  // Freshly computed, not read from the stored coefficients: a technical
  // report quoting numbers older than its own date is the kind of document
  // that gets a study thrown out. Computed and NOT persisted, though — this
  // is a GET behind a read-only permission, and calling the persisting
  // version rewrote every stored coefficient and restamped the study's author
  // as whoever last downloaded a PDF. With a lax session cookie, a link was
  // enough to make someone else's browser do it.
  const result = await computeStudyResult(studyId);

  const pdf = await buildTechnicalReport({
    study: {
      name: study.name,
      description: study.description,
      criterionKind: study.criterionKind,
      criterionKeys: study.criterionKeys,
      retentionDays: study.retentionDays,
      cycleKinds: study.cycleKinds,
      jobProfileName: study.jobProfile?.name ?? null,
      hiredFrom: study.hiredFrom,
      hiredTo: study.hiredTo,
      correctRangeRestriction: study.correctRangeRestriction,
      correctAttenuation: study.correctAttenuation,
    },
    result,
    organizationName: settings?.companyName ?? "FSW Group",
    preparedBy: user.name,
  });

  await audit({
    userId: user.id,
    action: "validation_study.report_downloaded",
    entityType: "ValidationStudy",
    entityId: studyId,
  });

  const safeName = study.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}-technical-report.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
});
