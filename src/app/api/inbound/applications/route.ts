/**
 * Inbound application API for job boards and partners.
 *
 * A board that can POST applications (Indeed Apply among them) sends them
 * here with a per-channel bearer token. One endpoint, one token per source,
 * so a compromised board credential can be revoked without touching the rest
 * and every application carries provable attribution.
 *
 * This is the legitimate route into an ATS. The alternative — scraping board
 * sites for candidate data — breaks their terms of service and produces data
 * nobody consented to share with us.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, rateLimit, withErrorHandling } from "@/lib/api";
import { hashToken } from "@/lib/crypto";
import { createApplication } from "@/lib/ats/service";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const schema = z.object({
  /** Our requisition reference, which we publish in the feed. */
  jobReference: z.string().min(1).max(60),
  applicant: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(200),
    phone: z.string().max(40).nullable().optional(),
  }),
  answers: z
    .array(
      z.object({
        questionId: z.string().optional(),
        prompt: z.string().max(500).optional(),
        answer: z.string().max(5000),
      }),
    )
    .max(50)
    .default([]),
  /** Plain-text résumé, when the board sends one. */
  resumeText: z.string().max(200_000).nullable().optional(),
  resumeFileName: z.string().max(200).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const POST = withErrorHandling(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return apiError("Missing bearer token.", 401);

  const channel = await prisma.sourceChannel.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!channel || !channel.active) return apiError("Unknown or inactive token.", 401);

  if (!rateLimit(`inbound:${channel.id}`, 300, 60_000)) {
    return apiError("Rate limit exceeded for this channel.", 429);
  }

  const raw = (await req.json().catch(() => null)) as unknown;
  // Always record the payload, even when it fails validation — a board's
  // format change should be diagnosable, and the applicant recoverable.
  const inbound = await prisma.inboundApplication.create({
    data: {
      channelId: channel.id,
      transport: "API",
      payload: (raw ?? {}) as Prisma.InputJsonValue,
    },
  });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    await prisma.inboundApplication.update({
      where: { id: inbound.id },
      data: {
        status: "FAILED",
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 500),
      },
    });
    return apiError("The payload did not match the expected shape.", 422);
  }
  const body = parsed.data;

  const requisition = await prisma.requisition.findFirst({
    where: { reference: body.jobReference, status: "OPEN" },
    select: { id: true },
  });
  if (!requisition) {
    await prisma.inboundApplication.update({
      where: { id: inbound.id },
      data: { status: "IGNORED", error: "No open requisition with that reference." },
    });
    return apiError("No open role with that reference.", 404);
  }

  // Boards send free-text answers keyed by prompt rather than by our question
  // ids, so match on the prompt where an id is absent.
  const questions = await prisma.screeningQuestion.findMany({
    where: { requisitionId: requisition.id },
  });
  const answers = body.answers.flatMap((a) => {
    const question =
      questions.find((q) => q.id === a.questionId) ??
      questions.find(
        (q) => a.prompt && q.prompt.toLowerCase() === a.prompt.toLowerCase(),
      );
    if (!question) return [];
    const numeric = Number(a.answer);
    return [
      {
        questionId: question.id,
        text: a.answer,
        number: Number.isFinite(numeric) ? numeric : null,
        list: [] as string[],
      },
    ];
  });

  const result = await createApplication({
    requisitionId: requisition.id,
    candidate: body.applicant,
    answers,
    channelKeyOverride: channel.key,
    inboundId: inbound.id,
  });

  if (body.resumeText && body.resumeText.trim().length > 0) {
    await prisma.candidateDocument.create({
      data: {
        candidateId: result.candidateId,
        applicationId: result.applicationId,
        kind: "RESUME",
        fileName: body.resumeFileName ?? `resume-from-${channel.key}.txt`,
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(body.resumeText, "utf8"),
        extractedText: body.resumeText,
        textSource: "provided",
      },
    });
  }

  if (result.duplicateApplication) {
    await prisma.inboundApplication.update({
      where: { id: inbound.id },
      data: { status: "DUPLICATE", processedAt: new Date() },
    });
  }

  return apiOk({
    reference: result.reference,
    duplicate: result.duplicateApplication,
    flaggedForReview: result.knockedOut,
  });
});
