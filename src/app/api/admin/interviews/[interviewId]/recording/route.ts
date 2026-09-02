/**
 * Interview recording: consent, media, transcript, evidence.
 *
 * Every branch here runs through the consent gate in the service layer.
 * There is no override parameter and no admin bypass, because the whole
 * feature is only lawful while there isn't one.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requirePermission, requestMeta } from "@/lib/auth/session";
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

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("MANAGE_INTERVIEWS");
  const { interviewId } = await ctx.params;

  const [{ expected, consents, gate }, recording] = await Promise.all([
    consentState(interviewId),
    prisma.interviewRecording.findUnique({
      where: { interviewId },
      include: {
        segments: { orderBy: { orderIndex: "asc" }, take: 500 },
        evidence: { orderBy: { startMs: "asc" } },
      },
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
          segmentCount: recording.segments.length,
          hasTimestamps: recording.segments.some((s) => s.startMs >= 0),
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
