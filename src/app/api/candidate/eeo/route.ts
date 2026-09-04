/**
 * Voluntary EEO self-identification.
 *
 * Collected AFTER the assessment is submitted and scored, so it cannot
 * influence any result, and only when the organization has switched the
 * compliance module on. Every question may be declined.
 *
 * The record is stored in a table with no foreign key to the candidate or
 * attempt — only opaque reference strings — so no ordinary candidate,
 * report, or hiring query can join to it. It is read solely by the
 * aggregate adverse-impact analysis, which never returns individual rows.
 */

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";

/** Categories mirror standard EEO-1 style reporting; all optional. */
const schema = z.object({
  sex: z.enum(["MALE", "FEMALE", "NON_BINARY", "DECLINE"]).optional(),
  raceEthnicity: z
    .enum([
      "HISPANIC_LATINO",
      "WHITE",
      "BLACK_AFRICAN_AMERICAN",
      "ASIAN",
      "NATIVE_HAWAIIAN_PACIFIC_ISLANDER",
      "AMERICAN_INDIAN_ALASKA_NATIVE",
      "TWO_OR_MORE",
      "DECLINE",
    ])
    .optional(),
  veteranStatus: z.enum(["VETERAN", "NOT_VETERAN", "DECLINE"]).optional(),
  disabilityStatus: z.enum(["YES", "NO", "DECLINE"]).optional(),
});

export const POST = withErrorHandling(async (req) => {
  const attempt = await requireAttempt();
  if (attempt.status !== "COMPLETED") {
    return apiError(
      "Self-identification is only collected after the assessment is submitted.",
      409,
    );
  }

  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  if (!settings?.eeoModuleEnabled) {
    return apiError("This organization does not collect this information.", 404);
  }

  const body = await parseBody(req, schema);
  const opening = await prisma.jobOpening.findUnique({
    where: { id: attempt.jobOpeningId },
    select: { id: true, jobProfileId: true },
  });

  await prisma.eeoRecord.upsert({
    where: { attemptRef: attempt.id },
    create: {
      candidateRef: attempt.candidateId,
      attemptRef: attempt.id,
      jobOpeningId: opening?.id,
      jobProfileRef: opening?.jobProfileId,
      data: body as unknown as Prisma.InputJsonValue,
    },
    update: { data: body as unknown as Prisma.InputJsonValue },
  });

  // Deliberately not audited against the candidate: an audit row naming who
  // self-identified would defeat the separation this table exists to create.
  return apiOk({ recorded: true });
});
