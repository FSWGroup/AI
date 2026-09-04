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
 * Two different gates, because two different things are being asked for.
 *
 * ACCESS is about reading or handling the recording: the audio, the
 * transcript, the extracted quotes, destroying any of it. That is read from
 * OrgSettings.recordingAccessRoles exactly as it is for assessment
 * recordings, because a room the candidate agreed to record for a hiring
 * decision is not a room every interviewer in the company may replay. The job
 * scope answers "whose interview?" — without it a hiring manager holds
 * MANAGE_INTERVIEWS over every requisition in the business.
 *
 * PARTICIPATION is answering for yourself about being recorded, and it must
 * never be gated on media access. A hiring manager is not in the default
 * recordingAccessRoles and is very often on the panel; putting their own
 * consent behind that permission made the all-party gate unsatisfiable for
 * every interview they sit on — nobody could grant, so nothing could ever be
 * recorded — and, worse, stopped anyone who had already agreed from
 * withdrawing, against a statement that promises they can withdraw at any
 * point.
 *
 * A mistyped id is a 404 from either gate, never a 500.
 */
async function requireInterviewExists(interviewId: string) {
  const found = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true },
  });
  return found ? null : apiError("That interview does not exist.", 404);
}

/** Answering for yourself. Scope only — no media-access requirement. */
async function guardParticipation(user: User, interviewId: string) {
  const missing = await requireInterviewExists(interviewId);
  if (missing) return missing;
  await assertInterviewAccess(user, interviewId);
  return null;
}

/** Reading or handling the recording itself. */
async function guardRecordingAccess(user: User, interviewId: string) {
  const [missing, settings] = await Promise.all([
    requireInterviewExists(interviewId),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  if (missing) return missing;
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
  // A participant needs to see the consent state to answer at all, so this
  // read is behind the participation gate; the recording's own contents are
  // withheld separately below.
  const denied = await guardParticipation(user, interviewId);
  if (denied) return denied;
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  const mayAccessRecording = canAccessRecordings(
    user.role,
    settings?.recordingAccessRoles ?? ["SUPER_ADMIN", "HR_ADMIN"],
  );

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
    // A panelist who is not cleared for recordings still needs to know
    // whether this one is running — they must not describe an interview as
    // recorded when it is not — and nothing beyond that. The verbatim quotes
    // in particular are the transcript in another form.
    mayAccessRecording,
    recording:
      recording && mayAccessRecording
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
        : recording
          ? { status: recording.status, evidence: [] }
          : null,
    aiConfigured: isAiConfigured(),
  });
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_INTERVIEWS");
  const { interviewId } = await ctx.params;
  const denied = await guardParticipation(user, interviewId);
  if (denied) return denied;
  const contentType = req.headers.get("content-type") ?? "";

  // ---- Audio upload ---------------------------------------------------------
  if (contentType.includes("multipart/form-data")) {
    const blocked = await guardRecordingAccess(user, interviewId);
    if (blocked) return blocked;
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
      const blocked = await guardRecordingAccess(user, interviewId);
      if (blocked) return blocked;
      const out = await storeTranscript({
        interviewId,
        raw: body.text,
        actorId: user.id,
      });
      if (!out.ok) return apiError(out.reason, 422);
      return apiOk(out);
    }
    case "analyze": {
      const blocked = await guardRecordingAccess(user, interviewId);
      if (blocked) return blocked;
      if (!isAiConfigured()) {
        return apiError("AI analysis is not configured on this instance.", 503);
      }
      const out = await runEvidenceExtraction({ interviewId, actorId: user.id });
      if ("error" in out) return apiError(out.error, 409);
      return apiOk(out);
    }
    case "destroy": {
      const blocked = await guardRecordingAccess(user, interviewId);
      if (blocked) return blocked;
      await destroyRecording(interviewId, `deleted by ${user.name}`);
      return apiOk({ ok: true });
    }
  }
});
