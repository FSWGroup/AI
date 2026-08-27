/**
 * Attempt scoring orchestrator.
 *
 * Reproducibility contract: the same answers + form version + scoring
 * version + norm tables always produce identical scores. All inputs come
 * from frozen rows (QuestionVersion, Response); all computation is in the
 * pure modules under src/lib/scoring.
 *
 * Recording/camera data plays NO part in any score. Only objective
 * integrity events feed the separate integrity summary.
 */

import type { Construct as DbConstruct, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  APTITUDE_CONSTRUCTS,
  BEHAVIORAL_CONSTRUCTS,
  type Construct,
} from "@/content/types";
import { bandScore } from "@/lib/scoring/bands";
import { scoreCognitiveSection } from "@/lib/scoring/cognitive";
import { scoreBehavioralConstruct } from "@/lib/scoring/behavioral";
import { scoreDistortion, scoreEquivocation } from "@/lib/scoring/validity";
import { evaluateComposite, type CompositeInput } from "@/lib/scoring/composites";
import { SCORING_VERSION } from "@/lib/scoring/types";
import type {
  CognitiveItemResponse,
  LikertItemResponse,
  NormTableData,
} from "@/lib/scoring/types";

export async function scoreAttempt(attemptId: string): Promise<void> {
  const attempt = await prisma.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      questions: {
        include: {
          questionVersion: true,
          response: true,
        },
      },
      jobOpening: { include: { jobProfile: true } },
    },
  });

  // ---- Partition items -----------------------------------------------------
  const cognitiveByConstruct = new Map<Construct, CognitiveItemResponse[]>();
  const likertItems: LikertItemResponse[] = [];

  for (const aq of attempt.questions) {
    const qv = aq.questionVersion;
    if (qv.kind === "MEMORY_STUDY") continue; // study cards are unscored

    if (qv.kind === "LIKERT_STATEMENT") {
      likertItems.push({
        construct: qv.construct as Construct,
        weight: qv.weight,
        reverseCoded: qv.reverseCoded,
        impressionManagement: qv.impressionManagement,
        pairKey: qv.pairKey,
        answerIndex: aq.response?.unanswered === false ? aq.response.value : null,
      });
    } else if (qv.correctIndex !== null) {
      const construct = qv.construct as Construct;
      const list = cognitiveByConstruct.get(construct) ?? [];
      list.push({
        weight: qv.weight,
        answerIndex: aq.response?.unanswered === false ? aq.response.value : null,
        correctIndex: qv.correctIndex,
        responseTimeMs: aq.response?.responseTimeMs,
      });
      cognitiveByConstruct.set(construct, list);
    }
  }

  // ---- Norm tables (validated stanines) when installed ----------------------
  const normTables = await prisma.normTable.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { assessmentVersionId: attempt.assessmentVersionId },
        { assessmentVersionId: null },
      ],
    },
    orderBy: { effectiveDate: "desc" },
  });
  const normFor = (construct: Construct): NormTableData | null => {
    const table = normTables.find((t) => t.construct === construct);
    if (!table) return null;
    return {
      id: table.id,
      construct,
      thresholds: table.thresholds as NormTableData["thresholds"],
    };
  };

  const scoreRows: Prisma.ScoreCreateManyInput[] = [];
  const bands: Partial<Record<Construct, number>> = {};

  // ---- Cognitive constructs --------------------------------------------------
  for (const construct of APTITUDE_CONSTRUCTS) {
    if (construct === "MECHANICAL_INTEREST") continue; // Likert-scored below
    const items = cognitiveByConstruct.get(construct);
    if (!items || items.length === 0) continue;
    const raw = scoreCognitiveSection(construct, items);
    const norm = normFor(construct);
    const banded = bandScore(raw.rawScore, raw.scaledScore, norm);
    bands[construct] = banded.band;
    scoreRows.push({
      attemptId: attempt.id,
      construct: construct as DbConstruct,
      rawScore: raw.rawScore,
      scaledScore: raw.scaledScore,
      percentile: banded.percentile,
      band: banded.band,
      bandType: banded.bandType,
      normTableId: banded.normTableId,
      scoringVersion: SCORING_VERSION,
      detail: raw.detail as Prisma.InputJsonValue,
    });
  }

  // ---- Behavioral constructs + mechanical interest ---------------------------
  const likertConstructs: Construct[] = [
    ...BEHAVIORAL_CONSTRUCTS,
    "MECHANICAL_INTEREST",
  ];
  for (const construct of likertConstructs) {
    const relevant = likertItems.filter(
      (i) => i.construct === construct && !i.impressionManagement,
    );
    if (relevant.length === 0) continue;
    const raw = scoreBehavioralConstruct(construct, likertItems);
    const norm = normFor(construct);
    const banded = bandScore(raw.rawScore, raw.scaledScore, norm);
    bands[construct] = banded.band;
    scoreRows.push({
      attemptId: attempt.id,
      construct: construct as DbConstruct,
      rawScore: raw.rawScore,
      scaledScore: raw.scaledScore,
      percentile: banded.percentile,
      band: banded.band,
      bandType: banded.bandType,
      normTableId: banded.normTableId,
      scoringVersion: SCORING_VERSION,
      detail: raw.detail as Prisma.InputJsonValue,
    });
  }

  // ---- Response-quality indicators -------------------------------------------
  // Distortion looks at the behavioral inventory (substantive + IM items);
  // equivocation additionally sees mechanical-interest statements.
  const behavioralAndIm = likertItems.filter(
    (i) => i.construct !== "MECHANICAL_INTEREST" || i.impressionManagement,
  );
  const distortion = scoreDistortion(behavioralAndIm);
  const equivocation = scoreEquivocation(likertItems);
  for (const v of [distortion, equivocation]) {
    bands[v.construct] = v.band;
    scoreRows.push({
      attemptId: attempt.id,
      construct: v.construct as DbConstruct,
      rawScore: v.rawScore,
      scaledScore: v.scaledScore,
      band: v.band,
      bandType: "PROVISIONAL",
      scoringVersion: SCORING_VERSION,
      detail: { ...v.detail, level: v.level } as Prisma.InputJsonValue,
    });
  }

  // ---- Composites (sales / leadership) ----------------------------------------
  const compositeRows: Prisma.CompositeScoreCreateManyInput[] = [];
  const jobProfile = attempt.jobOpening.jobProfile;
  const wantedCategories: ("SALES" | "LEADERSHIP")[] = [];
  if (jobProfile.isSalesRole) wantedCategories.push("SALES");
  if (jobProfile.leadershipModuleEnabled) wantedCategories.push("LEADERSHIP");

  if (wantedCategories.length > 0) {
    const defs = await prisma.compositeDefinition.findMany({
      where: { active: true, category: { in: wantedCategories } },
      orderBy: { orderIndex: "asc" },
    });
    for (const def of defs) {
      const input: CompositeInput = {
        key: def.key,
        name: def.name,
        category: def.category,
        version: def.version,
        components: def.components as unknown as CompositeInput["components"],
      };
      const result = evaluateComposite(input, bands);
      compositeRows.push({
        attemptId: attempt.id,
        key: result.key,
        name: result.name,
        category: result.category,
        value: result.value,
        band: result.band,
        formulaVersion: result.formulaVersion,
        detail: result.detail as unknown as Prisma.InputJsonValue,
      });
    }
  }

  // ---- Persist atomically; replace any previous scoring of this attempt ------
  await prisma.$transaction([
    prisma.score.deleteMany({ where: { attemptId: attempt.id } }),
    prisma.compositeScore.deleteMany({ where: { attemptId: attempt.id } }),
    prisma.score.createMany({ data: scoreRows }),
    prisma.compositeScore.createMany({ data: compositeRows }),
  ]);

  // ---- Anonymous aggregate item statistics (calibration module) --------------
  for (const aq of attempt.questions) {
    if (aq.questionVersion.kind === "MEMORY_STUDY") continue;
    const answered = aq.response?.unanswered === false;
    const correct = aq.response?.isCorrect === true;
    await prisma.itemStatistic.upsert({
      where: { questionVersionId: aq.questionVersionId },
      create: {
        questionVersionId: aq.questionVersionId,
        administered: 1,
        correctCount: correct ? 1 : 0,
        unansweredCount: answered ? 0 : 1,
        totalResponseMs: BigInt(aq.response?.responseTimeMs ?? 0),
      },
      update: {
        administered: { increment: 1 },
        correctCount: { increment: correct ? 1 : 0 },
        unansweredCount: { increment: answered ? 0 : 1 },
        totalResponseMs: { increment: BigInt(aq.response?.responseTimeMs ?? 0) },
      },
    });
  }
}
