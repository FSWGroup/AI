/**
 * FSW WorkFit — band narratives for the six aptitude dimensions.
 *
 * Original FSW Group content. Each dimension carries exactly nine band
 * narratives (index 0 = band 1 "very low" … index 8 = band 9 "very high")
 * plus range-position addenda interpreting the score against the role's
 * desired range. All text follows the LANGUAGE RULES in
 * ../narrative-types.ts: probabilistic phrasing, no absolutes, no clinical
 * language, candidate-neutral wording ("the candidate").
 *
 * Note: an above-range score is never presented as automatically better —
 * each "above" addendum names what the interviewer should explore.
 */

import type { NarrativeSet } from "../narrative-types";

export const aptitudeNarratives: NarrativeSet[] = [
  // ------------------------------------------------------------ MENTAL ACUITY
  {
    construct: "MENTAL_ACUITY",
    bandNarratives: [
      // band 1
      "Results in this range suggest the candidate found most of the reasoning items difficult within the time allowed. On the job, this pattern is consistent with needing new procedures broken into small steps, demonstrated more than once, and supported by written references. Roles built on stable, well-defined routines are likely to be the most comfortable fit.",
      // band 2
      "The response pattern suggests novel problems were worked through slowly and selectively. The candidate may pick up new duties dependably when given worked examples and time to practice before being measured on speed. Rapidly shifting or loosely defined assignments could require substantial support at first.",
      // band 3
      "Results suggest a below-average pace on novel reasoning tasks, with stronger performance likely where material can be studied in advance. The candidate may do well where learning is cumulative and errors are caught by checklists or review steps. Time-pressured troubleshooting is an area worth probing in the interview.",
      // band 4
      "Results fall slightly below the mid-range, suggesting the candidate can reason through new problems but may take somewhat longer than most to reach a confident answer. Once a task has been learned, performance is likely to be steady. Consider how often the role introduces genuinely novel situations.",
      // band 5
      "Results are consistent with a typical pace for absorbing new information and reasoning through everyday problems. The candidate is likely to handle the ordinary mix of routine work and occasional novelty found in most roles. Neither an extended ramp-up nor unusual needs for stimulation are suggested.",
      // band 6
      "Results fall slightly above the mid-range, suggesting the candidate tends to grasp new instructions with limited repetition and to connect related pieces of information without prompting. Training investments are likely to be absorbed efficiently. This level generally supports roles with moderate problem-solving demands.",
      // band 7
      "Results suggest an above-average facility for reasoning through new material and noticing implications others might miss. The candidate may become a resource for co-workers when procedures break down. In highly repetitive roles, it is worth confirming what would keep the work engaging over time.",
      // band 8
      "The response pattern is consistent with quick, accurate reasoning across most item types, including the more demanding ones. The candidate is likely to master complex responsibilities quickly and may seek broader scope soon after settling into the initial role. Discussing growth expectations early is advisable.",
      // band 9
      "Results place the candidate in the highest band for measured reasoning speed and accuracy, which supports rapid learning and complex problem-solving. A very high result is not unconditionally ideal, however: candidates at this level sometimes find highly routine work unchallenging, which can erode engagement over time. Explore what variety, autonomy, and growth the role can realistically offer.",
    ],
    rangePosition: {
      below:
        "This score falls below the range identified as desirable for the role, which may mean a longer ramp-up against the role's learning demands. Structured onboarding and an interview probe of how the candidate has mastered new material in the past are recommended.",
      within:
        "This score falls within the desired range for the role, suggesting the role's learning and problem-solving demands are likely to be a comfortable match for the candidate.",
      above:
        "This score exceeds the role's desired range, and above-range results are not automatically an advantage: the day-to-day work may offer less challenge than the candidate is used to. Explore what would sustain the candidate's engagement if the role proves more routine than expected.",
    },
  },

  // ------------------------------------------------------------ BUSINESS TERMS
  {
    construct: "BUSINESS_TERMS",
    bandNarratives: [
      // band 1
      "Results suggest very limited acquaintance with common commercial vocabulary at this time. In practice, the candidate may need everyday business terms explained during onboarding and may initially misread documents that assume that vocabulary. Because this dimension reflects exposure, fluency often grows quickly once a candidate is immersed in a business setting.",
      // band 2
      "The response pattern suggests the candidate recognizes only the most frequently used business terms. Instructions or paperwork that lean on commercial shorthand may need restating in plain language at first. A working glossary and early shadowing of experienced staff are likely to close the gap.",
      // band 3
      "Results suggest a below-average command of business terminology — the basics appear to be in place, with gaps around less common concepts. Routine transactions are likely to be understood, while contract, finance, or process language may require clarification. Consider how much of the role's communication assumes this vocabulary.",
      // band 4
      "Results fall slightly below the mid-range. The candidate is likely to follow most workplace business language, pausing occasionally over specialized terms. Any gaps are more likely to slow work briefly than to derail it.",
      // band 5
      "Results are consistent with a typical working knowledge of everyday commercial vocabulary. The candidate is likely to read standard business documents and follow most work conversations without difficulty. Industry-specific jargon would still be learned on the job, as it is for most new hires.",
      // band 6
      "Results fall slightly above the mid-range, suggesting comfortable command of common business language along with many less common terms. The candidate is likely to draft and interpret routine business communication with little support.",
      // band 7
      "Results suggest above-average fluency with business concepts and terminology. The candidate may move easily between operational, financial, and customer-facing language, which tends to shorten onboarding in commercially oriented roles.",
      // band 8
      "The response pattern is consistent with broad, confident command of business vocabulary, including terms many candidates miss. Fluency at this level often reflects sustained exposure to commercial environments and supports work involving contracts, reporting, and cross-functional communication.",
      // band 9
      "Results place the candidate in the highest band for command of business terminology. Recognizing terms is not the same as exercising sound commercial judgment, so a very high score here should be read as vocabulary and exposure rather than decision quality. Use the interview to confirm the candidate can put this fluency to practical use.",
    ],
    rangePosition: {
      below:
        "This score falls below the desired range for the role, suggesting the role's business-language demands may initially outpace the candidate's current vocabulary. A glossary, example-based onboarding, and an interview probe of prior commercial exposure are recommended.",
      within:
        "This score falls within the desired range, suggesting the candidate's command of business language is likely to match what the role assumes.",
      above:
        "This score is above the role's desired range, which is not automatically better: vocabulary beyond the role's needs adds little on its own, and it may hint that the candidate is used to broader commercial scope. Explore whether the role's content will feel substantive enough to hold their interest.",
    },
  },

  // --------------------------------------------- BUSINESS & WORLD AWARENESS / MEMORY
  {
    construct: "AWARENESS_MEMORY",
    bandNarratives: [
      // band 1
      "Results suggest the candidate retained little of the presented material and answered few of the awareness items correctly. On the job, this pattern is consistent with needing key information delivered in writing rather than verbally, and repeated before it settles. Consider whether the role requires holding details in mind without references.",
      // band 2
      "The response pattern suggests recall of new material was fragmentary and awareness of general business and world topics was limited. The candidate may work best with checklists, notes, and confirmation loops rather than one-time verbal briefings.",
      // band 3
      "Results suggest below-average retention of newly presented details, with the broad outline held more securely than the specifics. Written follow-ups after meetings and structured handoffs are likely to prevent most slippage.",
      // band 4
      "Results fall slightly below the mid-range. The candidate is likely to retain the substance of briefings and general current-events context, occasionally losing finer details such as figures or names. Simple note-taking habits would likely make up the difference.",
      // band 5
      "Results are consistent with typical retention of newly presented information and a working awareness of business and world events. The candidate is likely to carry the details of everyday instructions dependably from briefing to task.",
      // band 6
      "Results fall slightly above the mid-range, suggesting the candidate holds new details somewhat more securely than most and connects them to a reasonable base of general awareness. Verbal instructions are likely to survive intact through to execution.",
      // band 7
      "Results suggest above-average recall of presented material and an attentive eye on the wider business environment. The candidate may notice when current information contradicts what was said earlier, which supports accuracy in quality-sensitive and client-facing work.",
      // band 8
      "The response pattern is consistent with strong retention of details after brief exposure, together with broad awareness of business and world context. The candidate is likely to work accurately from one-time briefings and to bring useful outside context into internal discussions.",
      // band 9
      "Results place the candidate in the highest band for measured recall and awareness, which supports precision and context-rich judgment. Strong recall of what was said is not the same as sound judgment about what matters, and some individuals at this level revisit details colleagues consider settled. Explore how the candidate decides which information deserves attention.",
    ],
    rangePosition: {
      below:
        "This score falls below the desired range for the role, suggesting the role's demands for unaided recall and current-context awareness may need scaffolding at first. Probe how the candidate has kept track of details in past work.",
      within:
        "This score falls within the desired range, suggesting the candidate's retention and awareness are likely adequate for the way this role transmits information.",
      above:
        "This score is above the desired range, and above-range recall is not automatically an advantage: in roles that repeat the same information daily it has little room to matter. Explore whether the candidate finds repetitive, detail-light communication frustrating, and where their attention would go instead.",
    },
  },

  // --------------------------------------------------------------- VOCABULARY
  {
    construct: "VOCABULARY",
    bandNarratives: [
      // band 1
      "Results suggest a limited range of general word knowledge relative to other candidates. Written material beyond plain, everyday wording may be misread, and the candidate may understate what they know when asked to explain things in writing. Verbal walk-throughs and plain-language documentation are likely to help.",
      // band 2
      "The response pattern suggests the candidate works comfortably with everyday words but hesitated over less common ones. Longer or formally worded documents may need a second pass. Spoken instruction in plain terms is less likely to be affected.",
      // band 3
      "Results suggest below-average breadth of vocabulary. The candidate is likely to understand routine workplace communication while occasionally missing nuance in formal or technical writing. Consider how much of the role turns on precise reading.",
      // band 4
      "Results fall slightly below the mid-range, suggesting serviceable word knowledge with occasional gaps at the less common end. In most roles this would surface rarely, chiefly in dense written material.",
      // band 5
      "Results are consistent with a typical range of general word knowledge. The candidate is likely to read standard workplace documents accurately and to express ideas clearly in common terms.",
      // band 6
      "Results fall slightly above the mid-range, suggesting the candidate distinguishes between similar words with some precision and reads formal material with little friction. Written work is likely to be clear and reasonably exact.",
      // band 7
      "Results suggest an above-average vocabulary. The candidate is likely to grasp nuance in policies, contracts, and correspondence, and to write with precision. This tends to support roles with significant reading or drafting responsibilities.",
      // band 8
      "The response pattern is consistent with a broad, precise vocabulary, including words many candidates miss. Complex written material is likely to be handled quickly and accurately, and the candidate may be a natural reviewer of others' drafts.",
      // band 9
      "Results place the candidate in the highest band for measured word knowledge, an asset in writing-heavy work. Very high scorers sometimes default to wording that plainer audiences find distant, and adjusting register to the reader is a separate skill worth confirming. Explore how the candidate communicates with non-specialist audiences.",
    ],
    rangePosition: {
      below:
        "This score falls below the desired range for the role, which may matter where the work involves dense reading or precise drafting. Reviewing a short writing or reading sample and probing how the candidate handles new or uncommon terms is recommended.",
      within:
        "This score falls within the desired range, suggesting the candidate's word knowledge is likely to match the role's reading and writing demands.",
      above:
        "This score is above the role's desired range, and that is not automatically better: beyond the role's needs, additional vocabulary adds little, and a mismatched register can create distance with customers or teammates. Explore whether the candidate adapts their language to the audience in front of them.",
    },
  },

  // ----------------------------------------------------- NUMERICAL PERCEPTION
  {
    construct: "NUMERICAL_PERCEPTION",
    bandNarratives: [
      // band 1
      "Results suggest the candidate found rapid number-checking tasks difficult, with comparisons that were slow, inaccurate, or both under time pressure. Work involving codes, totals, or figure verification is likely to need double-checks or system supports. Note that this dimension reflects perceptual speed with figures, not mathematical reasoning.",
      // band 2
      "The response pattern suggests careful but slow handling of numerical detail, or speed achieved at some cost to accuracy. The candidate may be most dependable where checking work is unhurried and errors are recoverable.",
      // band 3
      "Results suggest below-average speed in scanning and comparing figures. Accuracy on a modest volume of numerical detail may be adequate; sustained high-volume checking is where a difference would most likely show.",
      // band 4
      "Results fall slightly below the mid-range. Routine numerical detail — order numbers, quantities, simple reconciliation — is likely to be handled adequately, with occasional slips under deadline pressure. Straightforward verification habits would likely compensate.",
      // band 5
      "Results are consistent with typical speed and accuracy on numerical detail. The candidate is likely to manage the everyday volume of figures most roles involve without special support.",
      // band 6
      "Results fall slightly above the mid-range, suggesting the candidate scans and verifies numbers somewhat faster than most while holding accuracy. Data entry, order processing, and reconciliation work are likely to be comfortable territory.",
      // band 7
      "Results suggest above-average perceptual speed with numerical detail. The candidate is likely to catch transposed digits and mismatched totals that others pass over, which supports quality-sensitive clerical, financial, and inventory work.",
      // band 8
      "The response pattern is consistent with fast, precise processing of numerical detail even under time pressure. High-volume checking work is likely to be completed with few errors and limited fatigue.",
      // band 9
      "Results place the candidate in the highest band for numerical perception, supporting exceptional accuracy at volume. Individuals at this level sometimes find slow, low-volume checking work tedious, and speed with figures should not be read as analytical or mathematical depth. Confirm what mix of pace and analysis the role actually requires.",
    ],
    rangePosition: {
      below:
        "This score falls below the desired range for the role, which matters most where the work depends on fast, accurate handling of figures. Probe how the candidate has protected accuracy in past detail work, and consider building in verification supports.",
      within:
        "This score falls within the desired range, suggesting the candidate's speed and accuracy with numerical detail are likely to fit the role's demands.",
      above:
        "This score is above the role's desired range, and above-range speed is not automatically a gain: if the role offers a modest volume of numerical work, the surplus goes unused and the pace may feel slow. Explore what tempo of detail work keeps the candidate engaged.",
    },
  },

  // ------------------------------------------------------- MECHANICAL INTEREST
  {
    construct: "MECHANICAL_INTEREST",
    bandNarratives: [
      // band 1
      "Results suggest the candidate expresses very little interest in tools, machinery, or how physical things work. Duties centered on equipment are likely to hold limited appeal — regardless of the candidate's actual skill, which this dimension does not measure. Their enthusiasm may sit instead with people-, data-, or idea-centered work.",
      // band 2
      "The response pattern suggests low expressed interest in hands-on mechanical activity. The candidate may engage with equipment-related duties when required but is unlikely to seek them out. This says nothing about capability, only about where enthusiasm currently sits.",
      // band 3
      "Results suggest below-average interest in mechanical topics. Occasional equipment tasks are unlikely to be resisted, but they are also unlikely to be the part of the job the candidate finds energizing.",
      // band 4
      "Results fall slightly below the mid-range, suggesting mild but present curiosity about how things work. Mechanical aspects of a role would likely be treated as ordinary duties rather than a draw. As at every level, this reflects preference, not proficiency.",
      // band 5
      "Results are consistent with a typical level of interest in tools, machinery, and physical systems — neither a draw nor a deterrent. The mechanical content of a role is unlikely to affect the candidate's engagement in either direction.",
      // band 6
      "Results fall slightly above the mid-range, suggesting the candidate finds equipment and physical processes moderately appealing. Hands-on components of a role may add to its attraction. Whether interest is matched by skill is a separate question for the interview or a work sample.",
      // band 7
      "Results suggest above-average expressed interest in mechanical and technical subject matter. The candidate is likely to volunteer for equipment-related tasks and to enjoy learning how systems work. Interest at this level often supports persistence in technical training, though it does not by itself demonstrate technical aptitude.",
      // band 8
      "The response pattern is consistent with strong enthusiasm for tools, machinery, and how things are built and repaired. Roles rich in hands-on content are likely to feel engaging. Verify actual skill separately — this dimension speaks only to what the candidate is drawn toward.",
      // band 9
      "Results place the candidate at the highest level of expressed mechanical interest. If the role offers little hands-on content, that appetite may go unmet and engagement could suffer; and even at this level, interest should never be read as evidence of mechanical ability. Explore what hands-on outlets the role — or the candidate's pursuits outside work — will provide.",
    ],
    rangePosition: {
      below:
        "This score falls below the desired range for the role, suggesting the role's hands-on content may appeal less to the candidate than the benchmark assumes. Probe which parts of previous roles the candidate found most engaging.",
      within:
        "This score falls within the desired range, suggesting the candidate's interest in hands-on work is likely aligned with what the role offers.",
      above:
        "This score is above the role's desired range, and more interest is not automatically better: if the role's mechanical content is limited, a strong hands-on appetite may go unfed. Explore whether the role offers enough of what draws the candidate — and keep in mind that interest is not a measure of ability.",
    },
  },
];
