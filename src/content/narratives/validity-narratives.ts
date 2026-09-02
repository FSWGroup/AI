/**
 * FSW Talent Scout — narratives for the two response-quality (validity) indicators.
 *
 * Original FSW Group content. These indicators describe how the candidate
 * approached the questionnaire and how much interpretive confidence the
 * behavioral profile supports. They are never presented as evidence about
 * the candidate's character, and the language below deliberately avoids
 * any accusation — per the LANGUAGE RULES in ../narrative-types.ts.
 */

import type { ValidityNarrativeSet } from "../narrative-types";

export const validityNarratives: ValidityNarrativeSet[] = [
  {
    construct: "DISTORTION",
    levels: {
      normal:
        "The candidate's pattern of self-description falls within the typical range for employment settings. There is no indication of unusually idealized responding, and the behavioral results can be read at face value with ordinary professional judgment.",
      elevated:
        "Responses show a somewhat elevated tendency to endorse very favorable self-descriptions. Some positive self-presentation is common in a hiring context, so this pattern is not unusual; even so, the behavioral scores may sit slightly closer to the middle than reported. Weigh the behavioral results together with interview evidence rather than in isolation.",
      high:
        "Responses show an elevated impression-management pattern: the candidate endorsed a number of improbably favorable self-descriptions. This is a response-style indicator, not a judgment of the candidate's character, and it can also reflect strong eagerness for the position or an unusually uncritical self-view. Interpret behavioral results with additional caution, and give structured interview questions and reference information greater weight when forming conclusions.",
    },
  },
  {
    construct: "EQUIVOCATION",
    levels: {
      normal:
        "The candidate differentiated clearly among the response options and answered related statements consistently. The behavioral profile can be interpreted with normal confidence.",
      elevated:
        "The candidate made somewhat heavy use of neutral response options, or answered some related statements in different directions. This tends to flatten the profile: actual preferences may be stronger than the mid-range scores suggest. Treat the behavioral scores as approximate and use the interview to sharpen the picture.",
      high:
        "The response pattern shows heavy reliance on neutral options and noticeable inconsistency between related statements, producing low differentiation across the behavioral scales. A pattern like this says more about how the candidate approached the questionnaire — possibly caution, ambivalence, hurried reading, or fatigue — than about their working style. Interpretation confidence is reduced: treat the behavioral profile as tentative and place greater weight on structured interview evidence.",
    },
  },
];
