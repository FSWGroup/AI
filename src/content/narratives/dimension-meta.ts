/**
 * FSW WorkFit — display metadata for all assessed dimensions.
 *
 * Original FSW Group content. Definitions and score-sheet anchors follow
 * the LANGUAGE RULES in ../narrative-types.ts: probabilistic, work-related,
 * non-clinical, and neutral in tone. For dimensions where neither pole is
 * preferable in itself (e.g. Competitiveness, Motivation), both anchors are
 * deliberately non-evaluative.
 */

import type { DimensionMeta } from "../narrative-types";

export const dimensionMeta: DimensionMeta[] = [
  // ---------------------------------------------------------------- APTITUDE
  {
    construct: "MENTAL_ACUITY",
    name: "Mental Acuity",
    shortDefinition:
      "Reflects how readily the candidate works through novel problems, spots patterns, and draws sound conclusions from new information under time limits. Higher results are consistent with faster uptake of novel material; lower results are consistent with a more deliberate learning pace.",
    lowDescriptor: "Deliberate learner",
    highDescriptor: "Rapid uptake",
    category: "APTITUDE",
  },
  {
    construct: "BUSINESS_TERMS",
    name: "Business Terms",
    shortDefinition:
      "Reflects working knowledge of everyday commercial vocabulary and workplace concepts. Because this dimension is shaped by exposure to business settings, results often shift with experience.",
    lowDescriptor: "Developing fluency",
    highDescriptor: "Fluent usage",
    category: "APTITUDE",
  },
  {
    construct: "AWARENESS_MEMORY",
    name: "Business & World Awareness / Memory",
    shortDefinition:
      "Reflects attentiveness to the wider business and world environment together with short-term retention of newly presented information. Results relate to how reliably briefed details survive from instruction to execution.",
    lowDescriptor: "Reference-supported recall",
    highDescriptor: "Ready recall",
    category: "APTITUDE",
  },
  {
    construct: "VOCABULARY",
    name: "Vocabulary",
    shortDefinition:
      "Reflects the breadth of general word knowledge and precision in distinguishing between similar words. Results relate to comfort with written material and to precision in the candidate's own written and spoken expression.",
    lowDescriptor: "Everyday wording",
    highDescriptor: "Wide word range",
    category: "APTITUDE",
  },
  {
    construct: "NUMERICAL_PERCEPTION",
    name: "Numerical Perception",
    shortDefinition:
      "Reflects speed and accuracy in scanning, comparing, and checking numerical detail such as codes, quantities, and totals. It concerns perceptual accuracy with figures, not advanced mathematical reasoning.",
    lowDescriptor: "Unhurried checking",
    highDescriptor: "Rapid number scanning",
    category: "APTITUDE",
  },
  {
    construct: "MECHANICAL_INTEREST",
    name: "Mechanical Interest",
    shortDefinition:
      "Reflects the degree of expressed interest in tools, machinery, and how physical things work. This dimension measures interest and preference only — it is not a measure of mechanical ability or skill.",
    lowDescriptor: "Other interests",
    highDescriptor: "Hands-on draw",
    category: "APTITUDE",
  },

  // -------------------------------------------------------------- BEHAVIORAL
  {
    construct: "ENERGY",
    name: "Energy",
    shortDefinition:
      "Reflects the candidate's self-described activity level and preferred working tempo. Results relate to comfort with fast-moving, high-volume days versus a steadier, more measured rhythm.",
    lowDescriptor: "Measured tempo",
    highDescriptor: "High tempo",
    category: "BEHAVIORAL",
  },
  {
    construct: "FLEXIBILITY",
    name: "Flexibility",
    shortDefinition:
      "Reflects reported comfort with shifting priorities, changed plans, and new methods. Lower results are consistent with a preference for stable, settled ways of working; higher results with ease amid frequent change.",
    lowDescriptor: "Consistency preference",
    highDescriptor: "Change-ready",
    category: "BEHAVIORAL",
  },
  {
    construct: "ORGANIZATION",
    name: "Organization",
    shortDefinition:
      "Reflects the reported tendency to plan work in advance, keep materials and records in order, and follow through on details in a structured way rather than improvising as tasks arise.",
    lowDescriptor: "Improvised approach",
    highDescriptor: "Planful",
    category: "BEHAVIORAL",
  },
  {
    construct: "COMMUNICATION",
    name: "Communication",
    shortDefinition:
      "Reflects reported ease and willingness in expressing ideas, initiating conversation, and engaging with new people. It describes outgoing expressiveness, not the quality or accuracy of what is communicated.",
    lowDescriptor: "Reserved",
    highDescriptor: "Expressive",
    category: "BEHAVIORAL",
  },
  {
    construct: "EMOTIONAL_DEVELOPMENT",
    name: "Emotional Development",
    shortDefinition:
      "Reflects reported composure, self-assurance, and steadiness of outlook in everyday work situations. This is a work-style dimension describing how the candidate says they typically respond to pressure and uncertainty; it is not a clinical measure of any kind.",
    lowDescriptor: "Self-questioning",
    highDescriptor: "Settled confidence",
    category: "BEHAVIORAL",
  },
  {
    construct: "ASSERTIVENESS",
    name: "Assertiveness",
    shortDefinition:
      "Reflects the reported readiness to state positions directly, make requests, and hold a point of view when others disagree. Lower results are consistent with an accommodating style; higher results with a direct one.",
    lowDescriptor: "Accommodating",
    highDescriptor: "Direct",
    category: "BEHAVIORAL",
  },
  {
    construct: "COMPETITIVENESS",
    name: "Competitiveness",
    shortDefinition:
      "Reflects where the candidate reports drawing satisfaction: from shared group results or from personally outperforming others. Neither orientation is stronger in itself — the practical question is which one the role and its reward structure suit.",
    lowDescriptor: "Team-outcome focus",
    highDescriptor: "Individual-win focus",
    category: "BEHAVIORAL",
  },
  {
    construct: "MENTAL_TOUGHNESS",
    name: "Mental Toughness",
    shortDefinition:
      "Reflects reported resilience to setbacks, criticism, and rejection in the course of work. Results relate to how quickly the candidate says they regroup after a difficult interaction or outcome.",
    lowDescriptor: "Feels setbacks deeply",
    highDescriptor: "Rebounds quickly",
    category: "BEHAVIORAL",
  },
  {
    construct: "QUESTIONING_PROBING",
    name: "Questioning / Probing",
    shortDefinition:
      "Reflects the reported inclination to ask follow-up questions, look beneath surface answers, and verify information before accepting it. Lower results are consistent with taking information as given; higher results with an investigative habit.",
    lowDescriptor: "Takes at face value",
    highDescriptor: "Probing",
    category: "BEHAVIORAL",
  },
  {
    construct: "MOTIVATION",
    name: "Motivation",
    shortDefinition:
      "Reflects the reported source of the candidate's drive — whether effort tends to be self-sustaining or is energized by external recognition, incentives, and encouragement. Neither pattern is preferable in itself; fit depends on what the role and its management style provide.",
    lowDescriptor: "Self-sustained drive",
    highDescriptor: "Recognition-energized",
    category: "BEHAVIORAL",
  },

  // ---------------------------------------------------------------- VALIDITY
  {
    construct: "DISTORTION",
    name: "Distortion / Impression Management",
    shortDefinition:
      "A response-quality indicator reflecting how strongly the candidate endorsed improbably favorable self-descriptions. It signals how much interpretive caution to use when reading the behavioral results; it is not a job-fit dimension and is not, by itself, an indication of poor character or untruthfulness.",
    lowDescriptor: "Candid self-report",
    highDescriptor: "Idealized self-report",
    category: "VALIDITY",
  },
  {
    construct: "EQUIVOCATION",
    name: "Equivocation",
    shortDefinition:
      "A response-quality indicator reflecting heavy use of neutral answer options and inconsistency between related statements. It describes how clearly the behavioral profile can be interpreted — not the candidate's character — and elevated results call for added weight on interview evidence.",
    lowDescriptor: "Definite responding",
    highDescriptor: "Neutral responding",
    category: "VALIDITY",
  },
];
