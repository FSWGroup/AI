/**
 * Retention signals.
 *
 * THE RULE THAT SHAPES THIS FILE: every input is something the employer
 * controls or has already decided. Nothing here is a characteristic of the
 * person.
 *
 * That is not a stylistic preference. A model that learns "people like this
 * leave" will happily learn a protected characteristic as a proxy, and an
 * employer acting on that output is discriminating whether or not anybody
 * intended to. So this is deliberately NOT a model. It is a short list of
 * named, job-related conditions — no pay rise in two years, pay below band,
 * no manager conversation in a quarter — each of which is (a) visible to the
 * person it describes, (b) explainable in a sentence, and (c) fixable by the
 * company.
 *
 * `RetentionFacts` is the whole input surface. Age, date of birth, gender,
 * ethnicity, national origin, marital or family status, disability,
 * pregnancy, religion and veteran status are absent by construction — the
 * type cannot carry them, the query never selects them, and a test asserts
 * this file never mentions them.
 *
 * What the output is for: a prompt for a retention conversation, a pay
 * review, or a manager check-in. It is never a basis for adverse action, and
 * the UI says so where it is displayed.
 *
 * Pure functions, no database and no `server-only`, so the rules are directly
 * testable.
 */

export interface RetentionFacts {
  /** Months since the worker's most recent compensation change of any kind. */
  monthsSinceLastPayChange: number | null;
  /** Current pay ÷ band midpoint. Null when no band is defined for the role. */
  compaRatio: number | null;
  /** True when current pay is below the band minimum for the role. */
  belowBandMinimum: boolean;
  /** Months in the current title without a level or title change. */
  monthsInCurrentRole: number | null;
  /** Direct reports the worker's manager carries. */
  managerSpan: number | null;
  /** Manager changes in the last twelve months. */
  managerChanges12mo: number;
  /** Days since the last recorded 1:1 with their manager; null if never. */
  daysSinceLastOneOnOne: number | null;
  /** Training assignments past their due date. */
  overdueTrainings: number;
  /** Approved PTO days taken in the last twelve months. */
  ptoDaysTaken12mo: number;
  /** Total tenure in months. */
  tenureMonths: number;
}

export interface RetentionFactor {
  id: string;
  label: string;
  /** What the company could do about it. Every factor must have an answer. */
  suggestion: string;
  points: number;
}

export interface RetentionSignal {
  score: number;
  band: 'LOW' | 'MODERATE' | 'ELEVATED';
  factors: RetentionFactor[];
}

/**
 * The complete rule set. Weights are judgement, not fitted parameters — they
 * are deliberately round numbers so nobody mistakes this for a trained model.
 */
const RULES: {
  id: string;
  label: (f: RetentionFacts) => string;
  suggestion: string;
  points: number;
  applies: (f: RetentionFacts) => boolean;
}[] = [
  {
    id: 'no_pay_change',
    label: (f) => `No pay change in ${f.monthsSinceLastPayChange} months`,
    suggestion: 'Review against the band and the market at the next comp cycle.',
    points: 25,
    applies: (f) => (f.monthsSinceLastPayChange ?? 0) >= 24,
  },
  {
    id: 'pay_stale',
    label: (f) => `No pay change in ${f.monthsSinceLastPayChange} months`,
    suggestion: 'Confirm this is intentional before the next cycle closes.',
    points: 10,
    applies: (f) => {
      const m = f.monthsSinceLastPayChange ?? 0;
      return m >= 18 && m < 24;
    },
  },
  {
    id: 'below_band',
    label: () => 'Paid below the minimum of their band',
    suggestion: 'Bring to band minimum, or correct the band if the role has changed.',
    points: 30,
    applies: (f) => f.belowBandMinimum,
  },
  {
    id: 'low_in_band',
    label: (f) => `Low in band (compa-ratio ${f.compaRatio?.toFixed(2)})`,
    suggestion: 'Check the pay position is justified by scope and time in role.',
    points: 12,
    applies: (f) => f.compaRatio !== null && !f.belowBandMinimum && f.compaRatio < 0.85,
  },
  {
    id: 'long_in_role',
    label: (f) => `${Math.floor((f.monthsInCurrentRole ?? 0) / 12)} years in the same role`,
    suggestion: 'Discuss a development path, a scope change, or a promotion case.',
    points: 15,
    applies: (f) => (f.monthsInCurrentRole ?? 0) >= 36,
  },
  {
    id: 'manager_churn',
    label: (f) => `${f.managerChanges12mo} manager changes in a year`,
    suggestion: 'Stabilise the reporting line and re-establish a regular 1:1.',
    points: 15,
    applies: (f) => f.managerChanges12mo >= 2,
  },
  {
    id: 'wide_span',
    label: (f) => `Manager carries ${f.managerSpan} direct reports`,
    suggestion: 'Consider a team split or a lead role — attention per person is thin.',
    points: 10,
    applies: (f) => (f.managerSpan ?? 0) > 12,
  },
  {
    id: 'no_one_on_one',
    label: (f) =>
      f.daysSinceLastOneOnOne === null
        ? 'No 1:1 has ever been recorded'
        : `No 1:1 recorded in ${f.daysSinceLastOneOnOne} days`,
    suggestion: 'Book a conversation. This is the cheapest item on the list.',
    points: 15,
    applies: (f) => f.daysSinceLastOneOnOne === null || f.daysSinceLastOneOnOne >= 90,
  },
  {
    id: 'no_pto',
    label: (f) => `Only ${f.ptoDaysTaken12mo} days of leave taken in a year`,
    suggestion: 'Encourage time off — sustained non-use runs ahead of burnout.',
    points: 12,
    // Only meaningful once someone has been here long enough to have taken any.
    applies: (f) => f.tenureMonths >= 12 && f.ptoDaysTaken12mo <= 3,
  },
  {
    id: 'overdue_training',
    label: (f) => `${f.overdueTrainings} training assignments overdue`,
    suggestion: 'Usually a workload signal rather than a compliance one — ask.',
    points: 8,
    applies: (f) => f.overdueTrainings >= 2,
  },
  {
    id: 'first_year',
    label: () => 'Inside their first year',
    suggestion: 'Most voluntary exits happen here. Keep onboarding check-ins running.',
    points: 8,
    applies: (f) => f.tenureMonths < 12,
  },
];

export function retentionSignal(facts: RetentionFacts): RetentionSignal {
  const factors: RetentionFactor[] = [];
  for (const rule of RULES) {
    if (rule.applies(facts)) {
      factors.push({ id: rule.id, label: rule.label(facts), suggestion: rule.suggestion, points: rule.points });
    }
  }
  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  const band = score >= 50 ? 'ELEVATED' : score >= 25 ? 'MODERATE' : 'LOW';
  return { score, band, factors: factors.sort((a, b) => b.points - a.points) };
}

/** Every rule id, so the UI and the tests can enumerate what exists. */
export const RETENTION_RULE_IDS = RULES.map((r) => r.id);
