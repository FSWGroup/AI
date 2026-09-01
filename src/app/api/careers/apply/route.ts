/**
 * Public application submission.
 *
 * Unauthenticated by necessity — anyone may apply — so it is rate limited per
 * IP, size limited, and validated hard. The raw submission is stored before
 * parsing: boards and browsers send surprising things, and a real person's
 * candidacy should never be lost to a parse failure.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, rateLimit, withErrorHandling } from "@/lib/api";
import { createApplication } from "@/lib/ats/service";
import { validateAnswers, type ScreeningQuestionRule } from "@/lib/ats/screening";
import { extractText } from "@/lib/documents/extract";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_RESUME_BYTES = 8 * 1024 * 1024;

const answerSchema = z.object({
  questionId: z.string(),
  text: z.string().max(5000).nullable().optional(),
  number: z.number().nullable().optional(),
  list: z.array(z.string().max(200)).max(50).optional(),
});

const bodySchema = z.object({
  requisitionId: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional(),
  answers: z.array(answerSchema).max(50).default([]),
  attribution: z.record(z.string(), z.string().max(500)).default({}),
});

function clientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export const POST = withErrorHandling(async (req) => {
  const ip = clientIp(req);
  // Generous enough for a household behind one NAT, tight enough to stop a
  // script filling the pipeline with noise.
  if (!rateLimit(`apply:${ip}`, 10, 10 * 60_000)) {
    return apiError("Too many applications from this connection. Try again shortly.", 429);
  }

  const form = await req.formData();
  const parsed = bodySchema.safeParse({
    requisitionId: form.get("requisitionId"),
    firstName: form.get("firstName"),
    lastName: form.get("lastName"),
    email: form.get("email"),
    phone: form.get("phone") || undefined,
    answers: JSON.parse((form.get("answers") as string) || "[]"),
    attribution: JSON.parse((form.get("attribution") as string) || "{}"),
  });
  if (!parsed.success) {
    return apiError("Please check the form and try again.", 422);
  }
  const body = parsed.data;

  const requisition = await prisma.requisition.findFirst({
    where: { id: body.requisitionId, status: "OPEN" },
    select: { id: true, title: true },
  });
  if (!requisition) {
    return apiError("This role is no longer accepting applications.", 410);
  }

  // Store the raw submission first: if anything below fails, the application
  // is still recoverable rather than lost.
  const inbound = await prisma.inboundApplication.create({
    data: {
      transport: "CAREERS_SITE",
      payload: {
        ...body,
        ip,
        userAgent: req.headers.get("user-agent") ?? null,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  const questions = await prisma.screeningQuestion.findMany({
    where: { requisitionId: requisition.id },
    orderBy: { orderIndex: "asc" },
  });
  const rules: ScreeningQuestionRule[] = questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    kind: q.kind,
    required: q.required,
    choices: q.choices,
    knockout: q.knockout,
    knockoutOperator: q.knockoutOperator,
    knockoutValue: q.knockoutValue,
  }));
  const answers = body.answers.map((a) => ({
    questionId: a.questionId,
    text: a.text ?? null,
    number: a.number ?? null,
    list: a.list ?? [],
  }));
  const issues = validateAnswers(rules, answers);
  if (issues.length > 0) {
    await prisma.inboundApplication.update({
      where: { id: inbound.id },
      data: { status: "FAILED", error: "Validation failed" },
    });
    return NextResponse.json(
      { error: "Please check the highlighted questions.", issues },
      { status: 422 },
    );
  }

  const result = await createApplication({
    requisitionId: requisition.id,
    candidate: {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone ?? null,
    },
    answers,
    attribution: {
      src: body.attribution.src,
      utmSource: body.attribution.utm_source,
      utmMedium: body.attribution.utm_medium,
      utmCampaign: body.attribution.utm_campaign,
      utmContent: body.attribution.utm_content,
      referrer: body.attribution.referrer,
    },
    inboundId: inbound.id,
  });

  const resume = form.get("resume");
  if (resume instanceof File && resume.size > 0) {
    if (resume.size > MAX_RESUME_BYTES) {
      // The application still stands; only the attachment is refused.
      return apiOk({
        reference: result.reference,
        warning: "Your application was received, but the résumé was too large to attach.",
      });
    }
    const buffer = Buffer.from(await resume.arrayBuffer());
    const extracted = await extractText(buffer, resume.type, resume.name).catch(
      () => null,
    );
    await prisma.candidateDocument.create({
      data: {
        candidateId: result.candidateId,
        applicationId: result.applicationId,
        kind: "RESUME",
        fileName: resume.name.slice(0, 200),
        mimeType: resume.type || "application/octet-stream",
        sizeBytes: resume.size,
        extractedText: extracted?.ok ? extracted.text : null,
        textSource: extracted?.ok ? "extracted" : "unavailable",
      },
    });
  }

  return apiOk({ reference: result.reference });
});
