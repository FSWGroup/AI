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
import { assertApplicationAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
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
  // GRADE_WORK_SAMPLES says you grade work samples. It does not say whose,
  // and the assignment ids are listed on the grading queue — so on its own it
  // handed every submitted file in the company to anyone holding it. The job
  // scope is what answers "whose".
  await assertApplicationAccess(user, assignment.applicationId);

  const bytes = await getStorage().getObject(assignment.objectKey);
  if (!bytes) return apiError("That file is no longer stored.", 410);

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.WORK_SAMPLE_FILE_DOWNLOADED,
    entityType: "WorkSampleAssignment",
    entityId: assignment.id,
    newValue: { reference: assignment.reference },
  });

  // Both of these are candidate-supplied and both land in a response header.
  // A filename of `a.h"tml` closed the quoted filename early and appended
  // whatever followed as further header parameters; a declared type of
  // `text/html` came back verbatim. Neither is repaired — anything that is
  // not a plain short extension, or not a type this task actually accepts, is
  // simply not echoed.
  const rawExt = assignment.fileName?.includes(".")
    ? assignment.fileName.slice(assignment.fileName.lastIndexOf("."))
    : "";
  const ext = /^\.[A-Za-z0-9]{1,8}$/.test(rawExt) ? rawExt.toLowerCase() : "";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      // Always a download, never something the browser renders in place.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${assignment.reference}${ext}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
});
