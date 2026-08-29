/**
 * Adverse-impact analysis for job benchmarks.
 *
 * Implements the Uniform Guidelines on Employee Selection Procedures
 * (29 CFR 1607) four-fifths screen: a selection rate for any group that is
 * less than 80% of the rate of the highest-scoring group is generally
 * regarded as evidence of adverse impact.
 *
 * Two deliberate honesty constraints, both from §1607.4(D):
 *  - The four-fifths rule is a SCREEN, not a verdict. Smaller differences
 *    can still be adverse impact when significant in statistical and
 *    practical terms, and a passing ratio on tiny samples means nothing.
 *  - Groups below a minimum size are reported as "insufficient data" rather
 *    than given a ratio that reads as reassurance.
 *
 * Everything here is pure and aggregate. No function in this module accepts
 * or returns an individual candidate's demographic data.
 */

/** Groups smaller than this get no ratio — the number would be noise. */
export const MIN_GROUP_SIZE = 5;

/** Below this total, the whole analysis is treated as preliminary. */
export const MIN_TOTAL_FOR_ANALYSIS = 30;

/** The conventional four-fifths (80%) threshold. */
export const FOUR_FIFTHS = 0.8;

export interface GroupOutcome {
  /** Aggregate label, e.g. "Female" or "Two or more races". */
  group: string;
  applicants: number;
  selected: number;
}

export interface GroupImpact extends GroupOutcome {
  selectionRate: number | null;
  /** Selection rate ÷ highest group's rate. Null when not computable. */
  impactRatio: number | null;
  status: "OK" | "BELOW_FOUR_FIFTHS" | "INSUFFICIENT_DATA" | "REFERENCE";
}

export interface ImpactAnalysis {
  category: string;
  totalApplicants: number;
  totalSelected: number;
  overallSelectionRate: number | null;
  groups: GroupImpact[];
  /** True when any sufficiently-sized group falls below four-fifths. */
  flagged: boolean;
  /** True when the sample is too small to draw conclusions from. */
  preliminary: boolean;
  notes: string[];
}

export function selectionRate(o: GroupOutcome): number | null {
  if (o.applicants <= 0) return null;
  return o.selected / o.applicants;
}

/**
 * Compute impact ratios for one demographic category (e.g. sex, race).
 * The reference group is the one with the highest selection rate among
 * groups that meet the minimum size, per the Uniform Guidelines.
 */
export function analyzeCategory(
  category: string,
  outcomes: GroupOutcome[],
): ImpactAnalysis {
  const totalApplicants = outcomes.reduce((n, o) => n + o.applicants, 0);
  const totalSelected = outcomes.reduce((n, o) => n + o.selected, 0);
  const notes: string[] = [];

  const eligible = outcomes.filter((o) => o.applicants >= MIN_GROUP_SIZE);
  const excluded = outcomes.filter(
    (o) => o.applicants > 0 && o.applicants < MIN_GROUP_SIZE,
  );
  if (excluded.length > 0) {
    notes.push(
      `${excluded.length} group(s) had fewer than ${MIN_GROUP_SIZE} candidates and are reported without a ratio.`,
    );
  }

  const rates = eligible
    .map((o) => ({ o, rate: selectionRate(o) }))
    .filter((r): r is { o: GroupOutcome; rate: number } => r.rate !== null);
  const highest = rates.reduce<number | null>(
    (max, r) => (max === null || r.rate > max ? r.rate : max),
    null,
  );
  const referenceGroup =
    highest !== null ? rates.find((r) => r.rate === highest)?.o.group : undefined;

  const groups: GroupImpact[] = outcomes.map((o) => {
    const rate = selectionRate(o);
    if (o.applicants < MIN_GROUP_SIZE) {
      return {
        ...o,
        selectionRate: rate,
        impactRatio: null,
        status: "INSUFFICIENT_DATA",
      };
    }
    if (rate === null || highest === null || highest === 0) {
      return { ...o, selectionRate: rate, impactRatio: null, status: "INSUFFICIENT_DATA" };
    }
    const ratio = rate / highest;
    if (o.group === referenceGroup) {
      return { ...o, selectionRate: rate, impactRatio: 1, status: "REFERENCE" };
    }
    return {
      ...o,
      selectionRate: rate,
      impactRatio: ratio,
      status: ratio < FOUR_FIFTHS ? "BELOW_FOUR_FIFTHS" : "OK",
    };
  });

  const flagged = groups.some((g) => g.status === "BELOW_FOUR_FIFTHS");
  const preliminary = totalApplicants < MIN_TOTAL_FOR_ANALYSIS;
  if (preliminary) {
    notes.push(
      `Only ${totalApplicants} candidates have completed with self-identification on file. Treat these figures as preliminary — the four-fifths screen is not meaningful at this sample size.`,
    );
  }
  if (flagged && !preliminary) {
    notes.push(
      "One or more groups fall below the four-fifths threshold at these benchmark settings. This is a signal to review job-relatedness, not a finding of discrimination.",
    );
  }

  return {
    category,
    totalApplicants,
    totalSelected,
    overallSelectionRate:
      totalApplicants > 0 ? totalSelected / totalApplicants : null,
    groups,
    flagged,
    preliminary,
    notes,
  };
}

/** A candidate's banded scores, used to test a benchmark without re-scoring. */
export interface CandidateBands {
  attemptId: string;
  bands: Record<string, number>;
  /** Opaque link to voluntary self-identification, when present. */
  demographics?: Record<string, string> | null;
}

export interface BenchmarkRule {
  construct: string;
  minScore: number;
  maxScore: number;
  enabled: boolean;
  required: boolean;
}

/**
 * Would this candidate meet the benchmark?
 *
 * "Meeting the benchmark" means every REQUIRED, enabled dimension falls in
 * its desired range. Optional dimensions inform interpretation but never
 * screen anyone out — which matches how the reports present them.
 */
export function meetsBenchmark(
  candidate: CandidateBands,
  rules: BenchmarkRule[],
): boolean {
  const required = rules.filter((r) => r.enabled && r.required);
  if (required.length === 0) return true;
  return required.every((r) => {
    const band = candidate.bands[r.construct];
    if (band === undefined) return false;
    return band >= r.minScore && band <= r.maxScore;
  });
}

export interface PoolPreview {
  total: number;
  passing: number;
  passRate: number | null;
  /** Dimensions most often responsible for a candidate not qualifying. */
  limitingFactors: { construct: string; excluded: number }[];
}

/**
 * How the current benchmark would screen the candidates already assessed
 * for this role. Works with zero demographic data, and is the fastest way
 * to notice a benchmark nobody can meet.
 */
export function previewPool(
  candidates: CandidateBands[],
  rules: BenchmarkRule[],
): PoolPreview {
  const required = rules.filter((r) => r.enabled && r.required);
  let passing = 0;
  const excludedBy = new Map<string, number>();

  for (const c of candidates) {
    if (meetsBenchmark(c, rules)) {
      passing++;
      continue;
    }
    for (const r of required) {
      const band = c.bands[r.construct];
      if (band === undefined || band < r.minScore || band > r.maxScore) {
        excludedBy.set(r.construct, (excludedBy.get(r.construct) ?? 0) + 1);
      }
    }
  }

  return {
    total: candidates.length,
    passing,
    passRate: candidates.length > 0 ? passing / candidates.length : null,
    limitingFactors: [...excludedBy.entries()]
      .map(([construct, excluded]) => ({ construct, excluded }))
      .sort((a, b) => b.excluded - a.excluded)
      .slice(0, 5),
  };
}

/** Group assessed candidates by a demographic key and score the benchmark. */
export function outcomesByCategory(
  candidates: CandidateBands[],
  rules: BenchmarkRule[],
  categoryKey: string,
): GroupOutcome[] {
  const byGroup = new Map<string, { applicants: number; selected: number }>();
  for (const c of candidates) {
    const value = c.demographics?.[categoryKey];
    // Candidates who declined to answer are excluded from impact analysis
    // entirely — they are not a demographic group.
    if (!value || value === "DECLINE") continue;
    const row = byGroup.get(value) ?? { applicants: 0, selected: 0 };
    row.applicants++;
    if (meetsBenchmark(c, rules)) row.selected++;
    byGroup.set(value, row);
  }
  return [...byGroup.entries()]
    .map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => b.applicants - a.applicants);
}
