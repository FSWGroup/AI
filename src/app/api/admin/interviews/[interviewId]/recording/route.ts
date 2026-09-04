/**
 * Interview recording: consent, media, transcript, evidence.
 *
 * Every branch here runs through the consent gate in the service layer.
 * There is no override parameter and no admin bypass, because the whole
 * feature is only lawful while there isn't one.
 */

import type { User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requirePermission, requestMeta } from "@/lib/auth/session";
import { canAccessRecordings } from "@/lib/auth/rbac";
import { assertInterviewAccess } from "@/lib/auth/scope";
import { env } from "@/lib/env";
import { isAiConfigured } from "@/lib/ai/client";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/extract";
import { CONSENT_LABEL } from "@/lib/interview-intel/consent";
import {
  consentState,
  destroyRecording,
  recordDecision,
  requestConsent,
  runEvidenceExtraction,
  storeAudio,
  storeTranscript,
} from "@/lib/interview-intel/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const jsonSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request_consent") }),
  z.object({ action: z.literal("my_consent"), decision: z.enum(["GRANTED", "DECLINED", "WITHDRAWN"]) }),
  z.object({ action: z.literal("transcript"), text: z.string().min(1).max(2_000_000) }),
  z.object({ action: z.literal("analyze") }),
  z.object({ action: z.literal("destroy") }),
]);

/**
 * The gate both handlers open with.
 *
 * MANAGE_INTERVIEWS says you run interviews; it does not say you may listen
 * to one. Recording access is read from OrgSettings.recordingAccessRoles
 * exactly as it is for assessment recordings, because a room the candidate
 * agreed to record for a hiring decision is not a room every interviewer in
 * the company may replay. And the job scope answers "whose interview?" —
 * without it a hiring manager holds MANAGE_INTERVIEWS over every requisition
 * in the business, including the verbatim quotes pulled from the transcript.
 *
 * A mistyped id is a 404, never a 500.
 */
async function guardInterview(user: User, interviewId: string) {
  const [found, settings] = await Promise.all([
    prisma.interview.findUnique({ where: { id: interviewId }, select: { id: true } }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  if (!found) return apiError("That interview does not exist.", 404);
  if (
    !canAccessRecordings(
      user.role,
      settings?.recordingAccessRoles ?? ["SUPER_ADMIN", "HR_ADMIN"],
    )
  ) {
    return apiError("You do not have permission to access interview recordings.", 403);
  }
  await assertInterviewAccess(user, interviewId);
  return null;
}

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("MANAGE_INTERVIEWS");
  const { interviewId } = await ctx.params;
  const denied = await guardInterview(user, interviewId);
  if (denied) return denied;

  // Count the transcript rather than loading it. This response reports a
  // number and a boolean about the segments and shows none of them, and the
  // `take: 500` that used to bound the load also silently capped the number:
  // a 60-minute interview runs to well over a thousand lines, every one of
  // which reported as exactly 500.
  const [{ expected, consents, gate }, recording, segmentCount, timestamped] =
    await Promise.all([
      consentState(interviewId),
      prisma.interviewRecording.findUnique({
        where: { interviewId },
        include: { evidence: { orderBy: { startMs: "asc" }, take: 200 } },
      }),
      prisma.transcriptSegment.count({ where: { recording: { interviewId } } }),
      prisma.transcriptSegment.count({
        where: { recording: { interviewId }, startMs: { gte: 0 } },
      }),
    ]);

  return apiOk({
    canRecord: gate.ok,
    reason: gate.ok ? null : gate.reason,
    parties: expected.map((p) => {
      const row = consents.find(
        (c) => c.party === p.party && c.userId === p.userId,
      );
      return {
        party: p.party,
        userId: p.userId,
        status: row?.status ?? "PENDING",
        label: CONSENT_LABEL[row?.status ?? "PENDING"],
        isMe: p.userId === user.id,
      };
    }),
    recording: recording
      ? {
          status: recording.status,
          fileName: recording.fileName,
          durationSeconds: recording.durationSeconds,
          transcriptSource: recording.transcriptSource,
          segmentCount,
          hasTimestamps: timestamped > 0,
          evidence: recording.evidence.map((e) => ({
            id: e.id,
            competencyName: e.competencyName,
            quote: e.quote,
            startMs: e.startMs,
            relevance: e.relevance,
            dismissedAt: e.dismissedAt,
          })),
        }
      : null,
    aiConfigured: isAiConfigured(),
  });
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_INTERVIEWS");
  const { interviewId } = await ctx.params;
  const denied = await guardInterview(user, interviewId);
  if (denied) return denied;
  const contentType = req.headers.get("content-type") ?? "";

  // ---- Audio upload ---------------------------------------------------------
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return apiError("No file was sent.", 400);
    if (file.size > MAX_DOCUMENT_BYTES * 10) {
      return apiError("That file is too large.", 413);
    }
    if (!/^audio\//.test(file.type)) {
      return apiError(
        "Audio only. Video is not accepted here — it adds nothing this platform is willing to analyze and multiplies what a breach would expose.",
        415,
      );
    }
    const result = await storeAudio({
      interviewId,
      fileName: file.name,
      mimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      actorId: user.id,
    });
    if (!result.ok) return apiError(result.reason, 409);
    return apiOk({ ok: true });
  }

  const body = jsonSchema.parse(await req.json().catch(() => null));
  const meta = await requestMeta();

  switch (body.action) {
    case "request_consent": {
      const out = await requestConsent({
        interviewId,
        actorId: user.id,
        baseUrl: env.appBaseUrl,
      });
      if (!out.sent) return apiError(out.reason, 409);
      return apiOk(out, { status: 201 });
    }
    case "my_consent": {
      await recordDecision({
        interviewId,
        party: "INTERVIEWER",
        userId: user.id,
        status: body.decision,
        ip: meta.ip,
        userAgent: req.headers.get("user-agent"),
      });
      return apiOk({ ok: true });
    }
    case "transcript": {
      const out = await storeTranscript({
        interviewId,
        raw: body.text,
        actorId: user.id,
      });
      if (!out.ok) return apiError(out.reason, 422);
      return apiOk(out);
    }
    case "analyze": {
      if (!isAiConfigured()) {
        return apiError("AI analysis is not configured on this instance.", 503);
      }
      const out = await runEvidenceExtraction({ interviewId, actorId: user.id });
      if ("error" in out) return apiError(out.error, 409);
      return apiOk(out);
    }
    case "destroy": {
      await destroyRecording(interviewId, `deleted by ${user.name}`);
      return apiOk({ ok: true });
    }
  }
});
