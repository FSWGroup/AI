/**
 * FSW WorkFit behavioral narrative set 1.
 *
 * Original FSW Group content. Covers the first five behavioral constructs:
 * ENERGY, FLEXIBILITY, ORGANIZATION, COMMUNICATION, EMOTIONAL_DEVELOPMENT.
 *
 * Follows the LANGUAGE RULES in narrative-types.ts: probabilistic,
 * work-related phrasing only; no absolute claims; no medical or
 * clinical wording; low bands describe preferences and likely
 * behavior, never deficiency of character.
 */

import type { NarrativeSet } from "../narrative-types";

export const behavioralNarratives1: NarrativeSet[] = [
  {
    construct: "ENERGY",
    bandNarratives: [
      // Band 1 — very low
      "The response pattern is consistent with a measured, unhurried approach to work. The candidate likely prefers a small number of tasks at a time and a workload that builds gradually rather than arriving all at once. Results suggest they may conserve effort for the tasks they see as most important rather than sustaining a fast pace across everything.",
      // Band 2
      "Results suggest the candidate tends toward a calm, steady working tempo. They may be most comfortable in roles where the pace is predictable and deadlines allow time to work through tasks one at a time. When the workload spikes, this candidate may prefer to extend timelines rather than accelerate.",
      // Band 3
      "The response pattern is consistent with a moderate-to-relaxed work pace. The candidate likely delivers dependable output in settings with a settled rhythm, and may take some time to build momentum on new or demanding assignments. Periods of sustained high demand may feel less comfortable than an even, planned workload.",
      // Band 4
      "Results suggest a work tempo slightly below the typical midpoint. The candidate appears able to raise their pace when a deadline or busy period calls for it, though they may prefer to return to a steadier rhythm afterward. This may indicate someone who paces effort deliberately rather than running at full speed by default.",
      // Band 5
      "The response pattern is consistent with a typical, adaptable level of drive. The candidate likely matches their pace to the demands of the situation, working faster during busy periods and settling into a sustainable rhythm the rest of the time. Results suggest a balanced trade between speed and staying power.",
      // Band 6
      "Results suggest the candidate brings somewhat more drive than most to their day-to-day work. They likely stay productive through moderately heavy workloads and tend to look for the next task rather than waiting for one to be assigned. This may indicate comfort in roles with a reasonably brisk operating tempo.",
      // Band 7
      "The response pattern is consistent with an energetic, self-propelled approach. The candidate likely takes on full workloads willingly, keeps several tasks moving at once, and recovers quickly after demanding stretches. Slow periods with little to do may leave them restless.",
      // Band 8
      "Results suggest a high level of drive and sustained effort. The candidate appears to seek out busy, fast-moving environments and likely maintains output through long or demanding periods that would tire many others. This may indicate impatience with roles or teams that move slowly.",
      // Band 9 — very high, includes watch-out
      "The response pattern is consistent with an exceptionally high-energy, high-output style. The candidate likely thrives on heavy workloads, pushes work forward constantly, and may set a pace that energizes those around them. A possible watch-out: this much momentum can favor speed over thoroughness, and the candidate may press ahead before details are fully checked or may find deliberate, methodical phases of work frustrating.",
    ],
    rangePosition: {
      below:
        "This score falls below the pace of activity the role typically calls for. Results suggest the candidate may need a more gradual ramp-up, or may find the role's sustained tempo demanding; an interview discussion of workload expectations is recommended.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's natural work pace is a reasonable match for the position's typical demands.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: the role's steadier tempo may leave this candidate under-stimulated, and their preferred pace may outrun the position's actual needs. Exploring how they handle slower periods is recommended.",
    },
  },
  {
    construct: "FLEXIBILITY",
    bandNarratives: [
      // Band 1 — very low
      "The response pattern is consistent with a strong preference for established methods and stable routines. The candidate likely does their best work when procedures are settled and expectations do not shift mid-task. Frequent changes of direction, tools, or priorities may feel disruptive, and they may advocate for keeping proven approaches in place.",
      // Band 2
      "Results suggest the candidate values consistency and predictability in how work is done. They likely follow defined processes closely and may want a clear rationale before changing an approach that has worked. This may indicate a good fit for roles built around standardized, repeatable work.",
      // Band 3
      "The response pattern is consistent with a preference for structure over variety. The candidate likely adapts to change when it is well explained and given time to settle, but may be slower to abandon well-practiced methods than most. Sudden or frequent shifts in direction may reduce their comfort and output for a period.",
      // Band 4
      "Results suggest a slightly stronger pull toward routine than toward novelty. The candidate appears willing to adjust methods when circumstances clearly require it, while still preferring plans and processes to stay reasonably stable. This may indicate someone who adapts adequately but does not seek change for its own sake.",
      // Band 5
      "The response pattern is consistent with a typical balance between consistency and adaptability. The candidate likely maintains reliable routines yet adjusts methods, priorities, or plans when the situation changes. Results suggest they can operate in both stable and moderately changing environments.",
      // Band 6
      "Results suggest the candidate is somewhat more open to change than most. They likely try new methods willingly, shift between differing tasks without much friction, and adjust plans when better information arrives. This may indicate comfort in roles where procedures evolve regularly.",
      // Band 7
      "The response pattern is consistent with an adaptable, change-friendly style. The candidate likely welcomes revised priorities and new ways of working, and may be quick to modify their own approach when they see a better one. They may be a helpful early adopter during transitions or process changes.",
      // Band 8
      "Results suggest a high degree of adaptability and openness to varied approaches. The candidate appears at ease with shifting assignments, changing requirements, and novel situations, and may actively enjoy work that reinvents itself often. Highly repetitive, unchanging work may hold their interest less well.",
      // Band 9 — very high, includes watch-out
      "The response pattern is consistent with an unusually fluid, change-seeking style. The candidate likely adjusts course quickly, accommodates competing demands with ease, and treats new methods as opportunities rather than disruptions. A possible watch-out: this level of adaptability can shade into inconsistency, and the candidate may change approaches or shift plans more often than a role requiring stable, repeatable execution can absorb.",
    ],
    rangePosition: {
      below:
        "This score falls below the level of adaptability the role typically calls for. Results suggest the candidate may need more notice and structure around changes than the position naturally provides; discussing how they have handled past changes in direction is recommended.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's balance of consistency and adaptability aligns with how much change the position typically involves.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: a role built on stable, repeatable methods may not use this candidate's appetite for change, and they may vary their approach where the position rewards uniformity. Exploring their comfort with routine work is recommended.",
    },
  },
  {
    construct: "ORGANIZATION",
    bandNarratives: [
      // Band 1 — very low
      "The response pattern is consistent with a spontaneous, in-the-moment approach to managing work. The candidate likely handles tasks as they arise rather than working from schedules, lists, or advance plans, and may rely on external structure to keep commitments visible. Detailed preparation and long-range planning are likely not their preferred way of operating.",
      // Band 2
      "Results suggest the candidate favors improvisation over planning. They may keep loose or informal systems for tracking work, and deadlines and details may occasionally need reinforcement from tools, reminders, or a structured team environment. They likely do better with short, concrete tasks than with long, multi-step projects they must sequence themselves.",
      // Band 3
      "The response pattern is consistent with a lightly structured working style. The candidate likely plans for the most important items while leaving much of their day to unfold as it comes, and their preparation for meetings or tasks may be uneven. Results suggest they benefit when priorities and checklists are established for them.",
      // Band 4
      "Results suggest planning habits slightly below the typical midpoint. The candidate appears to organize their work adequately for routine demands, though under heavier load their prioritization may become reactive rather than deliberate. This may indicate someone who is orderly enough day to day but does not naturally build systems ahead of need.",
      // Band 5
      "The response pattern is consistent with a typical, workable level of personal organization. The candidate likely plans key tasks, meets most deadlines, and keeps their workspace and materials in usable order without being rigid about it. Results suggest a practical balance between structure and spontaneity.",
      // Band 6
      "Results suggest the candidate is somewhat more organized than most. They likely set priorities at the start of a day or week, prepare before meetings and tasks, and keep track of details with dependable personal systems. This may indicate readiness to coordinate work that involves several moving parts.",
      // Band 7
      "The response pattern is consistent with a well-developed planning orientation. The candidate likely maps out work in advance, sequences tasks deliberately, uses time efficiently, and arrives prepared. Others may come to rely on them to keep shared work on schedule.",
      // Band 8
      "Results suggest a highly systematic approach to planning and time use. The candidate appears to maintain thorough schedules and orderly records, anticipate what upcoming work will require, and prepare well ahead of deadlines. This may indicate strong suitability for roles where precision, documentation, and follow-through are central.",
      // Band 9 — very high, includes watch-out
      "The response pattern is consistent with an exceptionally structured, meticulous style. The candidate likely plans in detail, tracks commitments closely, and leaves little to chance in how their time and materials are managed. A possible watch-out: at this level, attachment to the plan can make necessary improvisation uncomfortable, and the candidate may spend more time perfecting systems and preparation than fast-moving situations allow.",
    ],
    rangePosition: {
      below:
        "This score falls below the degree of planning and personal structure the role typically calls for. Results suggest the candidate may lean on external systems or supervision to keep multi-step work on track; asking how they currently manage deadlines and details is recommended.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's planning and time-management habits are a reasonable match for how structured the position needs to be.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: in a position that rewards quick adjustment over detailed planning, a strongly systematic style may slow decisions or add unneeded process. Exploring how the candidate handles unplanned work is recommended.",
    },
  },
  {
    construct: "COMMUNICATION",
    bandNarratives: [
      // Band 1 — very low
      "The response pattern is consistent with a strongly reserved interpersonal style. The candidate likely prefers working independently, communicates chiefly when the task requires it, and may find extended or unstructured social interaction draining. This reflects a preference for quiet focus rather than an inability to communicate; their contributions may come best in writing or in one-to-one settings.",
      // Band 2
      "Results suggest the candidate is selective about when and with whom they engage. They likely listen more than they speak in groups, keep conversations purposeful, and open up gradually as working relationships develop. Roles centered on continuous outward contact may suit them less well than roles with focused, task-based interaction.",
      // Band 3
      "The response pattern is consistent with a quiet but functional communication style. The candidate likely participates when invited and handles necessary interactions capably, while rarely being the one to start conversations or volunteer views in larger settings. Results suggest they may share more readily in small groups or with people they know.",
      // Band 4
      "Results suggest an interaction level slightly below the typical midpoint. The candidate appears comfortable in routine workplace exchanges and likely communicates clearly on matters within their responsibilities, while preferring not to hold the floor. This may indicate someone who engages steadily but conserves social effort.",
      // Band 5
      "The response pattern is consistent with a typical, situational approach to interaction. The candidate likely moves comfortably between collaborative and independent work, speaking up when they have something to add and stepping back when they do not. Results suggest a balanced mix of engagement and self-sufficiency.",
      // Band 6
      "Results suggest the candidate engages somewhat more readily than most. They likely start conversations, keep colleagues informed without prompting, and are at ease meeting new people in the course of work. This may indicate comfort in roles with regular customer, client, or cross-team contact.",
      // Band 7
      "The response pattern is consistent with an outgoing, communicative style. The candidate likely enjoys frequent interaction, contributes openly in meetings, and builds working relationships quickly. Sustained solo work with little contact may hold their interest less well than collaborative settings.",
      // Band 8
      "Results suggest a highly sociable, expressive approach to work. The candidate appears energized by people-intensive environments, communicates freely across levels and groups, and may naturally take on connecting or front-facing duties. This may indicate strong alignment with roles where relationship-building is a core requirement.",
      // Band 9 — very high, includes watch-out
      "The response pattern is consistent with an exceptionally engaging, talk-oriented style. The candidate likely seeks out interaction throughout the day, connects easily with almost anyone, and keeps communication flowing within a team. A possible watch-out: at this level, the pull toward conversation can compete with heads-down work, and the candidate may occupy more airtime than quieter colleagues find room to fill; note also that readiness to talk is not the same as precision in what is communicated.",
    ],
    rangePosition: {
      below:
        "This score falls below the level of interpersonal engagement the role typically calls for. Results suggest the candidate may find the position's volume of interaction taxing over time; discussing how they have managed people-intensive responsibilities is recommended.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's preferred level of interaction is a reasonable match for how much contact the position involves.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: a role with limited interaction may leave this candidate short of the contact they prefer, and their sociability may pull attention from independent tasks. Exploring their comfort with solo work is recommended.",
    },
  },
  {
    construct: "EMOTIONAL_DEVELOPMENT",
    bandNarratives: [
      // Band 1 — very low
      "The response pattern is consistent with a self-questioning style and strong sensitivity to how work is received. The candidate likely prepares carefully because they want to avoid mistakes, and criticism or setbacks may stay with them longer than with most. Supportive supervision, clear expectations, and regular constructive feedback likely help them contribute at their best.",
      // Band 2
      "Results suggest the candidate approaches demanding situations cautiously and may hold back until they feel sure of their footing. They likely take feedback seriously, sometimes weighing it heavily, and may prefer roles where the consequences of errors are bounded and support is available. Their care and self-scrutiny can translate into conscientious, double-checked work.",
      // Band 3
      "The response pattern is consistent with somewhat variable confidence across situations. The candidate likely performs steadily on well-known ground while finding high-visibility moments, such as presenting or being evaluated, more demanding. Results suggest their composure grows as experience and early wins accumulate.",
      // Band 4
      "Results suggest steadiness slightly below the typical midpoint. The candidate appears to manage everyday pressure adequately, though unexpected criticism or a sudden spike in demands may unsettle them briefly before they regroup. This may indicate someone who recovers reliably but benefits from a moment to reset after difficult interactions.",
      // Band 5
      "The response pattern is consistent with a typical level of confidence and composure. The candidate likely takes ordinary workplace pressure in stride, accepts feedback without being derailed by it, and rebounds from most setbacks within a reasonable time. Results suggest dependable steadiness across common work situations.",
      // Band 6
      "Results suggest somewhat greater self-assurance and resilience than most. The candidate likely stays composed when plans go wrong, treats criticism as information rather than as a verdict, and re-engages quickly after disappointments. This may indicate readiness for roles with periodic high-pressure moments.",
      // Band 7
      "The response pattern is consistent with a confident, even-keeled presence. The candidate likely remains steady in tense meetings, tight deadlines, and difficult conversations, and may help settle others when a situation becomes charged. Setbacks appear more likely to prompt problem-solving than discouragement.",
      // Band 8
      "Results suggest a high level of self-confidence and durability under pressure. The candidate appears to take on high-stakes work willingly, absorb blunt feedback without losing momentum, and maintain performance through prolonged demanding periods. This may indicate strong suitability for visible, accountability-heavy roles.",
      // Band 9 — very high, includes watch-out
      "The response pattern is consistent with exceptionally strong self-assurance and composure. The candidate likely stays unruffled in situations most people find intensely pressured and projects certainty that others may find reassuring. A possible watch-out: at this level, confidence can outpace reflection, and the candidate may discount valid criticism, underestimate risks, or overlook early signals that a course of action needs rethinking.",
    ],
    rangePosition: {
      below:
        "This score falls below the level of steadiness and self-assurance the role typically calls for. Results suggest the candidate may need more support and clearer expectations than the position naturally provides during high-pressure stretches; discussing how they have handled past setbacks is recommended.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's confidence and composure are a reasonable match for the pressure the position typically involves.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: in a position that rewards careful self-review, very high assurance may reduce the candidate's inclination to seek input or revisit decisions. Exploring how they respond to correction is recommended.",
    },
  },
];
