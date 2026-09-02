/**
 * Post-hire performance criteria.
 *
 * These are the OUTCOME side of a validity study. The assessment measures
 * aptitudes and behavioral tendencies; these criteria measure what the person
 * actually did on the job. Keeping the two vocabularies separate is
 * deliberate — if the rating form asked a manager to rate "Mental Acuity",
 * the study would be correlating the test with a manager's memory of the
 * test, not with performance.
 *
 * Every anchor below is original FSW Group wording.
 *
 * The scale is 1-5 with behavioral anchors at every point. Five points with
 * a defined midpoint is right for a criterion measure: unlike an interview
 * scorecard, where a forced choice sharpens the decision, a performance
 * rating wants the rater's honest central tendency rather than a pushed one.
 */

export const PERFORMANCE_RATING_MIN = 1;
export const PERFORMANCE_RATING_MAX = 5;

export interface PerformanceCriterion {
  key: string;
  label: string;
  /// What the rater is being asked to judge, in one sentence.
  definition: string;
  /// Anchors for points 1, 3 and 5. Raters use 2 and 4 for "between these".
  anchors: { value: 1 | 3 | 5; text: string }[];
  /// Roles this criterion is usually relevant to. Advisory only — a cycle
  /// picks its own criteria.
  appliesTo: "ALL" | "SALES" | "LEADERSHIP";
}

export const PERFORMANCE_CRITERIA: PerformanceCriterion[] = [
  {
    key: "WORK_QUALITY",
    label: "Quality of work",
    definition:
      "Accuracy and completeness of the work this person delivers, before anyone else checks it.",
    anchors: [
      {
        value: 1,
        text: "Work usually needs correction before it can be used. Errors reach other people.",
      },
      {
        value: 3,
        text: "Work is generally sound. Occasional errors are caught in normal review.",
      },
      {
        value: 5,
        text: "Work can be relied on as delivered. Others use it without re-checking it.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "OUTPUT_VOLUME",
    label: "Volume of work",
    definition:
      "How much this person gets through relative to what the role expects.",
    anchors: [
      { value: 1, text: "Consistently behind what the role requires." },
      { value: 3, text: "Carries a full share of the workload." },
      {
        value: 5,
        text: "Carries more than a full share and absorbs overflow from others.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "RELIABILITY",
    label: "Reliability and follow-through",
    definition:
      "Whether commitments this person makes are commitments you can plan around.",
    anchors: [
      {
        value: 1,
        text: "Deadlines slip without warning. Follow-up is needed to find out where things stand.",
      },
      {
        value: 3,
        text: "Meets commitments; flags slippage in time for it to be handled.",
      },
      {
        value: 5,
        text: "Commitments are met or renegotiated early. Nothing is dropped silently.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "LEARNING_SPEED",
    label: "Speed of learning",
    definition:
      "How quickly this person became productive, and how quickly they take on something new now.",
    anchors: [
      {
        value: 1,
        text: "Needs the same explanation repeatedly. New tasks take much longer than expected.",
      },
      { value: 3, text: "Picks up new work at about the pace the role assumes." },
      {
        value: 5,
        text: "Learns new work with minimal instruction and starts improving it.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "PROBLEM_SOLVING",
    label: "Problem solving",
    definition:
      "What happens when this person hits something the procedure does not cover.",
    anchors: [
      {
        value: 1,
        text: "Stops and waits, or applies the usual approach where it does not fit.",
      },
      {
        value: 3,
        text: "Works through unfamiliar problems, escalating when genuinely stuck.",
      },
      {
        value: 5,
        text: "Diagnoses the actual cause and arrives with a workable answer, not just the problem.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "COMMUNICATION_EFFECTIVENESS",
    label: "Communication on the job",
    definition:
      "How well this person's spoken and written communication lands with the people who need it.",
    anchors: [
      {
        value: 1,
        text: "Messages are unclear or arrive too late to act on. Others translate for them.",
      },
      {
        value: 3,
        text: "Communicates clearly enough for the work to move without rework.",
      },
      {
        value: 5,
        text: "Explains complicated things simply, to the right people, at the right time.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "TEAMWORK",
    label: "Working with others",
    definition:
      "The effect this person has on the people around them getting their own work done.",
    anchors: [
      {
        value: 1,
        text: "Friction with colleagues costs time. Others route around them.",
      },
      { value: 3, text: "Works cooperatively; disagreements stay professional." },
      {
        value: 5,
        text: "Makes the team measurably better. People seek them out to work with.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "INITIATIVE",
    label: "Initiative",
    definition:
      "Work this person takes on without being assigned it.",
    anchors: [
      { value: 1, text: "Does what is assigned and stops there." },
      { value: 3, text: "Picks up obvious adjacent work without being asked." },
      {
        value: 5,
        text: "Identifies work nobody had noticed was needed, and does it.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "COMPOSURE",
    label: "Composure under pressure",
    definition:
      "How this person's work holds up when the day goes badly.",
    anchors: [
      {
        value: 1,
        text: "Quality or judgement drops noticeably under pressure. Pressure spreads to others.",
      },
      { value: 3, text: "Handles normal pressure without a drop in output." },
      {
        value: 5,
        text: "Steadiest in the hardest weeks. Others calm down around them.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "CUSTOMER_IMPACT",
    label: "Effect on customers",
    definition:
      "What customers, clients or internal partners experience when this person handles them.",
    anchors: [
      { value: 1, text: "Complaints or lost goodwill trace back to this person." },
      { value: 3, text: "Customers are served without incident." },
      {
        value: 5,
        text: "Customers ask for this person by name. Relationships grow around them.",
      },
    ],
    appliesTo: "ALL",
  },
  {
    key: "SALES_CONVERSION",
    label: "Converting opportunity to close",
    definition:
      "How much of what this person is given to work with turns into signed business.",
    anchors: [
      { value: 1, text: "Opportunities stall or are lost that others would close." },
      { value: 3, text: "Converts at about the rate the team does." },
      { value: 5, text: "Converts what others had written off." },
    ],
    appliesTo: "SALES",
  },
  {
    key: "PIPELINE_BUILDING",
    label: "Building pipeline",
    definition:
      "Whether this person generates their own opportunities or works only what they are handed.",
    anchors: [
      { value: 1, text: "Works only assigned leads. Pipeline depends entirely on others." },
      { value: 3, text: "Generates a reasonable share of their own opportunities." },
      { value: 5, text: "Creates pipeline the business would not otherwise have had." },
    ],
    appliesTo: "SALES",
  },
  {
    key: "DEVELOPING_OTHERS",
    label: "Developing other people",
    definition:
      "Whether the people reporting to this person get better while they report to them.",
    anchors: [
      { value: 1, text: "Direct reports stagnate or leave. Feedback is avoided." },
      { value: 3, text: "Gives feedback and their people improve at a normal rate." },
      { value: 5, text: "Has produced people who were promoted out of the team." },
    ],
    appliesTo: "LEADERSHIP",
  },
  {
    key: "DECISION_QUALITY",
    label: "Quality of decisions",
    definition:
      "Judged with hindsight: how the decisions this person owned turned out.",
    anchors: [
      { value: 1, text: "Decisions are avoided, or reversed once consequences appear." },
      { value: 3, text: "Decisions are sound and made in reasonable time." },
      { value: 5, text: "Makes the hard calls early and they hold up." },
    ],
    appliesTo: "LEADERSHIP",
  },
];

export const CRITERION_BY_KEY = new Map(
  PERFORMANCE_CRITERIA.map((c) => [c.key, c]),
);

/** The default rating set for a general cycle: nine criteria, all roles. */
export const DEFAULT_CYCLE_CRITERIA = PERFORMANCE_CRITERIA.filter(
  (c) => c.appliesTo === "ALL",
).map((c) => c.key);

export function criterionLabel(key: string): string {
  return CRITERION_BY_KEY.get(key)?.label ?? key;
}
