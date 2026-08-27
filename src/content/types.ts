/**
 * Shared types for FSW WorkFit assessment content.
 *
 * Every question, statement, and exercise in the platform is ORIGINAL
 * FSW Group content. Nothing in these banks may be copied from any
 * third-party assessment instrument.
 *
 * Content files under src/content/banks conform to these types and are
 * loaded by the database seed, which snapshots each item into an
 * immutable QuestionVersion row.
 */

/** Six mental-aptitude constructs. */
export const APTITUDE_CONSTRUCTS = [
  "MENTAL_ACUITY",
  "BUSINESS_TERMS",
  "AWARENESS_MEMORY",
  "VOCABULARY",
  "NUMERICAL_PERCEPTION",
  "MECHANICAL_INTEREST",
] as const;
export type AptitudeConstruct = (typeof APTITUDE_CONSTRUCTS)[number];

/** Ten behavioral / performance constructs. */
export const BEHAVIORAL_CONSTRUCTS = [
  "ENERGY",
  "FLEXIBILITY",
  "ORGANIZATION",
  "COMMUNICATION",
  "EMOTIONAL_DEVELOPMENT",
  "ASSERTIVENESS",
  "COMPETITIVENESS",
  "MENTAL_TOUGHNESS",
  "QUESTIONING_PROBING",
  "MOTIVATION",
] as const;
export type BehavioralConstruct = (typeof BEHAVIORAL_CONSTRUCTS)[number];

/** Response-quality (validity) indicators. Not job-fit dimensions. */
export const VALIDITY_CONSTRUCTS = ["DISTORTION", "EQUIVOCATION"] as const;
export type ValidityConstruct = (typeof VALIDITY_CONSTRUCTS)[number];

export type Construct =
  | AptitudeConstruct
  | BehavioralConstruct
  | ValidityConstruct;

/** 1 = easy, 2 = medium, 3 = hard. */
export type Difficulty = 1 | 2 | 3;

/**
 * A multiple-choice cognitive/aptitude item.
 *
 * `explanation` is an admin-facing rationale used during question review.
 * It is NEVER sent to candidates and never appears in candidate payloads.
 */
export interface AptitudeItem {
  construct: Exclude<AptitudeConstruct, "MECHANICAL_INTEREST">;
  /** Free-form family tag, e.g. "verbal_analogy", "number_series". */
  subtype: string;
  difficulty: Difficulty;
  prompt: string;
  choices: string[]; // 4-5 options
  correctIndex: number; // index into choices
  explanation?: string;
}

/**
 * A memory exercise: a short study passage presented for a fixed time,
 * followed later in the section by recall questions about it.
 */
export interface MemoryExercise {
  /** Stable key, e.g. "mem_vendor_delivery". */
  key: string;
  title: string;
  /** The studied material. Plain text; short paragraphs allowed. */
  stimulus: string;
  /** How long the study card is displayed, in seconds. */
  studySeconds: number;
  /** 2-4 recall questions. subtype must be "memory_recall". */
  questions: AptitudeItem[];
}

/**
 * An agree/disagree statement scored on a 5-point Likert scale.
 * Used for the behavioral inventory and for Mechanical Interest.
 */
export interface StatementItem {
  construct: BehavioralConstruct | "MECHANICAL_INTEREST" | "DISTORTION";
  /** The statement shown to the candidate. */
  text: string;
  /**
   * false: Strongly Agree scores high on the construct.
   * true: Strongly Agree scores LOW on the construct (reverse-coded).
   */
  reverseCoded: boolean;
  /**
   * Items sharing a pairKey are semantically related and are used by the
   * equivocation/consistency check. Set `pairPolarity` to "same" when both
   * items should be answered in the same direction after reverse-coding,
   * which is the normal case.
   */
  pairKey?: string;
  /**
   * Marks an impression-management item ("improbably perfect behavior").
   * These contribute to the DISTORTION indicator, not to trait scores,
   * and must use construct "DISTORTION".
   */
  impressionManagement?: boolean;
}

/** Bank container types so files stay self-describing. */
export interface AptitudeBank {
  construct: AptitudeConstruct;
  items: AptitudeItem[];
}

export interface StatementBank {
  items: StatementItem[];
}

export interface MemoryBank {
  exercises: MemoryExercise[];
  /** Ordinary awareness/concept questions for the same section. */
  items: AptitudeItem[];
}
