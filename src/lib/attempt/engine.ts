/**
 * Attempt engine: creates attempts with a frozen question set, manages
 * section lifecycle with server-authoritative timers, and persists responses.
 *
 * Fairness: question selection is configurable randomization within
 * equivalent difficulty buckets — every candidate on the same form version
 * receives an equivalent (not arbitrarily different) set.
 *
 * Security: candidate payloads never include correct answers, constructs,
 * weights, or internal question IDs — only QuestionVersion.publicId, the
 * prompt, and choices for the CURRENT section.
 */

import { randomBytes } from "crypto";
import type { Attempt, AttemptSection, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  generateRecordId,
  generateToken,
  hashToken,
} from "@/lib/crypto";
import { computeExpiry, isExpired, remainingSeconds } from "@/lib/timing";

/** Fisher-Yates with crypto randomness (selection is frozen per attempt). */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface PoolQuestion {
  questionVersionId: string;
  difficultyBucket: number;
  orderHint: number;
  kind: string;
  pairKey: string | null;
}

/**
 * Select `count` scored questions from a section pool, proportionally across
 * difficulty buckets, shuffled within each bucket.
 */
function selectFromBuckets(pool: PoolQuestion[], count: number): PoolQuestion[] {
  const buckets = new Map<number, PoolQuestion[]>();
  for (const q of pool) {
    const list = buckets.get(q.difficultyBucket) ?? [];
    list.push(q);
    buckets.set(q.difficultyBucket, list);
  }
  const bucketKeys = [...buckets.keys()].sort((a, b) => a - b);
  const total = pool.length;
  const selected: PoolQuestion[] = [];

  // Proportional quota per bucket (largest remainder method).
  const quotas = bucketKeys.map((k) => {
    const size = buckets.get(k)!.length;
    const exact = (size / total) * count;
    return { key: k, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let assigned = quotas.reduce((s, q) => s + q.floor, 0);
  const byFrac = [...quotas].sort((a, b) => b.frac - a.frac);
  for (const q of byFrac) {
    if (assigned >= count) break;
    q.floor++;
    assigned++;
  }
  for (const q of quotas) {
    const available = shuffle(buckets.get(q.key)!);
    selected.push(...available.slice(0, Math.min(q.floor, available.length)));
  }
  // Backfill if some bucket was too small.
  if (selected.length < count) {
    const chosen = new Set(selected.map((s) => s.questionVersionId));
    const rest = shuffle(pool.filter((p) => !chosen.has(p.questionVersionId)));
    selected.push(...rest.slice(0, count - selected.length));
  }
  return selected;
}

/**
 * Order behavioral items so paired (consistency) items sit far apart and
 * items measuring the same construct don't cluster (the pool is already
 * cross-construct, so a shuffle plus pair separation is sufficient).
 */
function separatePairs(items: PoolQuestion[], minGap = 10): PoolQuestion[] {
  const out = shuffle(items);
  for (let pass = 0; pass < 3; pass++) {
    const seen = new Map<string, number>();
    for (let i = 0; i < out.length; i++) {
      const pk = out[i].pairKey;
      if (!pk) continue;
      const prev = seen.get(pk);
      if (prev !== undefined && i - prev < minGap) {
        const target = Math.min(out.length - 1, prev + minGap + Math.floor(out.length / 4));
        const [moved] = out.splice(i, 1);
        out.splice(target, 0, moved);
      } else {
        seen.set(pk, i);
      }
    }
  }
  return out;
}

/**
 * Create an attempt for an invitation: freeze the question set and create
 * section rows. Never called twice for the same active attempt.
 */
export async function createAttempt(params: {
  invitationId: string;
  candidateId: string;
  jobOpeningId: string;
  assessmentVersionId: string;
  attemptNumber?: number;
}): Promise<{ attempt: Attempt; resumeToken: string }> {
  const sections = await prisma.sectionDefinition.findMany({
    where: { assessmentVersionId: params.assessmentVersionId },
    orderBy: { orderIndex: "asc" },
  });
  const formQuestions = await prisma.assessmentFormQuestion.findMany({
    where: { assessmentVersionId: params.assessmentVersionId },
    include: {
      questionVersion: {
        select: { id: true, kind: true, pairKey: true },
      },
    },
  });

  const resumeToken = generateToken();
  const attempt = await prisma.attempt.create({
    data: {
      invitationId: params.invitationId,
      candidateId: params.candidateId,
      jobOpeningId: params.jobOpeningId,
      assessmentVersionId: params.assessmentVersionId,
      attemptNumber: params.attemptNumber ?? 1,
      recordId: generateRecordId(),
      resumeTokenHash: hashToken(resumeToken),
      status: "NOT_STARTED",
      sections: {
        create: sections.map((s) => ({
          sectionKey: s.key,
          orderIndex: s.orderIndex,
          timed: s.timed,
          durationSeconds: s.durationSeconds,
        })),
      },
    },
  });

  // Freeze the served question set per section.
  const attemptQuestions: Prisma.AttemptQuestionCreateManyInput[] = [];
  for (const section of sections) {
    const pool: PoolQuestion[] = formQuestions
      .filter((fq) => fq.sectionKey === section.key)
      .map((fq) => ({
        questionVersionId: fq.questionVersionId,
        difficultyBucket: fq.difficultyBucket,
        orderHint: fq.orderHint,
        kind: fq.questionVersion.kind,
        pairKey: fq.questionVersion.pairKey,
      }));

    let ordered: PoolQuestion[];
    if (section.key === "AWARENESS_MEMORY") {
      ordered = selectMemorySection(pool, section.questionCount);
    } else if (section.key === "BEHAVIORAL" || section.key === "MECHANICAL_INTEREST") {
      const selected = selectFromBuckets(
        pool.filter((p) => p.kind === "LIKERT_STATEMENT"),
        section.questionCount,
      );
      ordered = section.randomize ? separatePairs(selected) : selected;
    } else {
      const selected = selectFromBuckets(pool, section.questionCount);
      // Cognitive sections: roughly easy → hard, shuffled within buckets.
      ordered = section.randomize
        ? selected.sort((a, b) => a.difficultyBucket - b.difficultyBucket)
        : selected;
    }

    ordered.forEach((q, idx) => {
      attemptQuestions.push({
        attemptId: attempt.id,
        sectionKey: section.key,
        orderIndex: idx,
        questionVersionId: q.questionVersionId,
      });
    });
  }
  await prisma.attemptQuestion.createMany({ data: attemptQuestions });

  return { attempt, resumeToken };
}

/**
 * Memory/awareness section: pick 2 memory exercises (study card + its recall
 * questions travel together), then fill with awareness items. Study cards go
 * first; recall questions and awareness items are shuffled after them.
 */
function selectMemorySection(pool: PoolQuestion[], scoredCount: number): PoolQuestion[] {
  const studyCards = pool.filter((p) => p.kind === "MEMORY_STUDY");
  const recallByExercise = new Map<string, PoolQuestion[]>();
  for (const q of pool) {
    if (q.kind !== "MEMORY_STUDY" && q.pairKey) {
      const list = recallByExercise.get(q.pairKey) ?? [];
      list.push(q);
      recallByExercise.set(q.pairKey, list);
    }
  }
  const awareness = pool.filter((p) => p.kind !== "MEMORY_STUDY" && !p.pairKey);

  const chosenExercises = shuffle(
    studyCards.filter((s) => s.pairKey && recallByExercise.has(s.pairKey)),
  ).slice(0, 2);

  const recallQs = chosenExercises.flatMap(
    (s) => recallByExercise.get(s.pairKey!) ?? [],
  );
  const remaining = Math.max(0, scoredCount - recallQs.length);
  const awarenessChosen = selectFromBuckets(awareness, remaining);

  return [...chosenExercises, ...shuffle([...recallQs, ...awarenessChosen])];
}

// ---------------------------------------------------------------------------
// Section lifecycle
// ---------------------------------------------------------------------------

export async function startSection(
  attempt: Attempt,
  sectionKey: string,
): Promise<AttemptSection> {
  const section = await prisma.attemptSection.findUnique({
    where: { attemptId_sectionKey: { attemptId: attempt.id, sectionKey } },
  });
  if (!section) throw new Error("Unknown section.");
  if (section.status === "COMPLETED" || section.status === "EXPIRED") {
    // Completed timed sections may never be reopened.
    return section;
  }
  if (section.status === "IN_PROGRESS" && section.startedAt) {
    return section; // Idempotent: refresh never restarts the clock.
  }

  // Enforce section order: all earlier sections must be finished.
  const earlier = await prisma.attemptSection.findMany({
    where: {
      attemptId: attempt.id,
      orderIndex: { lt: section.orderIndex },
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });
  if (earlier.length > 0) {
    throw new Error("Earlier sections must be completed first.");
  }

  const startedAt = new Date();
  const timed = section.timed && !attempt.untimed;
  const expiresAt =
    timed && section.durationSeconds
      ? computeExpiry(startedAt, section.durationSeconds, attempt.timeMultiplier)
      : null;

  return prisma.attemptSection.update({
    where: { id: section.id },
    data: {
      status: "IN_PROGRESS",
      startedAt,
      expiresAt,
      durationSeconds:
        timed && section.durationSeconds
          ? Math.round(section.durationSeconds * attempt.timeMultiplier)
          : section.durationSeconds,
    },
  });
}

/** Grace window for a response that raced the deadline over the network. */
const SAVE_GRACE_MS = 3000;

export async function saveResponse(params: {
  attempt: Attempt;
  attemptQuestionId: string;
  value: number;
  responseTimeMs?: number;
  firstViewedAt?: Date;
}): Promise<{ saved: boolean; reason?: string }> {
  const aq = await prisma.attemptQuestion.findUnique({
    where: { id: params.attemptQuestionId },
    include: {
      questionVersion: {
        select: { kind: true, correctIndex: true, choices: true },
      },
      response: true,
    },
  });
  if (!aq || aq.attemptId !== params.attempt.id) {
    return { saved: false, reason: "Unknown question." };
  }

  const section = await prisma.attemptSection.findUnique({
    where: {
      attemptId_sectionKey: {
        attemptId: params.attempt.id,
        sectionKey: aq.sectionKey,
      },
    },
  });
  if (!section || section.status === "COMPLETED" || section.status === "EXPIRED") {
    return { saved: false, reason: "Section is closed." };
  }
  if (
    section.expiresAt &&
    Date.now() > section.expiresAt.getTime() + SAVE_GRACE_MS
  ) {
    await expireSection(params.attempt.id, aq.sectionKey);
    return { saved: false, reason: "Section time has expired." };
  }

  const choices = (aq.questionVersion.choices as string[] | null) ?? [];
  const maxIndex =
    aq.questionVersion.kind === "LIKERT_STATEMENT" ? 4 : choices.length - 1;
  if (params.value < 0 || params.value > maxIndex) {
    return { saved: false, reason: "Invalid answer." };
  }

  // Correctness is computed server-side and NEVER returned to the candidate.
  const isCorrect =
    aq.questionVersion.correctIndex !== null
      ? params.value === aq.questionVersion.correctIndex
      : null;

  await prisma.response.upsert({
    where: { attemptQuestionId: aq.id },
    create: {
      attemptId: params.attempt.id,
      attemptQuestionId: aq.id,
      value: params.value,
      answeredAt: new Date(),
      firstViewedAt: params.firstViewedAt,
      responseTimeMs: params.responseTimeMs,
      isCorrect,
      unanswered: false,
    },
    update: {
      value: params.value,
      answeredAt: new Date(),
      responseTimeMs: params.responseTimeMs,
      isCorrect,
      unanswered: false,
      changedCount: { increment: aq.response ? 1 : 0 },
    },
  });
  return { saved: true };
}

export async function expireSection(
  attemptId: string,
  sectionKey: string,
): Promise<void> {
  await prisma.attemptSection.updateMany({
    where: {
      attemptId,
      sectionKey,
      status: "IN_PROGRESS",
    },
    data: { status: "EXPIRED", completedAt: new Date() },
  });
  await prisma.integrityEvent.create({
    data: { attemptId, type: "SECTION_EXPIRED", meta: { sectionKey } },
  });
}

export async function completeSection(
  attempt: Attempt,
  sectionKey: string,
): Promise<AttemptSection> {
  const section = await prisma.attemptSection.findUnique({
    where: { attemptId_sectionKey: { attemptId: attempt.id, sectionKey } },
  });
  if (!section) throw new Error("Unknown section.");
  if (section.status === "COMPLETED" || section.status === "EXPIRED") {
    return section;
  }
  return prisma.attemptSection.update({
    where: { id: section.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

/**
 * Expire any timed in-progress sections whose server deadline has passed.
 * Called on every state read so a stalled client cannot keep a section open.
 */
export async function sweepExpiredSections(attemptId: string): Promise<void> {
  const open = await prisma.attemptSection.findMany({
    where: { attemptId, status: "IN_PROGRESS", expiresAt: { not: null } },
  });
  for (const s of open) {
    if (s.expiresAt && isExpired(s.expiresAt)) {
      await expireSection(attemptId, s.sectionKey);
    }
  }
}

export function sectionRemainingSeconds(section: AttemptSection): number | null {
  if (!section.expiresAt) return null;
  return remainingSeconds(section.expiresAt);
}
