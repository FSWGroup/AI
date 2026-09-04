/**
 * Records progress through the pre-assessment entry flow:
 * identification confirmation, rules acknowledgment, recording consent,
 * camera preflight, recovery acknowledgment.
 *
 * Consent records store the notice version, timestamp, and request metadata.
 * The consent checkbox is never pre-checked client-side, and this endpoint
 * requires the explicit `consented: true` flag for consent steps.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";
import { requestMeta } from "@/lib/auth/session";
import { getCandidateState } from "@/lib/attempt/state";

const schema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("identify"),
    phone: z.string().max(30).optional(),
    confirmed: z.literal(true),
  }),
  z.object({
    step: z.literal("rules"),
    acknowledgments: z.array(z.string()).min(7),
    consented: z.literal(true),
  }),
  z.object({ step: z.literal("accommodation_ack") }),
  z.object({
    step: z.literal("recording_consent"),
    consented: z.literal(true),
    noticeVersion: z.string().min(1).max(20),
  }),
  z.object({ step: z.literal("camera_ready") }),
  z.object({ step: z.literal("recovery_ack") }),
]);

const STEP_AFTER: Record<string, string> = {
  identify: "rules",
  rules: "accommodation",
  accommodation_ack: "recording_consent",
  recording_consent: "camera_test",
  camera_ready: "recovery",
  recovery_ack: "instructions",
};

export const POST = withErrorHandling(async (req) => {
  const attempt = await requireAttempt();
  if (attempt.status !== "NOT_STARTED") {
    return apiError("The assessment has already started.", 409);
  }
  const body = await parseBody(req, schema);
  const meta = await requestMeta();
  const ip = meta.ip ?? null;
  const userAgent = meta.userAgent?.slice(0, 300) ?? null;

  if (body.step === "identify") {
    await prisma.candidate.update({
      where: { id: attempt.candidateId },
      data: { phone: body.phone || undefined },
    });
  }

  if (body.step === "rules") {
    await prisma.consentRecord.create({
      data: {
        attemptId: attempt.id,
        consentType: "rules",
        noticeVersion: "1.0",
        consentText: body.acknowledgments.join("\n"),
        ip,
        userAgent,
      },
    });
  }

  if (body.step === "recording_consent") {
    if (attempt.cameraExempt) {
      // Camera-exempt attempts skip recording consent (accommodation).
      return apiError("This attempt has a camera exemption on file.", 409);
    }
    const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
    await prisma.consentRecord.create({
      data: {
        attemptId: attempt.id,
        consentType: "recording",
        noticeVersion: body.noticeVersion || settings?.privacyNoticeVersion || "1.0",
        consentText:
          "I have read the recording notice and consent to webcam video recording for the duration of this assessment.",
        ip,
        userAgent,
      },
    });
  }

  const next = STEP_AFTER[body.step];
  if (next) {
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { entryStep: next },
    });
  }
  const state = await getCandidateState(attempt);
  return apiOk({ state });
});
