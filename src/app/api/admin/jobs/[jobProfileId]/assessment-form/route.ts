/**
 * Create a role-tailored assessment form for a job profile.
 *
 * Builds a NEW, frozen AssessmentVersion from the standard question pool
 * with per-section item counts chosen for the role, then points the profile
 * at it so its openings use it. Existing attempts are untouched — each
 * attempt permanently references the version it was served, so historical
 * results and reports stay reproducible.
 *
 * The instrument itself (dimensions, items, scoring) does not change; only
 * how many items each section serves. That keeps scores comparable across
 * roles while letting the assessment weight what a role actually needs.
 */

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

/** Seconds per item used to keep timed sections proportionate. */
const SECONDS_PER_ITEM: Record<string, number> = {
  MENTAL_ACUITY: 27,
  BUSINESS_TERMS: 22,
  AWARENESS_MEMORY: 28,
  VOCABULARY: 22,
  NUMERICAL_PERCEPTION: 9,
};

/** Floors that keep each scale scorable. */
const MIN_COUNTS: Record<string, number> = {
  BEHAVIORAL: 60,
  MECHANICAL_INTEREST: 0,
  MENTAL_ACUITY: 8,
  BUSINESS_TERMS: 6,
  AWARENESS_MEMORY: 6,
  VOCABULARY: 6,
  NUMERICAL_PERCEPTION: 10,
};

const schema = z.object({
  sections: z
    .array(
      z.object({
        sectionKey: z.string().min(1).max(50),
        include: z.boolean(),
        questionCount: z.number().int().min(0).max(150),
      }),
    )
    .min(1)
    .max(10),
  label: z.string().max(120).optional(),
});

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_BENCHMARKS");
  const { jobProfileId } = await ctx.params;
  const body = await parseBody(req, schema);

  const profile = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
  });
  if (!profile) return apiError("Job profile not found.", 404);

  // Base the tailored form on the current default active version so it
  // inherits the approved question pool, scoring, and narrative versions.
  const base = await prisma.assessmentVersion.findFirst({
    where: { status: "ACTIVE", jobProfiles: { none: {} } },
    orderBy: { versionNumber: "desc" },
    include: { sections: true, formQuestions: true },
  });
  if (!base) {
    return apiError("No base assessment version is available.", 409);
  }

  const availableBySection = new Map<string, number>();
  for (const fq of base.formQuestions) {
    availableBySection.set(
      fq.sectionKey,
      (availableBySection.get(fq.sectionKey) ?? 0) + 1,
    );
  }

  const warnings: string[] = [];
  const sectionData: Prisma.SectionDefinitionCreateWithoutAssessmentVersionInput[] =
    [];
  let orderIndex = 0;

  for (const baseSection of [...base.sections].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  )) {
    const requested = body.sections.find((s) => s.sectionKey === baseSection.key);
    if (requested && !requested.include) continue;

    const available = availableBySection.get(baseSection.key) ?? 0;
    const floor = MIN_COUNTS[baseSection.key] ?? 5;
    let count = requested?.questionCount ?? baseSection.questionCount;

    if (count < floor) {
      warnings.push(
        `${baseSection.title}: raised to ${floor} items — fewer would not score reliably.`,
      );
      count = floor;
    }
    if (count > available) {
      warnings.push(
        `${baseSection.title}: reduced to ${available} items — that is the whole approved pool.`,
      );
      count = available;
    }
    if (count === 0) continue;

    const perItem = SECONDS_PER_ITEM[baseSection.key];
    sectionData.push({
      key: baseSection.key,
      title: baseSection.title,
      orderIndex: orderIndex++,
      timed: baseSection.timed,
      durationSeconds:
        baseSection.timed && perItem
          ? Math.max(60, Math.round((count * perItem) / 30) * 30)
          : baseSection.durationSeconds,
      questionCount: count,
      instructions: baseSection.instructions,
      randomize: baseSection.randomize,
    });
  }

  if (sectionData.length === 0) {
    return apiError("A form needs at least one section.", 422);
  }

  const name = `FSW Talent Scout — ${profile.name}`;
  const previous = await prisma.assessmentVersion.findFirst({
    where: { name },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (previous?.versionNumber ?? 0) + 1;

  const created = await prisma.assessmentVersion.create({
    data: {
      name,
      versionNumber,
      status: "ACTIVE",
      description:
        body.label ??
        `Role-tailored form for ${profile.name}, derived from ${base.name} v${base.versionNumber}.`,
      scoringVersion: base.scoringVersion,
      narrativeVersion: base.narrativeVersion,
      activatedAt: new Date(),
      sections: { create: sectionData },
    },
  });

  // Reuse the same approved question pool.
  const keptKeys = new Set(sectionData.map((s) => s.key));
  await prisma.assessmentFormQuestion.createMany({
    data: base.formQuestions
      .filter((fq) => keptKeys.has(fq.sectionKey))
      .map((fq) => ({
        assessmentVersionId: created.id,
        sectionKey: fq.sectionKey,
        questionVersionId: fq.questionVersionId,
        difficultyBucket: fq.difficultyBucket,
        orderHint: fq.orderHint,
      })),
    skipDuplicates: true,
  });

  // Retire the profile's previous tailored form so it stops being offered.
  if (profile.assessmentVersionId) {
    await prisma.assessmentVersion.update({
      where: { id: profile.assessmentVersionId },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
  }
  await prisma.jobProfile.update({
    where: { id: jobProfileId },
    data: { assessmentVersionId: created.id },
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.ASSESSMENT_VERSION_CREATED,
    entityType: "AssessmentVersion",
    entityId: created.id,
    newValue: {
      jobProfileId,
      name,
      versionNumber,
      sections: sectionData.map((s) => ({
        key: s.key,
        questionCount: s.questionCount,
        durationSeconds: s.durationSeconds,
      })),
    },
  });

  const totalMinutes = Math.round(
    sectionData.reduce(
      (n, s) => n + (s.durationSeconds ?? s.questionCount * 12),
      0,
    ) / 60,
  );

  return apiOk({
    assessmentVersionId: created.id,
    name: `${name} v${versionNumber}`,
    warnings,
    estimatedMinutes: totalMinutes,
    sections: sectionData.map((s) => ({
      key: s.key,
      title: s.title,
      questionCount: s.questionCount,
      durationSeconds: s.durationSeconds ?? null,
    })),
  });
});

/** Revert to the default assessment form. */
export const DELETE = withErrorHandling(async (_req, ctx) => {
  const user = await requirePermission("MANAGE_BENCHMARKS");
  const { jobProfileId } = await ctx.params;

  const profile = await prisma.jobProfile.findUnique({
    where: { id: jobProfileId },
  });
  if (!profile) return apiError("Job profile not found.", 404);
  if (!profile.assessmentVersionId) return apiOk({ ok: true });

  await prisma.assessmentVersion.update({
    where: { id: profile.assessmentVersionId },
    data: { status: "RETIRED", retiredAt: new Date() },
  });
  await prisma.jobProfile.update({
    where: { id: jobProfileId },
    data: { assessmentVersionId: null },
  });
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.JOB_PROFILE_UPDATED,
    entityType: "JobProfile",
    entityId: jobProfileId,
    newValue: { assessmentVersionId: null },
  });
  return apiOk({ ok: true });
});
