/**
 * Types for the FSW Talent Scout deterministic narrative engine.
 *
 * Narratives are version-controlled template content, seeded into the
 * database with a version stamp. Reports record the narrative version they
 * were generated with so historical reports remain reproducible.
 *
 * LANGUAGE RULES (apply to every string in these files):
 *  - Probabilistic, work-related phrasing: "Results suggest…",
 *    "The response pattern is consistent with…", "This may indicate…".
 *  - Never absolute claims ("this person will…", "cannot…").
 *  - No medical, psychiatric, or diagnostic language.
 *  - Never accuse a candidate of dishonesty or cheating.
 *  - All text is original FSW Group content.
 */

import type { Construct, ValidityConstruct } from "./types";

export type DimensionCategory = "APTITUDE" | "BEHAVIORAL" | "VALIDITY";

/** Display metadata for one assessed dimension. */
export interface DimensionMeta {
  construct: Construct;
  name: string;
  /** One or two sentences describing what the dimension measures. */
  shortDefinition: string;
  /** Score-sheet left anchor (low end), 1-3 words, e.g. "Deliberate pace". */
  lowDescriptor: string;
  /** Score-sheet right anchor (high end), 1-3 words. */
  highDescriptor: string;
  category: DimensionCategory;
}

/**
 * Nine band narratives (index 0 = band 1 "very low" … index 8 = band 9
 * "very high") plus range-position addenda relative to the job benchmark.
 */
export interface NarrativeSet {
  construct: Construct;
  /** Exactly 9 entries. Each 2-4 sentences, candidate-neutral ("the candidate"). */
  bandNarratives: string[];
  rangePosition: {
    /** Appended when the score falls below the desired role range. */
    below: string;
    /** Appended when the score falls within the desired role range. */
    within: string;
    /** Appended when the score falls above the desired role range. */
    above: string;
  };
}

/** Narratives for the two response-quality indicators. */
export interface ValidityNarrativeSet {
  construct: ValidityConstruct;
  levels: {
    /** Typical response pattern; no interpretive caution needed. */
    normal: string;
    /** Somewhat elevated; interpret with added care. */
    elevated: string;
    /** Clearly elevated; interpret behavioral results with additional caution. */
    high: string;
  };
}

export type InterviewFocus = "BELOW_RANGE" | "ABOVE_RANGE" | "VALIDITY";

export interface InterviewQuestionEntry {
  /** Behavioral interview question asking for a real past example. */
  question: string;
  /**
   * Alternate wording for candidates with limited work history,
   * referencing school, volunteering, sports, projects, or community work.
   */
  altWording: string;
  /**
   * Employer-only guidance: what the interviewer should listen for.
   * Not a simplistic "correct answer".
   */
  listenFor: string;
}

export interface InterviewTemplate {
  construct: Construct;
  focus: InterviewFocus;
  /** What this dimension measures, phrased for the interview guide. */
  measures: string;
  /** 3-5 entries. */
  questions: InterviewQuestionEntry[];
}

export interface DevelopmentTemplate {
  construct: Construct;
  /**
   * Concrete, practical development actions (no self-help fluff,
   * no medical advice). 4-7 items, each a single actionable sentence.
   */
  recommendations: string[];
}
