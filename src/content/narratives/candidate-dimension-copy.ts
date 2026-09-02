/**
 * FSW Talent Scout — dimension descriptions written for the candidate.
 *
 * Original FSW Group content. The employer-facing `shortDefinition` in
 * dimension-meta.ts is written *about* a candidate ("Reflects the candidate's
 * reported tendency to..."), which reads coldly when handed to the person it
 * describes, and its talk of "higher results" and "lower results" invites
 * exactly the score-hunting the candidate report is designed to avoid.
 *
 * So these are separate copy, not a transformation of that text. Each one:
 *  - addresses the reader directly,
 *  - says what the section asked about rather than what it predicts,
 *  - and, for the behavioral dimensions, treats both poles as legitimate,
 *    because in those dimensions neither pole is better in itself.
 *
 * They follow the same LANGUAGE RULES as the rest of the content: work-
 * related, non-clinical, and probabilistic rather than definitive.
 */

import type { Construct } from "../types";

export interface CandidateDimensionCopy {
  /** What the section asked about, addressed to the reader. */
  about: string;
  /** Noun phrases that read inside "your responses lean toward ___". The
   *  score-sheet anchors in dimension-meta.ts are labels, not sentence
   *  fragments, so they cannot be reused here. */
  low: string;
  high: string;
}

export const candidateDimensionCopy: Partial<
  Record<Construct, CandidateDimensionCopy>
> = {
  // ---------------------------------------------------------------- APTITUDE
  MENTAL_ACUITY: {
    about:
      "How you work through unfamiliar problems and spot patterns when the material is new and the clock is running.",
    low: "a more deliberate pace with new material",
    high: "quick uptake of new material",
  },
  BUSINESS_TERMS: {
    about:
      "How familiar everyday commercial vocabulary and workplace concepts are to you. This one moves with exposure — people who have spent more time in business settings tend to have seen more of it.",
    low: "business language you are still building",
    high: "fluency with business language",
  },
  AWARENESS_MEMORY: {
    about:
      "How much of what you were shown stayed with you, and how much attention you pay to the wider business world.",
    low: "recall that leans on notes and references",
    high: "ready recall of what you were shown",
  },
  VOCABULARY: {
    about:
      "The range of words you recognize and how finely you distinguish between similar ones.",
    low: "everyday, plain wording",
    high: "a wide range of words",
  },
  NUMERICAL_PERCEPTION: {
    about:
      "How quickly and accurately you scan and compare figures — codes, quantities, totals. This is about catching detail, not doing advanced math.",
    low: "unhurried, careful checking of figures",
    high: "quick, accurate work with figures",
  },
  MECHANICAL_INTEREST: {
    about:
      "How drawn you are to tools, machinery, and how physical things work. This is a measure of interest, not of skill — it says nothing about how capable you are with your hands.",
    low: "interests that lie elsewhere",
    high: "a hands-on pull toward how things work",
  },

  // -------------------------------------------------------------- BEHAVIORAL
  ENERGY: {
    about:
      "The working tempo you said suits you — fast-moving and high-volume, or steadier and more measured.",
    low: "a steadier, more measured pace",
    high: "a fast, high-volume pace",
  },
  FLEXIBILITY: {
    about:
      "How you said you prefer to handle shifting priorities and changed plans, versus settled and predictable ways of working.",
    low: "settled, predictable ways of working",
    high: "readiness for shifting plans",
  },
  ORGANIZATION: {
    about:
      "Whether you said you tend to plan and structure work in advance, or work things out as they arise.",
    low: "working things out as they arise",
    high: "planning and structure set up in advance",
  },
  COMMUNICATION: {
    about:
      "How readily you said you speak up, start conversations, and engage with new people. It is about outgoingness, not about how well you communicate.",
    low: "a reserved style",
    high: "an outgoing, expressive style",
  },
  EMOTIONAL_DEVELOPMENT: {
    about:
      "How you said you typically meet pressure and uncertainty at work. This is a working-style question — it is not a measure of mental health of any kind.",
    low: "weighing yourself critically before you commit",
    high: "settled confidence under pressure",
  },
  ASSERTIVENESS: {
    about:
      "How directly you said you state a position and hold it when others disagree, versus looking for accommodation.",
    low: "an accommodating approach",
    high: "a direct approach",
  },
  COMPETITIVENESS: {
    about:
      "Where you said your satisfaction comes from — the team's result, or personally coming out ahead. Neither is the better answer; they suit different roles.",
    low: "satisfaction drawn from the team's result",
    high: "satisfaction drawn from personally coming out ahead",
  },
  MENTAL_TOUGHNESS: {
    about:
      "How you said you tend to regroup after a setback, a rejection, or hard criticism.",
    low: "feeling setbacks keenly",
    high: "regrouping quickly after setbacks",
  },
  QUESTIONING_PROBING: {
    about:
      "How much you said you dig beneath a first answer and check things before accepting them, versus taking information as given.",
    low: "taking information as it is given",
    high: "digging beneath the first answer",
  },
  MOTIVATION: {
    about:
      "What you said keeps you going — your own internal drive, or recognition and encouragement from others. Both are ordinary; they just call for different kinds of management.",
    low: "drive that runs under its own steam",
    high: "drive that is powered by recognition",
  },
};
