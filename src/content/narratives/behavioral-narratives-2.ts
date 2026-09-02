/**
 * FSW Talent Scout behavioral narrative content — set 2 of 2.
 *
 * Covers: ASSERTIVENESS, COMPETITIVENESS, MENTAL_TOUGHNESS,
 * QUESTIONING_PROBING, MOTIVATION.
 *
 * All text is ORIGINAL FSW Group content and follows the LANGUAGE RULES
 * documented in ../narrative-types.ts: probabilistic, work-related,
 * candidate-neutral phrasing with no absolute, medical, or accusatory
 * claims. Band index 0 corresponds to band 1 (very low) and index 8 to
 * band 9 (very high).
 */

import type { NarrativeSet } from "../narrative-types";

export const behavioralNarratives2: NarrativeSet[] = [
  {
    construct: "ASSERTIVENESS",
    bandNarratives: [
      // Band 1
      "Results suggest the candidate strongly prefers to keep opinions private and to let others set direction in group settings. The response pattern is consistent with someone who rarely volunteers a position, even when they hold one, and who may defer decisions to colleagues or supervisors. In roles built around supporting an established process, this reserved style may fit comfortably.",
      // Band 2
      "The response pattern is consistent with a quiet, accommodating style in which the candidate voices a view mainly when asked directly. They may go along with group decisions they privately question rather than raise an objection. This may work well where harmony and steady support are valued, though their input could go unheard in fast-moving discussions.",
      // Band 3
      "Results suggest the candidate shares opinions selectively, typically in smaller settings or with people they know well. They may hesitate to challenge a senior colleague or to press a point once resistance appears. Prompting from a manager may help draw out perspectives the candidate would not otherwise offer.",
      // Band 4
      "The response pattern points to a moderately reserved style: the candidate appears willing to state a position but is unlikely to push it hard against opposition. They may prefer to influence through preparation and one-on-one conversation rather than open debate. This may indicate someone who advocates effectively when the setting feels safe and the stakes are clear.",
      // Band 5
      "Results suggest a balanced approach to self-expression: the candidate appears comfortable stating opinions and making routine decisions, while also giving ground when others make a stronger case. They are likely to speak up on matters within their responsibility and to escalate rather than force contested issues. This flexible middle position tends to travel well across most team environments.",
      // Band 6
      "The response pattern is consistent with a candidate who states positions readily and is generally comfortable being the one to decide. They may take the lead in discussions, offer direct feedback, and defend a recommendation when questioned. Colleagues are likely to know where this candidate stands on most workplace issues.",
      // Band 7
      "Results suggest a confident, forthright style: the candidate appears to enjoy influencing others, advocating for a course of action, and challenging ideas they see as weak. They are likely to make decisions without waiting for consensus and to press their case with persistence. This may suit roles that require negotiation, persuasion, or visible leadership.",
      // Band 8
      "The response pattern indicates a strongly assertive orientation: the candidate appears quick to take charge of discussions, direct in expressing disagreement, and comfortable making calls that affect others. They may actively seek situations where their voice shapes the outcome, including with senior stakeholders. This forceful presence can move stalled work forward, though it benefits from being paired with deliberate listening.",
      // Band 9 (includes watch-out)
      "Results suggest an exceptionally dominant, outspoken style in which the candidate asserts positions immediately and expects to steer decisions. They are likely to challenge others openly, push hard for their preferred approach, and rarely back down once committed. A possible watch-out: colleagues may experience this intensity as overriding or dismissive, and quieter team members may stop contributing, so interviewers may wish to explore how the candidate makes room for other voices.",
    ],
    rangePosition: {
      below:
        "This score falls below the range identified for the role, which calls for more frequent self-advocacy and decision-making than the candidate's results suggest they typically show. It may be worth exploring in interview how the candidate handles situations that require voicing an unpopular view or making a call without consensus.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's level of self-expression and decisiveness is broadly aligned with what the position appears to require.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: a more forceful style than the role requires may create friction with colleagues or customers who expect a measured, consultative approach, so fit should be weighed against the working environment rather than assumed.",
    },
  },
  {
    construct: "COMPETITIVENESS",
    bandNarratives: [
      // Band 1
      "Results suggest the candidate is strongly oriented toward shared outcomes and finds little appeal in individual contests or rankings. The response pattern is consistent with someone who measures success by what the group accomplishes and who readily hands credit to teammates. This collaborative orientation can be a genuine asset in roles where cooperation, knowledge-sharing, and collective results drive performance.",
      // Band 2
      "The response pattern points to a distinctly team-first orientation: the candidate appears to prefer pooling effort over comparing performance and may find head-to-head competition with colleagues uncomfortable or counterproductive. They are likely to support others' wins as readily as their own. This may fit well in service, care, or project-team settings built on mutual support.",
      // Band 3
      "Results suggest the candidate leans collaborative, generally valuing group harmony and joint achievement over personal standing. They may engage with individual targets when required but are unlikely to be energized by leaderboards or one-winner incentives. This may indicate someone who performs most naturally when goals are framed around the team.",
      // Band 4
      "The response pattern is consistent with a moderately collaborative style: the candidate appears to enjoy contributing to shared goals and shows only occasional interest in outperforming peers. Friendly comparison may motivate them in small doses, but sustained rivalry is unlikely to be their preferred fuel. Team-based measures of success may suit them better than purely individual ones.",
      // Band 5
      "Results suggest a balanced position between individual drive and team orientation: the candidate appears able to pursue personal targets and to fold their effort into a group goal, depending on what the situation rewards. They may enjoy a contest without needing one to stay engaged. This adaptability tends to fit a wide variety of role designs.",
      // Band 6
      "The response pattern indicates a moderately competitive orientation: the candidate appears to enjoy measuring their performance against others and may seek out opportunities to stand out. They are still likely to cooperate on shared work, but individual recognition appears to carry real motivational weight. Roles with visible personal metrics may play to this preference.",
      // Band 7
      "Results suggest the candidate is clearly energized by competition: rankings, quotas, and the chance to win appear to sharpen their effort. They are likely to track how they compare with peers and to push hardest when a contest is on the line. This may indicate strong fit for sales, business development, or other individually scored environments.",
      // Band 8
      "The response pattern points to a strongly competitive drive: the candidate appears to treat most performance situations as contests to be won and may set personal benchmarks above whatever standard is offered. Losing is likely to spur renewed effort rather than withdrawal. This intensity can produce standout individual results, and it is most effective where the role genuinely rewards individual performance.",
      // Band 9 (includes watch-out)
      "Results suggest an exceptionally strong win-oriented drive in which the candidate appears to frame work largely in terms of outperforming others and securing first place. They are likely to be highly persistent in pursuit of individual targets and visibly energized by scored comparisons. A possible watch-out: in team-dependent settings this focus may crowd out cooperation, information-sharing, or credit-sharing, so it may help to probe how the candidate has balanced personal wins with group obligations.",
    ],
    rangePosition: {
      below:
        "This score falls below the range identified for the role, which appears to reward individual contest and personally scored results more than the candidate's collaborative orientation may seek out. This reflects a difference in motivational style rather than a deficiency, and interview discussion can clarify how the candidate responds to individual targets.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's balance of individual drive and team orientation is broadly matched to how the position measures and rewards success.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: a stronger competitive drive than the role rewards may leave the candidate under-stimulated by shared goals, or may introduce rivalry into work designed around cooperation, so alignment with the role's incentive structure deserves discussion.",
    },
  },
  {
    construct: "MENTAL_TOUGHNESS",
    bandNarratives: [
      // Band 1
      "Results suggest the candidate is likely to feel criticism, rejection, and setbacks keenly, and may need noticeable recovery time before re-engaging after a difficult exchange. The response pattern is consistent with someone who works best in a steady, supportive environment with limited exposure to frequent rebuffs or hard deadlines. This sensitivity can coexist with conscientious, careful work, particularly where feedback is delivered constructively.",
      // Band 2
      "The response pattern indicates the candidate may take negative feedback personally and could dwell on mistakes or lost opportunities longer than most. High-pressure periods and confrontational customers are likely to be draining for them. Managers who frame corrections around the work rather than the person may see markedly better follow-through, and this attentiveness to how work is received often accompanies diligent, quality-minded habits.",
      // Band 3
      "Results suggest the candidate handles routine pressure adequately but may be discouraged by repeated rejection or pointed criticism. They are likely to recover from setbacks, though not always quickly, and may avoid tasks with a high chance of pushback. This may indicate better fit where objections are occasional rather than constant, and where care and thoroughness are valued alongside pace.",
      // Band 4
      "The response pattern points to moderate resilience: the candidate appears able to absorb everyday criticism and deadline pressure, while extended stretches of adversity may gradually wear on their persistence. They are likely to bounce back with a short reset or some encouragement. Most standard working conditions should be manageable for them.",
      // Band 5
      "Results suggest a steady, mid-range resilience: the candidate appears to take most criticism as information, keep working through ordinary setbacks, and meet deadlines without losing composure. Unusually harsh or sustained pressure may still affect them, as it would many people. This balanced profile fits the demands of a broad range of roles.",
      // Band 6
      "The response pattern is consistent with above-average persistence under pressure: the candidate appears to recover quickly from rejection, accept blunt feedback without much disruption, and keep momentum when plans go wrong. They are likely to stay effective through busy periods and demanding stakeholders. Occasional setbacks are unlikely to change their overall pace.",
      // Band 7
      "Results suggest the candidate is notably durable in the face of criticism, refusals, and tight timelines, and may even find that pressure sharpens their focus. They are likely to hear a hard no, adjust, and try again without a meaningful dip in effort. This may suit collections, sales prospecting, complaint handling, or other high-rebuff work.",
      // Band 8
      "The response pattern indicates strong resilience: the candidate appears largely unshaken by harsh feedback, repeated rejection, or high-stakes deadlines, and tends to press forward where others might pause. Setbacks are likely to be treated as routine obstacles rather than discouragements. This steadiness can anchor a team during difficult stretches, and it is most valuable when paired with genuine attention to the feedback content itself.",
      // Band 9 (includes watch-out)
      "Results suggest an exceptionally thick-skinned profile: criticism, rejection, and pressure appear to have little visible effect on the candidate's drive or composure, and they are likely to persist through conditions most people would find punishing. A possible watch-out: this same imperviousness may lead the candidate to shrug off legitimate corrective feedback, underestimate how pressure affects colleagues, or persist with an approach after the evidence says to change course, so interviewers may wish to explore how the candidate decides when feedback warrants a real adjustment.",
    ],
    rangePosition: {
      below:
        "This score falls below the range identified for the role, which appears to involve more frequent criticism, rejection, or deadline pressure than the candidate's results suggest they would find comfortable. It may be useful to explore in interview how the candidate has managed sustained pushback, and what support structures have helped them stay effective.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's persistence through pressure, setbacks, and criticism is broadly matched to the demands the position is likely to present.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: resilience beyond what the role demands may bring little added benefit, and in some cases may accompany a tendency to discount feedback or push past signals that a plan needs revising, so the practical value of the extra durability should be judged against the role's actual pressures.",
    },
  },
  {
    construct: "QUESTIONING_PROBING",
    bandNarratives: [
      // Band 1
      "Results suggest the candidate strongly prefers to accept information, instructions, and established methods at face value and to move directly to execution. The response pattern is consistent with someone who rarely asks why and seldom re-verifies what a trusted source has said. In stable, well-documented environments this accepting style can translate into fast, frictionless throughput.",
      // Band 2
      "The response pattern indicates a trusting, efficiency-first orientation: the candidate appears to take direction readily and to assume that provided information is accurate unless a problem surfaces. They are likely to keep meetings short and decisions moving. This may serve well where procedures are proven, though unstated errors in source material could pass through unchecked.",
      // Band 3
      "Results suggest the candidate asks clarifying questions occasionally but generally works with the information as given. They may verify details when something looks obviously off, while routine inputs are likely to be accepted without much scrutiny. This may indicate a practical style suited to roles where speed matters more than independent verification.",
      // Band 4
      "The response pattern points to moderate curiosity: the candidate appears to probe selectively, checking the details that carry visible risk and accepting the rest. They are likely to ask questions when stakes or ambiguity are high rather than as a matter of habit. This proportionate approach balances diligence against pace in most everyday work.",
      // Band 5
      "Results suggest a balanced investigative style: the candidate appears comfortable both accepting reliable inputs and digging deeper when a claim seems thin. They are likely to ask useful questions without turning every task into an inquiry. This flexibility tends to fit roles that mix routine execution with occasional analysis.",
      // Band 6
      "The response pattern is consistent with an actively inquisitive candidate who tends to ask how figures were produced, where information came from, and whether an assumption still holds. They are likely to catch inconsistencies that a quicker reader would miss. Colleagues may come to rely on them as an informal checker of facts and reasoning.",
      // Band 7
      "Results suggest a strong investigative bent: the candidate appears inclined to verify claims independently, test assumptions, and keep asking until an explanation actually explains. They may be uncomfortable signing off on work they have not examined themselves. This may fit auditing, research, quality, or troubleshooting roles where skepticism is the job.",
      // Band 8
      "The response pattern indicates a deeply probing style: the candidate appears to treat most incoming information as provisional until they have checked it, and they are likely to question established methods as readily as new proposals. Their scrutiny can surface problems early and improve decisions materially. The style is most effective where thoroughness is valued over rapid turnaround, since this level of verification takes time.",
      // Band 9 (includes watch-out)
      "Results suggest an exceptionally intensive questioning style in which the candidate appears to challenge assumptions, sources, and instructions almost reflexively before acting. Little is likely to reach their sign-off unexamined, which can make them a formidable safeguard against error. A possible watch-out: this level of scrutiny may slow time-critical decisions and can be experienced by colleagues as distrust of their work, so interviewers may wish to explore how the candidate calibrates when to verify and when to proceed.",
    ],
    rangePosition: {
      below:
        "This score falls below the range identified for the role, which appears to require more independent verification and assumption-testing than the candidate's accepting style may naturally supply. Structured checklists or defined review steps may help close the gap, and interview examples of the candidate catching an error would be informative.",
      within:
        "This score falls within the range identified for the role, suggesting the candidate's balance between accepting information efficiently and probing it critically is broadly aligned with what the position requires.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: more scrutiny than the role needs can slow routine decisions, add cost to simple tasks, and strain trust with colleagues whose work is repeatedly re-checked, so the benefit of the extra rigor should be weighed against the role's pace and structure.",
    },
  },
  {
    construct: "MOTIVATION",
    bandNarratives: [
      // Band 1
      "Results suggest the candidate is oriented toward stability, well-established responsibilities, and steady contribution rather than advancement, incentives, or public recognition. The response pattern is consistent with someone who finds satisfaction in doing dependable work without needing scoreboards or promotion paths to stay engaged. This settled orientation can be a genuine strength in roles where continuity, reliability, and long tenure matter.",
      // Band 2
      "The response pattern points to a contentment-centered orientation: the candidate appears to value predictable duties and a secure position more than climbing or competing for rewards. External incentives are unlikely to change their effort much in either direction, while consistency day after day appears to come naturally. Long-running operational roles may suit this profile well.",
      // Band 3
      "Results suggest the candidate leans toward steady contribution, with a modest interest in advancement or measurable wins. They may appreciate recognition when it comes but are unlikely to chase it or reshape their work around targets. This may indicate durable engagement in roles that reward reliability rather than visible achievement.",
      // Band 4
      "The response pattern indicates moderately steady motivation: the candidate appears comfortable with their current level of responsibility while remaining open to growth when an opportunity clearly fits. Incentives may add some energy without being the main driver of their effort. They are likely to be motivated most by meaningful work performed at a sustainable pace.",
      // Band 5
      "Results suggest a balanced motivational profile: the candidate appears to respond to goals, recognition, and advancement opportunities while also drawing satisfaction from steady, well-executed work. They may pursue a stretch target one quarter and consolidate the next. This dual orientation adapts readily to roles with either incentive-based or stability-based reward structures.",
      // Band 6
      "The response pattern is consistent with a clearly achievement-oriented candidate who tends to set measurable goals, track progress, and look for the next step up. Recognition and results appear to matter to them, and they are likely to invest extra effort where it visibly moves an outcome. Career conversations and defined targets may keep this candidate strongly engaged.",
      // Band 7
      "Results suggest a strong drive toward accomplishment, advancement, and reward: the candidate appears energized by ambitious targets, performance-linked incentives, and visible markers of progress. They are likely to seek growing responsibility and to measure themselves against concrete results. Roles with a clear path upward and quantified outcomes may fit this drive well.",
      // Band 8
      "The response pattern indicates intense goal-directed motivation: the candidate appears to organize their working life around achievement, pursuing bigger targets, broader scope, and tangible recognition with sustained energy. They may become restless in positions where results are hard to see or progression is slow. This drive can deliver exceptional output when the role offers room to grow into.",
      // Band 9 (includes watch-out)
      "Results suggest an exceptionally high-drive profile: the candidate appears strongly focused on advancement, measurable wins, and rewards, and is likely to push for expanded responsibility early and often. Their ambition can raise the performance bar for an entire team. A possible watch-out: if the role offers limited progression or few measurable outcomes, engagement may fade quickly, and the pursuit of individual milestones may compete with slower, less visible obligations, so expectations about growth timelines are worth aligning at the interview stage.",
    ],
    rangePosition: {
      below:
        "This score falls below the range identified for the role, which appears to depend on stronger appetite for targets, incentives, or advancement than the candidate's steady-contribution orientation suggests. This reflects a difference in what energizes the candidate rather than a shortfall in capability, and interview discussion can test how they have sustained effort against measurable goals.",
      within:
        "This score falls within the range identified for the role, suggesting that what motivates the candidate — the mix of achievement, recognition, and steady contribution they seek — is broadly aligned with what the position offers and rewards.",
      above:
        "This score falls above the range identified for the role. Above-range is not automatically better: ambition that outpaces what the position can offer in advancement, incentives, or visible results may lead to early restlessness or turnover, so the role's realistic growth path should be discussed candidly with the candidate.",
    },
  },
];
