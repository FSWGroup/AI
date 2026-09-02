/**
 * The candidate's work-sample endpoint.
 *
 * Authenticated by the single-use token in the link — the candidate has no
 * account. Three actions: start (which sets the server clock), save (autosave,
 * which never touches the clock), and submit.
 */

import { z } from "zod";
import { apiError, apiOk, rateLimit, withErrorHandling } from "@/lib/api";
import { requestMeta } from "@/lib/auth/session";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/extract";
import {
  canStart,
  canSubmit,
  remainingSeconds,
} from "@/lib/worksample/rubric";
import {
  loadAssignmentByToken,
  saveDraft,
  startAssignment,
  submitAssignment,
} from "@/lib/worksample/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const actionSchema = z.object({
  action: z.enum(["start", "save"]),
  text: z.string().max(200_000).optional(),
});

export const GET = withErrorHandling(async (_req, ctx) => {
  const { token } = await ctx.params;
  const assignment = await loadAssignmentByToken(token);
  if (!assignment) return apiError("That link is not valid.", 404);

  const gate = canStart(assignment);
  return apiOk({
    reference: assignment.reference,
    status: assignment.status,
    title: assignment.workSample.title,
    summary: assignment.workSample.summary,
    // Instructions are withheld until the clock is running. Handing them out
    // beforehand turns a timed task into an untimed one for anyone who reads
    // the page and comes back later.
    instructions: assignment.startedAt ? assignment.workSample.instructions : null,
    successCriteria: assignment.workSample.successCriteria,
    submissionKind: assignment.workSample.submissionKind,
    allowedFileTypes: assignment.workSample.allowedFileTypes,
    timeLimitMinutes: assignment.workSample.timeLimitMinutes,
    dueAt: assignment.dueAt,
    startedAt: assignment.startedAt,
    remainingSeconds: remainingSeconds(assignment),
    draftText: assignment.draftText,
    canStart: gate.ok,
    blockedReason: gate.ok ? null : gate.reason,
    firstName: assignment.application.candidate.firstName,
    roleTitle: assignment.application.requisition.title,
  });
});

export const POST = withErrorHandling(async (req, ctx) => {
  const { token } = await ctx.params;
  const meta = await requestMeta();
  if (!rateLimit(`work-sample:${meta.ip}`, 120, 60_000)) {
    return apiError("Too many requests. Please wait a moment.", 429);
  }

  const assignment = await loadAssignmentByToken(token);
  if (!assignment) return apiError("That link is not valid.", 404);

  const contentType = req.headers.get("content-type") ?? "";

  // ---- Submission: multipart, because it may carry a file -------------------
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const text = (form.get("text") as string | null) ?? null;
    const file = form.get("file");

    let filePayload: { name: string; mimeType: string; bytes: Buffer } | null = null;
    if (file && typeof file !== "string") {
      if (file.size > MAX_DOCUMENT_BYTES) {
        return apiError(
          `That file is larger than ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.`,
          413,
        );
      }
      filePayload = {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: Buffer.from(await file.arrayBuffer()),
      };
    }

    const result = await submitAssignment({
      assignmentId: assignment.id,
      text,
      file: filePayload,
    });
    if (!result.ok) return apiError(result.errors.join(" "), 422);
    return apiOk({ status: "SUBMITTED" });
  }

  // ---- Start and autosave ----------------------------------------------------
  const body = actionSchema.parse(await req.json().catch(() => null));

  if (body.action === "start") {
    const started = await startAssignment(assignment.id);
    if (!started.ok) return apiError(started.reason, 409);
    return apiOk({
      status: "STARTED",
      instructions: assignment.workSample.instructions,
      expiresAt: started.expiresAt,
      remainingSeconds: remainingSeconds({
        startedAt: new Date(),
        expiresAt: started.expiresAt,
      }),
    });
  }

  const gate = canSubmit(assignment);
  if (!gate.ok) return apiError(gate.reason, 409);
  await saveDraft(assignment.id, body.text ?? "");
  return apiOk({ saved: true, remainingSeconds: remainingSeconds(assignment) });
});
