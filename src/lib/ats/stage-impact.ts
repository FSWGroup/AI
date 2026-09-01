/**
 * Adverse-impact analysis across the whole hiring funnel.
 *
 * The assessment module already screens one selection procedure. But the
 * Uniform Guidelines apply to *any* procedure used as a basis for an
 * employment decision — a résumé screen, an interview, a hiring manager's
 * judgement — and in practice the largest disparities usually appear at the
 * least structured step, not the test. Measuring only the assessment measures
 * the one stage that was already designed to be measurable.
 *
 * So this computes pass-through rates stage by stage. Same restraint as the
 * assessment side: aggregates only, sample floors enforced, and a ratio is a
 * prompt to examine a stage, never a finding about it.
 */

import type { StageKind } from "@prisma/client";
import {
  analyzeCategory,
  MIN_GROUP_SIZE,
  MIN_TOTAL_FOR_ANALYSIS,
  type GroupOutcome,
  type ImpactAnalysis,
} from "@/lib/analytics/impact";

export interface StageDemographics {
  applicationId: string;
  /** Self-identification, when the candidate volunteered it. */
  demographics: Record<string, string> | null;
}

export interface StageReach {
  applicationId: string;
  stageName: string;
}

export interface StageImpact {
  stageName: string;
  stageKind: StageKind;
  /** Applications that reached this stage and had self-ID on file. */
  analyzed: number;
  categories: ImpactAnalysis[];
  /** Set when the sample was too small to say anything. */
  insufficientReason: string | null;
}

/**
 * For one stage: of the people who reached it, who moved on to any later
 * stage? That pass-through is the selection rate the four-fifths rule applies
 * to at this step.
 */
export interface StageOutcomeTotals {
  outcomes: GroupOutcome[];
  /** People at this stage with a usable self-identification. */
  analyzed: number;
}

export function stageOutcomes(
  stageIndex: number,
  orderedStageNames: string[],
  reach: StageReach[],
  people: StageDemographics[],
  category: string,
): StageOutcomeTotals {
  const stageName = orderedStageNames[stageIndex];
  const laterNames = new Set(orderedStageNames.slice(stageIndex + 1));

  const reachedThis = new Set(
    reach.filter((r) => r.stageName === stageName).map((r) => r.applicationId),
  );
  const reachedLater = new Set(
    reach.filter((r) => laterNames.has(r.stageName)).map((r) => r.applicationId),
  );

  const totals = new Map<string, { applicants: number; selected: number }>();
  let analyzed = 0;
  for (const person of people) {
    if (!reachedThis.has(person.applicationId)) continue;
    const value = person.demographics?.[category];
    // No self-ID and declined answers are both outside the analysis; a
    // "DECLINE" is not a demographic group.
    if (!value || value === "DECLINE") continue;
    analyzed += 1;
    const entry = totals.get(value) ?? { applicants: 0, selected: 0 };
    entry.applicants += 1;
    if (reachedLater.has(person.applicationId)) entry.selected += 1;
    totals.set(value, entry);
  }
  return {
    analyzed,
    outcomes: [...totals.entries()].map(([group, t]) => ({ group, ...t })),
  };
}

export function analyzeFunnelImpact(params: {
  orderedStages: { name: string; kind: StageKind }[];
  reach: StageReach[];
  people: StageDemographics[];
  categories: { key: string; label: string }[];
}): StageImpact[] {
  const names = params.orderedStages.map((s) => s.name);
  const results: StageImpact[] = [];

  // The last stage has nothing after it to pass through to.
  for (let i = 0; i < params.orderedStages.length - 1; i++) {
    const stage = params.orderedStages[i];
    const categories: ImpactAnalysis[] = [];
    let analyzed = 0;

    for (const category of params.categories) {
      const { outcomes, analyzed: n } = stageOutcomes(
        i,
        names,
        params.reach,
        params.people,
        category.key,
      );
      analyzed = Math.max(analyzed, n);
      const analysis = analyzeCategory(category.label, outcomes);
      if (analysis.totalApplicants > 0) categories.push(analysis);
    }

    results.push({
      stageName: stage.name,
      stageKind: stage.kind,
      analyzed,
      categories,
      insufficientReason:
        analyzed === 0
          ? "Nobody who reached this stage has self-identified."
          : analyzed < MIN_TOTAL_FOR_ANALYSIS
            ? `Only ${analyzed} of the people who reached this stage have self-identified; ${MIN_TOTAL_FOR_ANALYSIS} are needed before a rate means anything.`
            : null,
    });
  }

  return results;
}

export { MIN_GROUP_SIZE, MIN_TOTAL_FOR_ANALYSIS };
