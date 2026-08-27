/**
 * Report-selection rules.
 *
 * Dimensions meaningfully outside the job benchmark become more likely to
 * receive expanded narrative, targeted interview questions, and development
 * suggestions. Implemented generically over any profile; nothing is
 * hard-coded to a particular job.
 */

import type { BenchmarkRange, RangePosition } from "@/lib/scoring/types";
import type {
  BehavioralConstruct,
  Construct,
} from "@/content/types";
import { BEHAVIORAL_CONSTRUCTS } from "@/content/types";

export interface DimensionOutcome {
  construct: Construct;
  band: number;
  position: RangePosition;
  deviation: number;
  benchmark: BenchmarkRange | null;
}

export interface InterviewSelection {
  construct: Construct;
  focus: "BELOW_RANGE" | "ABOVE_RANGE" | "VALIDITY";
  priority: number;
  reason: string;
}

export const SELECTION_CONFIG = {
  version: "1.0",
  /** How many interview dimensions to target. */
  minInterviewDimensions: 2,
  maxInterviewDimensions: 4,
  /** Deviation (in bands) at which a dimension becomes a candidate. */
  interviewDeviationAt: 1,
  /** Deviation at which development recommendations are generated. */
  developmentDeviationAt: 1,
  maxDevelopmentDimensions: 4,
  /** Weight >= this marks a role-critical dimension (priority bonus). */
  roleCriticalWeight: 1.5,
} as const;

/**
 * Choose 2-4 dimensions deserving interview follow-up, driven by:
 *  - meaningful deviation below the desired range (strongest signal)
 *  - meaningful deviation above the desired range
 *  - response-validity concerns (added separately by the caller)
 *  - role-critical dimensions get a priority bonus
 */
export function selectInterviewDimensions(
  outcomes: DimensionOutcome[],
  validityLevels: { construct: "DISTORTION" | "EQUIVOCATION"; level: string }[],
): InterviewSelection[] {
  const candidates: InterviewSelection[] = [];

  for (const o of outcomes) {
    if (!o.benchmark || !o.benchmark.enabled) continue;
    if (o.deviation < SELECTION_CONFIG.interviewDeviationAt) continue;

    const criticalBonus =
      o.benchmark.weight >= SELECTION_CONFIG.roleCriticalWeight ? 1 : 0;
    // Below-range deviations weigh slightly more than above-range ones.
    const directionWeight = o.position === "BELOW" ? 1.25 : 1;
    candidates.push({
      construct: o.construct,
      focus: o.position === "BELOW" ? "BELOW_RANGE" : "ABOVE_RANGE",
      priority: o.deviation * directionWeight + criticalBonus,
      reason:
        o.position === "BELOW"
          ? `Score of ${o.band} is ${o.deviation} band(s) below the desired range ${o.benchmark.minScore}-${o.benchmark.maxScore}.`
          : `Score of ${o.band} is ${o.deviation} band(s) above the desired range ${o.benchmark.minScore}-${o.benchmark.maxScore}.`,
    });
  }

  for (const v of validityLevels) {
    if (v.level === "ELEVATED" || v.level === "HIGH") {
      candidates.push({
        construct: v.construct,
        focus: "VALIDITY",
        priority: v.level === "HIGH" ? 3 : 1.5,
        reason:
          v.level === "HIGH"
            ? "Response-quality indicator is clearly elevated; gather first-hand examples in the interview."
            : "Response-quality indicator is somewhat elevated; gather first-hand examples in the interview.",
      });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  let selected = candidates.slice(0, SELECTION_CONFIG.maxInterviewDimensions);

  // If nothing deviates, still give the interviewer something useful:
  // probe the role-critical dimensions closest to the range edges.
  if (selected.length < SELECTION_CONFIG.minInterviewDimensions) {
    const fallback = outcomes
      .filter((o) => o.benchmark?.enabled && o.deviation === 0)
      .map((o) => {
        const distToEdge = Math.min(
          o.band - (o.benchmark?.minScore ?? 1),
          (o.benchmark?.maxScore ?? 9) - o.band,
        );
        return { o, distToEdge };
      })
      .sort((a, b) => a.distToEdge - b.distToEdge)
      .filter(({ o }) => !selected.some((s) => s.construct === o.construct))
      .slice(0, SELECTION_CONFIG.minInterviewDimensions - selected.length)
      .map(({ o }) => ({
        construct: o.construct,
        focus: (o.band - (o.benchmark?.minScore ?? 1) <=
        (o.benchmark?.maxScore ?? 9) - o.band
          ? "BELOW_RANGE"
          : "ABOVE_RANGE") as "BELOW_RANGE" | "ABOVE_RANGE",
        priority: 0.5,
        reason:
          "Within the desired range but close to its edge; worth confirming with examples.",
      }));
    selected = [...selected, ...fallback];
  }

  return selected;
}

/** Constructs where development recommendations make sense. */
const DEVELOPABLE: Construct[] = [
  ...BEHAVIORAL_CONSTRUCTS,
  "BUSINESS_TERMS",
  "AWARENESS_MEMORY",
  "VOCABULARY",
  "MECHANICAL_INTEREST",
];

/**
 * Development recommendations focus on dimensions meaningfully below the
 * desired range where development is actually possible. "Too much" of an
 * aptitude never generates a development section.
 */
export function selectDevelopmentDimensions(
  outcomes: DimensionOutcome[],
): { construct: Construct; deviation: number }[] {
  return outcomes
    .filter(
      (o) =>
        o.benchmark?.enabled &&
        o.position === "BELOW" &&
        o.deviation >= SELECTION_CONFIG.developmentDeviationAt &&
        DEVELOPABLE.includes(o.construct),
    )
    .sort((a, b) => b.deviation - a.deviation)
    .slice(0, SELECTION_CONFIG.maxDevelopmentDimensions)
    .map((o) => ({ construct: o.construct, deviation: o.deviation }));
}

export interface ConcernRule {
  construct: BehavioralConstruct | Construct;
  maxBand: number;
  label: string;
  enabled: boolean;
}

/** Evaluate configurable critical-attention rules. Never a failure verdict. */
export function evaluateConcernRules(
  rules: ConcernRule[],
  bands: Partial<Record<Construct, number>>,
): { construct: Construct; band: number; label: string }[] {
  const flagged: { construct: Construct; band: number; label: string }[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const band = bands[rule.construct as Construct];
    if (band !== undefined && band <= rule.maxBand) {
      flagged.push({
        construct: rule.construct as Construct,
        band,
        label: rule.label,
      });
    }
  }
  return flagged;
}
