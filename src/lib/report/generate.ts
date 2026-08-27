/**
 * Report generation.
 *
 * Builds a complete, versioned report payload from stored scores, the job's
 * benchmark (frozen into the report as a snapshot), and versioned narrative
 * templates. Reports are reproducible: the payload records scoring,
 * narrative, and benchmark versions, and historical reports are never
 * silently recalculated (recalculation is an explicit, audited admin action).
 *
 * No automated hire/reject output exists anywhere in this module.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  APTITUDE_CONSTRUCTS,
  BEHAVIORAL_CONSTRUCTS,
  type Construct,
} from "@/content/types";
import { BAND_LABELS } from "@/lib/scoring/bands";
import { classifyAgainstRange, rangeDeviation } from "@/lib/scoring/benchmark";
import {
  classifyCompositeBand,
  overallSalesAlignment,
  SALES_ALIGNMENT_LABELS,
} from "@/lib/scoring/composites";
import { summarizeIntegrity, INTEGRITY_LABELS } from "@/lib/scoring/integrity";
import {
  evaluateConcernRules,
  selectDevelopmentDimensions,
  selectInterviewDimensions,
  type DimensionOutcome,
} from "./selection";
import type { RangePosition } from "@/lib/scoring/types";

export interface ReportDimension {
  construct: Construct;
  name: string;
  category: "APTITUDE" | "BEHAVIORAL";
  shortDefinition: string;
  lowDescriptor: string;
  highDescriptor: string;
  band: number;
  bandType: "PROVISIONAL" | "STANINE";
  bandLabel: string;
  benchmark: { min: number; max: number; required: boolean; note?: string } | null;
  position: RangePosition | null;
  deviation: number;
  narrative: string;
  rangeNarrative: string | null;
}

export interface ReportPayload {
  meta: {
    candidateName: string;
    position: string;
    company: string;
    completedAt: string | null;
    assessmentVersionName: string;
    scoringVersion: string;
    narrativeVersion: string;
    reportVersion: number;
    attemptNumber: number;
    recordId: string;
    /** Whether any dimension used a validated stanine vs provisional bands. */
    bandTypeNote: string;
  };
  executiveSummary: {
    strongestAlignment: { construct: Construct; name: string; band: number }[];
    investigate: { construct: Construct; name: string; reason: string }[];
    responseQuality: string;
    disclaimer: string;
  };
  dimensions: ReportDimension[];
  validity: {
    construct: Construct;
    name: string;
    band: number;
    level: string;
    narrative: string;
    detail: Record<string, unknown>;
  }[];
  concerns: { construct: Construct; name: string; band: number; label: string }[];
  salesTraits: {
    composites: {
      key: string;
      name: string;
      band: number;
      value: number;
      classification: string;
      classificationLabel: string;
      components: { construct: string; weight: number; band: number | null }[];
    }[];
    overall: string;
    overallLabel: string;
    strengths: string[];
    exploration: string[];
  } | null;
  leadership: {
    composites: {
      key: string;
      name: string;
      band: number;
      value: number;
      components: { construct: string; weight: number; band: number | null }[];
    }[];
  } | null;
  interviewGuide: {
    construct: Construct;
    name: string;
    focus: string;
    reason: string;
    measures: string;
    questions: { question: string; altWording: string; listenFor: string }[];
  }[];
  development: {
    construct: Construct;
    name: string;
    recommendations: string[];
  }[];
  integrity: {
    level: string;
    label: string;
    weightedScore: number;
    notableCounts: { type: string; count: number }[];
    reviewReminder: string;
  };
}

const EMPLOYMENT_DISCLAIMER =
  "FSW WorkFit is decision-support software. Results are one input among many and " +
  "should never be the sole basis for an employment decision. Assessment " +
  "instruments used for employment decisions should be evaluated for job " +
  "relevance, reliability, validity, accessibility, and potential adverse impact.";

export async function generateReport(attemptId: string): Promise<string> {
  const attempt = await prisma.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      candidate: true,
      assessmentVersion: true,
      jobOpening: {
        include: {
          jobProfile: { include: { benchmarks: true, concernRules: true } },
        },
      },
      scores: true,
      compositeScores: true,
      integrityEvents: true,
    },
  });
  const orgSettings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  const narrativeVersion = attempt.assessmentVersion.narrativeVersion;

  const templates = await prisma.narrativeTemplate.findMany({
    where: { version: narrativeVersion, active: true },
  });
  const templateFor = (construct: Construct, slot: string): string =>
    templates.find((t) => t.construct === construct && t.slot === slot)?.text ??
    "";

  const dimensionMeta = await getDimensionMeta();
  const benchmarks = attempt.jobOpening.jobProfile.benchmarks;

  // ---- Per-dimension outcomes -------------------------------------------------
  const dimensions: ReportDimension[] = [];
  const outcomes: DimensionOutcome[] = [];
  const bands: Partial<Record<Construct, number>> = {};
  let usedStanine = false;
  let usedProvisional = false;

  const scoredConstructs: Construct[] = [
    ...APTITUDE_CONSTRUCTS,
    ...BEHAVIORAL_CONSTRUCTS,
  ];
  for (const construct of scoredConstructs) {
    const score = attempt.scores.find((s) => s.construct === construct);
    if (!score) continue;
    bands[construct] = score.band;
    if (score.bandType === "STANINE") usedStanine = true;
    else usedProvisional = true;

    const dm = dimensionMeta[construct];
    const bm = benchmarks.find((b) => b.construct === construct && b.enabled);
    const position = bm ? classifyAgainstRange(score.band, bm) : null;
    const deviation = bm ? rangeDeviation(score.band, bm) : 0;

    outcomes.push({
      construct,
      band: score.band,
      position: position ?? "WITHIN",
      deviation,
      benchmark: bm
        ? {
            construct,
            minScore: bm.minScore,
            maxScore: bm.maxScore,
            required: bm.required,
            enabled: bm.enabled,
            weight: bm.weight,
            note: bm.note,
          }
        : null,
    });

    const rangeSlot =
      position === "BELOW"
        ? "RANGE_BELOW"
        : position === "ABOVE"
          ? "RANGE_ABOVE"
          : position === "WITHIN"
            ? "RANGE_WITHIN"
            : null;

    dimensions.push({
      construct,
      name: dm?.name ?? construct,
      category: (APTITUDE_CONSTRUCTS as readonly string[]).includes(construct)
        ? "APTITUDE"
        : "BEHAVIORAL",
      shortDefinition: dm?.shortDefinition ?? "",
      lowDescriptor: dm?.lowDescriptor ?? "Low",
      highDescriptor: dm?.highDescriptor ?? "High",
      band: score.band,
      bandType: score.bandType,
      bandLabel: BAND_LABELS[score.band] ?? String(score.band),
      benchmark: bm
        ? { min: bm.minScore, max: bm.maxScore, required: bm.required, note: bm.note ?? undefined }
        : null,
      position,
      deviation,
      narrative: templateFor(construct, `BAND_${score.band}`),
      rangeNarrative: rangeSlot ? templateFor(construct, rangeSlot) : null,
    });
  }

  // ---- Validity ---------------------------------------------------------------
  const validity: ReportPayload["validity"] = [];
  const validityLevels: { construct: "DISTORTION" | "EQUIVOCATION"; level: string }[] =
    [];
  for (const construct of ["DISTORTION", "EQUIVOCATION"] as const) {
    const score = attempt.scores.find((s) => s.construct === construct);
    if (!score) continue;
    const detail = (score.detail ?? {}) as Record<string, unknown>;
    const level = (detail.level as string) ?? "NORMAL";
    validityLevels.push({ construct, level });
    validity.push({
      construct,
      name: dimensionMeta[construct]?.name ?? construct,
      band: score.band,
      level,
      narrative: templateFor(construct, `LEVEL_${level}`),
      detail,
    });
  }

  // ---- Concerns (configurable rules; never a failure verdict) -----------------
  const concernRules = attempt.jobOpening.jobProfile.concernRules.map((r) => ({
    construct: r.construct as Construct,
    maxBand: r.maxBand,
    label: r.label,
    enabled: r.enabled,
  }));
  const concerns = evaluateConcernRules(concernRules, bands).map((c) => ({
    ...c,
    name: dimensionMeta[c.construct]?.name ?? c.construct,
  }));

  // ---- Sales traits / leadership ----------------------------------------------
  const salesComposites = attempt.compositeScores.filter(
    (c) => c.category === "SALES",
  );
  const salesTraits =
    salesComposites.length > 0
      ? (() => {
          const composites = salesComposites.map((c) => {
            const classification = classifyCompositeBand(c.band);
            const detail = c.detail as {
              components?: { construct: string; weight: number; band: number | null }[];
            } | null;
            return {
              key: c.key,
              name: c.name,
              band: c.band,
              value: c.value,
              classification,
              classificationLabel: SALES_ALIGNMENT_LABELS[classification],
              components: detail?.components ?? [],
            };
          });
          const overall = overallSalesAlignment(composites.map((c) => c.band));
          return {
            composites,
            overall,
            overallLabel: SALES_ALIGNMENT_LABELS[overall],
            strengths: composites
              .filter((c) => c.band >= 7)
              .map((c) => c.name),
            exploration: composites
              .filter((c) => c.band <= 4)
              .map((c) => c.name),
          };
        })()
      : null;

  const leadershipComposites = attempt.compositeScores.filter(
    (c) => c.category === "LEADERSHIP",
  );
  const leadership =
    leadershipComposites.length > 0
      ? {
          composites: leadershipComposites.map((c) => {
            const detail = c.detail as {
              components?: { construct: string; weight: number; band: number | null }[];
            } | null;
            return {
              key: c.key,
              name: c.name,
              band: c.band,
              value: c.value,
              components: detail?.components ?? [],
            };
          }),
        }
      : null;

  // ---- Interview guide ----------------------------------------------------------
  const interviewSelections = selectInterviewDimensions(outcomes, validityLevels);
  const interviewTemplates = await prisma.interviewQuestionTemplate.findMany({
    where: { version: narrativeVersion, active: true },
  });
  const interviewGuide: ReportPayload["interviewGuide"] = [];
  for (const sel of interviewSelections) {
    const template = interviewTemplates.find(
      (t) => t.construct === sel.construct && t.focus === sel.focus,
    );
    if (!template) continue;
    interviewGuide.push({
      construct: sel.construct,
      name: dimensionMeta[sel.construct]?.name ?? sel.construct,
      focus: sel.focus,
      reason: sel.reason,
      measures: template.measures,
      questions: template.questions as {
        question: string;
        altWording: string;
        listenFor: string;
      }[],
    });
  }

  // ---- Development ---------------------------------------------------------------
  const developmentSelections = selectDevelopmentDimensions(outcomes);
  const developmentTemplates = await prisma.developmentTemplate.findMany({
    where: { version: narrativeVersion, active: true },
  });
  const development: ReportPayload["development"] = [];
  for (const sel of developmentSelections) {
    const template = developmentTemplates.find(
      (t) => t.construct === sel.construct,
    );
    if (!template) continue;
    development.push({
      construct: sel.construct,
      name: dimensionMeta[sel.construct]?.name ?? sel.construct,
      recommendations: template.recommendations as string[],
    });
  }

  // ---- Integrity summary ----------------------------------------------------------
  const eventCounts = new Map<string, number>();
  for (const e of attempt.integrityEvents) {
    eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1);
  }
  const integritySummary = summarizeIntegrity(
    [...eventCounts.entries()].map(([type, count]) => ({ type, count })),
  );

  // ---- Executive summary ------------------------------------------------------------
  const strongestAlignment = dimensions
    .filter((d) => d.position === "WITHIN" && d.benchmark?.required)
    .sort((a, b) => b.band - a.band)
    .slice(0, 5)
    .map((d) => ({ construct: d.construct, name: d.name, band: d.band }));
  const investigate = interviewSelections.slice(0, 4).map((s) => ({
    construct: s.construct,
    name: dimensionMeta[s.construct]?.name ?? s.construct,
    reason: s.reason,
  }));
  const worstValidity = validityLevels.some((v) => v.level === "HIGH")
    ? "HIGH"
    : validityLevels.some((v) => v.level === "ELEVATED")
      ? "ELEVATED"
      : "NORMAL";
  const responseQuality =
    worstValidity === "HIGH"
      ? "Response-quality indicators are clearly elevated. Interpret behavioral results with additional caution and verify impressions through structured interviewing."
      : worstValidity === "ELEVATED"
        ? "Response-quality indicators are somewhat elevated. Behavioral results are usable, but confirm key impressions with first-hand examples during the interview."
        : "Response-quality indicators fall in the typical range. Results can be interpreted with ordinary confidence.";

  const payload: ReportPayload = {
    meta: {
      candidateName: `${attempt.candidate.firstName} ${attempt.candidate.lastName}`,
      position: attempt.jobOpening.title,
      company: orgSettings?.companyName ?? "FSW Group",
      completedAt: attempt.completedAt?.toISOString() ?? null,
      assessmentVersionName: `${attempt.assessmentVersion.name} v${attempt.assessmentVersion.versionNumber}`,
      scoringVersion: attempt.assessmentVersion.scoringVersion,
      narrativeVersion,
      reportVersion: 1,
      attemptNumber: attempt.attemptNumber,
      recordId: attempt.recordId,
      bandTypeNote: usedStanine
        ? usedProvisional
          ? "Some dimensions use validated stanines; others use provisional internal 1-9 bands pending norm calibration."
          : "Scores use validated stanine norms."
        : "All 1-9 scores are provisional internal bands. Validated stanines become available once FSW installs norm tables from calibration data.",
    },
    executiveSummary: {
      strongestAlignment,
      investigate,
      responseQuality,
      disclaimer: EMPLOYMENT_DISCLAIMER,
    },
    dimensions,
    validity,
    concerns,
    salesTraits,
    leadership,
    interviewGuide,
    development,
    integrity: {
      level: integritySummary.level,
      label: INTEGRITY_LABELS[integritySummary.level],
      weightedScore: integritySummary.weightedScore,
      notableCounts: integritySummary.notableCounts,
      reviewReminder:
        "Review integrity information (and any recording) only for assessment-integrity concerns. Do not evaluate appearance or any actual or perceived protected characteristic.",
    },
  };

  const benchmarkSnapshot = benchmarks.map((b) => ({
    construct: b.construct,
    minScore: b.minScore,
    maxScore: b.maxScore,
    required: b.required,
    enabled: b.enabled,
    weight: b.weight,
    note: b.note,
  }));

  const existing = await prisma.report.findFirst({
    where: { attemptId: attempt.id },
    orderBy: { version: "desc" },
  });
  const report = await prisma.report.create({
    data: {
      attemptId: attempt.id,
      status: "READY",
      scoringVersion: attempt.assessmentVersion.scoringVersion,
      narrativeVersion,
      benchmarkSnapshot: benchmarkSnapshot as unknown as Prisma.InputJsonValue,
      payload: payload as unknown as Prisma.InputJsonValue,
      version: (existing?.version ?? 0) + 1,
      generatedAt: new Date(),
    },
  });
  return report.id;
}

/** Dimension display metadata, loaded once from the seeded content module. */
async function getDimensionMeta(): Promise<
  Partial<Record<Construct, { name: string; shortDefinition: string; lowDescriptor: string; highDescriptor: string }>>
> {
  const { dimensionMeta } = await import("@/content/narratives/dimension-meta");
  const map: Partial<
    Record<Construct, { name: string; shortDefinition: string; lowDescriptor: string; highDescriptor: string }>
  > = {};
  for (const dm of dimensionMeta) {
    map[dm.construct] = {
      name: dm.name,
      shortDefinition: dm.shortDefinition,
      lowDescriptor: dm.lowDescriptor,
      highDescriptor: dm.highDescriptor,
    };
  }
  return map;
}
