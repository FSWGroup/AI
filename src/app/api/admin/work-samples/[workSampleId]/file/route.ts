/**
 * Download a candidate's submitted file.
 *
 * Streamed through the app rather than handed out as a storage URL, so access
 * is checked on every request and every download is audited. The filename is
 * the reference, not the candidate's name — a grader who saves the file to
 * their desktop should not learn who they graded from the filename.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("GRADE_WORK_SAMPLES");
  const { workSampleId } = await ctx.params;
  const assignmentId = new URL(req.url).searchParams.get("assignmentId");
  if (!assignmentId) return apiError("Which submission?", 400);

  const assignment = await prisma.workSampleAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment || assignment.workSampleId !== workSampleId || !assignment.objectKey) {
    return apiError("That file does not exist.", 404);
  }

  const bytes = await getStorage().getObject(assignment.objectKey);
  if (!bytes) return apiError("That file is no longer stored.", 410);

  await audit({
    userId: user.id,
    action: "work_sample.file_downloaded",
    entityType: "WorkSampleAssignment",
    entityId: assignment.id,
    newValue: { reference: assignment.reference },
  });

  const ext = assignment.fileName?.includes(".")
    ? assignment.fileName.slice(assignment.fileName.lastIndexOf("."))
    : "";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": assignment.fileMimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${assignment.reference}${ext}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
});
