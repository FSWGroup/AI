/**
 * E2E global setup: create a small, fast assessment form ("FSW Talent Scout E2E",
 * version 99) drawing from the same approved question pool, so end-to-end
 * runs finish in minutes while exercising every mechanism (timers, study
 * cards, Likert pages, recording, completion).
 */

import { PrismaClient } from "@prisma/client";

export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.assessmentVersion.findFirst({
      where: { name: "FSW Talent Scout E2E", versionNumber: 99 },
    });
    if (existing) {
      if (existing.status !== "ACTIVE") {
        await prisma.assessmentVersion.update({
          where: { id: existing.id },
          data: { status: "ACTIVE" },
        });
      }
      return;
    }

    const base = await prisma.assessmentVersion.findFirstOrThrow({
      where: { name: "FSW Talent Scout Standard", versionNumber: 1 },
      include: { formQuestions: true },
    });

    const version = await prisma.assessmentVersion.create({
      data: {
        name: "FSW Talent Scout E2E",
        versionNumber: 99,
        status: "ACTIVE",
        description: "Miniature form for automated end-to-end testing only.",
        scoringVersion: base.scoringVersion,
        narrativeVersion: base.narrativeVersion,
        activatedAt: new Date(),
        sections: {
          create: [
            // 12 items across the 11 construct buckets guarantees every
            // behavioral construct (and DISTORTION) serves at least one item.
            { key: "BEHAVIORAL", title: "Work Style Inventory", orderIndex: 0, timed: false, questionCount: 12, instructions: "Choose the response that genuinely describes you." },
            { key: "MECHANICAL_INTEREST", title: "Technical & Mechanical Interests", orderIndex: 1, timed: false, questionCount: 4, instructions: "These ask about interests, not abilities." },
            { key: "MENTAL_ACUITY", title: "Reasoning & Problem Solving", orderIndex: 2, timed: true, durationSeconds: 180, questionCount: 4, instructions: "Timed reasoning questions." },
            { key: "BUSINESS_TERMS", title: "Business Terms & Concepts", orderIndex: 3, timed: true, durationSeconds: 120, questionCount: 3, instructions: "Timed business questions." },
            { key: "AWARENESS_MEMORY", title: "Business Awareness & Memory", orderIndex: 4, timed: true, durationSeconds: 300, questionCount: 8, instructions: "Study the briefings; recall comes later." },
            { key: "VOCABULARY", title: "Vocabulary & Comprehension", orderIndex: 5, timed: true, durationSeconds: 120, questionCount: 3, instructions: "Timed vocabulary questions." },
            { key: "NUMERICAL_PERCEPTION", title: "Detail Checking", orderIndex: 6, timed: true, durationSeconds: 90, questionCount: 4, instructions: "Compare entries quickly and accurately." },
          ],
        },
      },
    });

    await prisma.assessmentFormQuestion.createMany({
      data: base.formQuestions.map((fq) => ({
        assessmentVersionId: version.id,
        sectionKey: fq.sectionKey,
        questionVersionId: fq.questionVersionId,
        difficultyBucket: fq.difficultyBucket,
        orderHint: fq.orderHint,
      })),
      skipDuplicates: true,
    });
  } finally {
    await prisma.$disconnect();
  }
}
