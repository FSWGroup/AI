/**
 * FSW Talent Scout — Behavioral statement bank.
 *
 * ORIGINAL FSW Group content. Nothing in this file is copied from, adapted
 * from, or paraphrased out of any third-party assessment instrument.
 *
 * Scale: 5-point agree/disagree.
 *   reverseCoded: false — Strongly Agree scores HIGH on the construct.
 *   reverseCoded: true  — Strongly Agree scores LOW on the construct.
 *
 * DISTORTION items are impression-management (improbably perfect behavior)
 * indicators; agreeing more strongly raises the distortion signal, so they
 * are reverseCoded: false.
 *
 * Items sharing a pairKey probe the same underlying behavior and feed the
 * consistency (equivocation) check.
 */
import type { StatementBank } from "../types";

export const behavioralBank: StatementBank = {
  items: [
    // ------------------------------------------------------------------
    // ENERGY — drive, work pace, sustained effort, response to workload.
    // ------------------------------------------------------------------
    {
      construct: "ENERGY",
      text: "When my task list for the day is finished early, I usually look for something else to start rather than winding down.",
      reverseCoded: false,
    },
    {
      construct: "ENERGY",
      text: "I tend to keep working at close to the same pace late in a shift as I do at the start.",
      reverseCoded: false,
      pairKey: "pair_late_day_pace",
    },
    {
      construct: "ENERGY",
      text: "A heavier workload than usual tends to get me moving faster rather than slowing me down.",
      reverseCoded: false,
    },
    {
      construct: "ENERGY",
      text: "Coworkers have commented that I move through my work faster than most people they know.",
      reverseCoded: false,
    },
    {
      construct: "ENERGY",
      text: "I volunteer for extra assignments even during busy stretches.",
      reverseCoded: false,
    },
    {
      construct: "ENERGY",
      text: "On days packed with back-to-back demands, I usually finish with energy left over.",
      reverseCoded: false,
    },
    {
      construct: "ENERGY",
      text: "By mid-afternoon I usually need to slow down to get through the rest of the day.",
      reverseCoded: true,
    },
    {
      construct: "ENERGY",
      text: "I prefer a role where the workload stays light enough that I rarely have to hurry.",
      reverseCoded: true,
    },
    {
      construct: "ENERGY",
      text: "When a task is not urgent, I tend to let it sit until it becomes urgent.",
      reverseCoded: true,
    },
    {
      construct: "ENERGY",
      text: "After completing one demanding task, I usually need a long break before starting another.",
      reverseCoded: true,
    },
    {
      construct: "ENERGY",
      text: "I pace myself through the day so that there is rarely a reason to work quickly.",
      reverseCoded: true,
    },
    {
      construct: "ENERGY",
      text: "Toward the end of a long workday, my output usually drops off noticeably.",
      reverseCoded: true,
      pairKey: "pair_late_day_pace",
    },

    // ------------------------------------------------------------------
    // FLEXIBILITY — adaptability, openness to changing methods,
    // adjusting when circumstances change.
    // ------------------------------------------------------------------
    {
      construct: "FLEXIBILITY",
      text: "When a procedure I rely on changes, I can usually switch over without losing much momentum.",
      reverseCoded: false,
      pairKey: "pair_method_change",
    },
    {
      construct: "FLEXIBILITY",
      text: "If someone shows me a faster way to do a task I have done for years, I will try it that same week.",
      reverseCoded: false,
    },
    {
      construct: "FLEXIBILITY",
      text: "Being pulled off one assignment to help with another does not bother me much.",
      reverseCoded: false,
    },
    {
      construct: "FLEXIBILITY",
      text: "I adjust my plans quickly when a customer or coworker changes what they need from me.",
      reverseCoded: false,
    },
    {
      construct: "FLEXIBILITY",
      text: "I am comfortable working under supervisors who each run things differently.",
      reverseCoded: false,
    },
    {
      construct: "FLEXIBILITY",
      text: "When the tools I planned to use are unavailable, I usually find another workable approach on the spot.",
      reverseCoded: false,
    },
    {
      construct: "FLEXIBILITY",
      text: "I enjoy days when the plan changes and I have to rearrange things on the fly.",
      reverseCoded: false,
    },
    {
      construct: "FLEXIBILITY",
      text: "Once I have a routine that works, I would rather keep it than experiment with alternatives.",
      reverseCoded: true,
    },
    {
      construct: "FLEXIBILITY",
      text: "Last-minute changes to a schedule I had settled into tend to throw off my whole day.",
      reverseCoded: true,
    },
    {
      construct: "FLEXIBILITY",
      text: "I do my best work when the way tasks are done stays the same from month to month.",
      reverseCoded: true,
    },
    {
      construct: "FLEXIBILITY",
      text: "When priorities shift in the middle of a project, it takes me a while to get comfortable with the new direction.",
      reverseCoded: true,
    },
    {
      construct: "FLEXIBILITY",
      text: "It takes me longer than most people to get used to a new way of doing a familiar task.",
      reverseCoded: true,
      pairKey: "pair_method_change",
    },

    // ------------------------------------------------------------------
    // ORGANIZATION — planning, prioritization, time use, preparation,
    // personal organization.
    // ------------------------------------------------------------------
    {
      construct: "ORGANIZATION",
      text: "Before starting a complicated job, I usually decide what needs to happen first, second, and third.",
      reverseCoded: false,
      pairKey: "pair_task_planning",
    },
    {
      construct: "ORGANIZATION",
      text: "I set aside a few minutes at the end of each day to line up the next day's work.",
      reverseCoded: false,
    },
    {
      construct: "ORGANIZATION",
      text: "When I am given several assignments at once, I sort them by deadline before touching any of them.",
      reverseCoded: false,
    },
    {
      construct: "ORGANIZATION",
      text: "I can usually put my hand on a document or file within a minute of being asked for it.",
      reverseCoded: false,
    },
    {
      construct: "ORGANIZATION",
      text: "I build extra time into my schedule for the steps that tend to run long.",
      reverseCoded: false,
    },
    {
      construct: "ORGANIZATION",
      text: "Before a meeting, I usually review the materials and jot down the points I want to cover.",
      reverseCoded: false,
    },
    {
      construct: "ORGANIZATION",
      text: "I often start tasks and figure out the steps as I go rather than mapping them out first.",
      reverseCoded: true,
    },
    {
      construct: "ORGANIZATION",
      text: "My workspace tends to accumulate items I keep meaning to put away.",
      reverseCoded: true,
    },
    {
      construct: "ORGANIZATION",
      text: "I frequently discover an approaching deadline later than I would like.",
      reverseCoded: true,
    },
    {
      construct: "ORGANIZATION",
      text: "I tend to underestimate how long tasks will take me.",
      reverseCoded: true,
    },
    {
      construct: "ORGANIZATION",
      text: "When several things need doing, I usually start with whichever one happens to be in front of me.",
      reverseCoded: true,
    },
    {
      construct: "ORGANIZATION",
      text: "I usually dive straight into a big task and let the order of the steps sort itself out.",
      reverseCoded: true,
      pairKey: "pair_task_planning",
    },

    // ------------------------------------------------------------------
    // COMMUNICATION — comfort interacting, willingness to communicate,
    // openness, interpersonal engagement.
    // ------------------------------------------------------------------
    {
      construct: "COMMUNICATION",
      text: "In a room full of people I have not met, I usually start conversations rather than wait to be approached.",
      reverseCoded: false,
      pairKey: "pair_initiating_contact",
    },
    {
      construct: "COMMUNICATION",
      text: "I would rather work out a confusing issue by talking with someone than by exchanging written messages.",
      reverseCoded: false,
    },
    {
      construct: "COMMUNICATION",
      text: "Coworkers tend to hear about what I am working on because I keep them updated without being asked.",
      reverseCoded: false,
      pairKey: "pair_proactive_updates",
    },
    {
      construct: "COMMUNICATION",
      text: "I enjoy roles where a large part of the day is spent talking with people.",
      reverseCoded: false,
    },
    {
      construct: "COMMUNICATION",
      text: "New coworkers usually learn my name quickly because I introduce myself early on.",
      reverseCoded: false,
    },
    {
      construct: "COMMUNICATION",
      text: "When someone seems confused by what I said, I try a different explanation rather than repeating the same one.",
      reverseCoded: false,
    },
    {
      construct: "COMMUNICATION",
      text: "I check in with coworkers during the day to stay connected, not only when I need something from them.",
      reverseCoded: false,
    },
    {
      construct: "COMMUNICATION",
      text: "I am usually content to let others carry the conversation in a group.",
      reverseCoded: true,
    },
    {
      construct: "COMMUNICATION",
      text: "I share updates about my work only when someone asks for them.",
      reverseCoded: true,
      pairKey: "pair_proactive_updates",
    },
    {
      construct: "COMMUNICATION",
      text: "I would rather send a written message than pick up the phone, even when a call would settle things faster.",
      reverseCoded: true,
    },
    {
      construct: "COMMUNICATION",
      text: "I tend to keep my thoughts to myself during group discussions unless I am asked directly.",
      reverseCoded: true,
    },
    {
      construct: "COMMUNICATION",
      text: "At gatherings where I know few people, I generally wait for others to approach me first.",
      reverseCoded: true,
      pairKey: "pair_initiating_contact",
    },

    // ------------------------------------------------------------------
    // EMOTIONAL_DEVELOPMENT — self-confidence, steadiness, response to
    // pressure, resilience of composure.
    // ------------------------------------------------------------------
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "I stay on an even keel even when the day takes several unexpected turns.",
      reverseCoded: false,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "When I am put on the spot, I can usually collect my thoughts and respond calmly.",
      reverseCoded: false,
      pairKey: "pair_composure_spotlight",
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "I trust my own judgment even when someone more experienced sees things differently.",
      reverseCoded: false,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "Tense situations at work rarely change the way I speak or carry myself.",
      reverseCoded: false,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "I recover my footing quickly after making a mistake in front of others.",
      reverseCoded: false,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "I feel sure of my abilities even on days when nothing seems to go right.",
      reverseCoded: false,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "Unexpected pressure tends to scatter my thinking for a while.",
      reverseCoded: true,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "I often replay small mistakes in my head long after everyone else has moved on.",
      reverseCoded: true,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "When my work is questioned, my first reaction is usually to doubt myself.",
      reverseCoded: true,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "My mood at work tends to rise and fall with how the day happens to be going.",
      reverseCoded: true,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "Before taking on something unfamiliar, I need a good deal of reassurance that I can handle it.",
      reverseCoded: true,
    },
    {
      construct: "EMOTIONAL_DEVELOPMENT",
      text: "When attention suddenly turns to me, it takes me a while to steady myself.",
      reverseCoded: true,
      pairKey: "pair_composure_spotlight",
    },

    // ------------------------------------------------------------------
    // ASSERTIVENESS — expressing opinions, deciding, influencing,
    // appropriately challenging, advocating.
    // ------------------------------------------------------------------
    {
      construct: "ASSERTIVENESS",
      text: "When I disagree with the direction a group is taking, I say so before the decision is final.",
      reverseCoded: false,
      pairKey: "pair_voicing_disagreement",
    },
    {
      construct: "ASSERTIVENESS",
      text: "I am comfortable telling a coworker when their part of a job needs to be redone.",
      reverseCoded: false,
    },
    {
      construct: "ASSERTIVENESS",
      text: "If a meeting is drifting, I will step in and steer it back to the point.",
      reverseCoded: false,
    },
    {
      construct: "ASSERTIVENESS",
      text: "I ask directly for what I need — equipment, time, or help — rather than hoping someone offers.",
      reverseCoded: false,
    },
    {
      construct: "ASSERTIVENESS",
      text: "When a decision is stalled, I would rather make the call myself than wait for someone else to make it.",
      reverseCoded: false,
    },
    {
      construct: "ASSERTIVENESS",
      text: "I push back when I am handed a deadline I believe is unrealistic.",
      reverseCoded: false,
    },
    {
      construct: "ASSERTIVENESS",
      text: "I put my recommendation on the table even when the senior people in the room have not yet shared theirs.",
      reverseCoded: false,
    },
    {
      construct: "ASSERTIVENESS",
      text: "In discussions, I usually go along with the group even when I privately disagree.",
      reverseCoded: true,
    },
    {
      construct: "ASSERTIVENESS",
      text: "I would rather live with a minor problem than raise it with the person responsible for it.",
      reverseCoded: true,
    },
    {
      construct: "ASSERTIVENESS",
      text: "When someone talks over me, I usually let it go rather than reclaim the floor.",
      reverseCoded: true,
    },
    {
      construct: "ASSERTIVENESS",
      text: "Negotiating for better terms makes me uncomfortable enough that I usually accept the first offer.",
      reverseCoded: true,
    },
    {
      construct: "ASSERTIVENESS",
      text: "I keep my disagreement to myself until after a group decision has already been made.",
      reverseCoded: true,
      pairKey: "pair_voicing_disagreement",
    },

    // ------------------------------------------------------------------
    // COMPETITIVENESS — individual competition vs collaborative
    // orientation. Neither pole is treated as better.
    // ------------------------------------------------------------------
    {
      construct: "COMPETITIVENESS",
      text: "I like knowing exactly how my results stack up against other people's.",
      reverseCoded: false,
    },
    {
      construct: "COMPETITIVENESS",
      text: "Being ranked against coworkers brings out my best effort.",
      reverseCoded: false,
      pairKey: "pair_rivalry_effort",
    },
    {
      construct: "COMPETITIVENESS",
      text: "I would choose a role where individual results are posted over one where only team totals are tracked.",
      reverseCoded: false,
    },
    {
      construct: "COMPETITIVENESS",
      text: "Turning routine tasks into a friendly contest makes work more enjoyable for me.",
      reverseCoded: false,
    },
    {
      construct: "COMPETITIVENESS",
      text: "When someone matches my performance, my first instinct is to find a way back ahead.",
      reverseCoded: false,
    },
    {
      construct: "COMPETITIVENESS",
      text: "I keep close track of my own numbers so I know when I am out in front.",
      reverseCoded: false,
    },
    {
      construct: "COMPETITIVENESS",
      text: "I would rather the team hit its goal than be the top individual performer myself.",
      reverseCoded: true,
    },
    {
      construct: "COMPETITIVENESS",
      text: "Sharing credit evenly matters more to me than being singled out as the best.",
      reverseCoded: true,
    },
    {
      construct: "COMPETITIVENESS",
      text: "I prefer workplaces where people are not measured against one another.",
      reverseCoded: true,
    },
    {
      construct: "COMPETITIVENESS",
      text: "I get more satisfaction from helping a coworker succeed than from outperforming them.",
      reverseCoded: true,
    },
    {
      construct: "COMPETITIVENESS",
      text: "Contests among coworkers make work less pleasant for me, even when I do well in them.",
      reverseCoded: true,
    },
    {
      construct: "COMPETITIVENESS",
      text: "I do my best work when nobody is comparing my results with anyone else's.",
      reverseCoded: true,
      pairKey: "pair_rivalry_effort",
    },

    // ------------------------------------------------------------------
    // MENTAL_TOUGHNESS — persistence through criticism, setbacks,
    // pressure, rejection, and deadlines.
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_TOUGHNESS",
      text: "Being turned down does not make me hesitate to try again with the next person.",
      reverseCoded: false,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "Harsh feedback on a project usually makes me more determined to get the next version right.",
      reverseCoded: false,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "A string of setbacks in one week rarely changes how hard I work the following week.",
      reverseCoded: false,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "I can absorb a blunt critique in the morning and still do good work that afternoon.",
      reverseCoded: false,
      pairKey: "pair_criticism_recovery",
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "Tight deadlines sharpen my focus rather than wear me down.",
      reverseCoded: false,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "When a plan of mine gets rejected, I start reworking it the same day.",
      reverseCoded: false,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "After my work is criticized, it takes me a few days to get back to working at full effort.",
      reverseCoded: true,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "A couple of rejections in a row makes it hard for me to keep making attempts.",
      reverseCoded: true,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "When a deadline starts slipping out of reach, I find it hard to keep giving full effort.",
      reverseCoded: true,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "One bad outcome early in the day tends to drag down the rest of my day.",
      reverseCoded: true,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "I steer away from tasks where I am likely to hear \"no\" many times before hearing \"yes.\"",
      reverseCoded: true,
    },
    {
      construct: "MENTAL_TOUGHNESS",
      text: "Blunt criticism of my work tends to knock me off track for the rest of the day.",
      reverseCoded: true,
      pairKey: "pair_criticism_recovery",
    },

    // ------------------------------------------------------------------
    // QUESTIONING_PROBING — investigating, asking questions, verifying,
    // not taking things at face value.
    // ------------------------------------------------------------------
    {
      construct: "QUESTIONING_PROBING",
      text: "When someone gives me a figure that matters, I usually check where it came from.",
      reverseCoded: false,
      pairKey: "pair_verify_info",
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "I ask follow-up questions until I could explain the request accurately to someone else.",
      reverseCoded: false,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "Before accepting a claim in a report, I like to see the source it came from.",
      reverseCoded: false,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "When an explanation does not quite add up, I keep asking until it does.",
      reverseCoded: false,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "If instructions leave a gap, I get the missing details before starting rather than guessing.",
      reverseCoded: false,
      pairKey: "pair_clarifying_gaps",
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "When two people give me different accounts of the same event, I dig until I find out which one is accurate.",
      reverseCoded: false,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "If a person sounds confident, I generally take what they tell me at face value.",
      reverseCoded: true,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "Asking a lot of questions feels like an imposition, so I usually make do with what I am told.",
      reverseCoded: true,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "Once a task has been explained to me, I rarely think of anything to ask about it.",
      reverseCoded: true,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "I assume information passed along by a coworker has already been checked by someone.",
      reverseCoded: true,
      pairKey: "pair_verify_info",
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "I would rather start work with partial information than hold things up by asking for more.",
      reverseCoded: true,
    },
    {
      construct: "QUESTIONING_PROBING",
      text: "When directions are vague, I usually fill in the blanks myself rather than go back with questions.",
      reverseCoded: true,
      pairKey: "pair_clarifying_gaps",
    },

    // ------------------------------------------------------------------
    // MOTIVATION — achievement, recognition, incentives, advancement,
    // measurable results vs stability. Neither orientation is superior.
    // ------------------------------------------------------------------
    {
      construct: "MOTIVATION",
      text: "I would take a role with a lower guaranteed wage if strong results could earn me considerably more.",
      reverseCoded: false,
      pairKey: "pair_incentive_pay",
    },
    {
      construct: "MOTIVATION",
      text: "Knowing a promotion is possible changes how I approach my everyday work.",
      reverseCoded: false,
    },
    {
      construct: "MOTIVATION",
      text: "I want my results measured, because that is how I know I am getting somewhere.",
      reverseCoded: false,
    },
    {
      construct: "MOTIVATION",
      text: "Public recognition for a job well done means a great deal to me.",
      reverseCoded: false,
      pairKey: "pair_recognition",
    },
    {
      construct: "MOTIVATION",
      text: "I set targets for myself that go beyond what my role requires.",
      reverseCoded: false,
    },
    {
      construct: "MOTIVATION",
      text: "Within a year of starting a job, I am already thinking about the next step up.",
      reverseCoded: false,
    },
    {
      construct: "MOTIVATION",
      text: "Predictable pay matters more to me than the chance to earn bonuses.",
      reverseCoded: true,
      pairKey: "pair_incentive_pay",
    },
    {
      construct: "MOTIVATION",
      text: "I am content to stay in the same position for years if the work suits me.",
      reverseCoded: true,
    },
    {
      construct: "MOTIVATION",
      text: "Awards and public praise do not add much to my satisfaction with a job.",
      reverseCoded: true,
      pairKey: "pair_recognition",
    },
    {
      construct: "MOTIVATION",
      text: "As long as my work is steady and secure, I do not need it to lead anywhere in particular.",
      reverseCoded: true,
    },
    {
      construct: "MOTIVATION",
      text: "Being passed over for a title change would not bother me much if my day-to-day work stayed the same.",
      reverseCoded: true,
    },
    {
      construct: "MOTIVATION",
      text: "What draws me to a job is dependable routine more than the chance to advance.",
      reverseCoded: true,
    },

    // ------------------------------------------------------------------
    // DISTORTION — impression-management indicators. Improbably perfect
    // behavior; stronger agreement raises the distortion signal.
    // ------------------------------------------------------------------
    {
      construct: "DISTORTION",
      text: "I have never once been late for anything in my working life.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "Every mistake I have ever made at work, I reported immediately.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have liked every supervisor I have ever worked for, without exception.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have never said anything about a coworker that I would not say to their face.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "There has never been a workday on which I gave less than my absolute best.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have never put off an unpleasant task, even for an hour.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have finished every task I have ever started, without exception.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have never felt even a moment of envy at someone else's success.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have never pretended to know something I did not actually know.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have never spent even one minute of company time on a personal matter.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have never once been bored during a meeting.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I read every word of every document before signing it, every single time.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have never raised my voice, even slightly, in any disagreement.",
      reverseCoded: false,
      impressionManagement: true,
    },
    {
      construct: "DISTORTION",
      text: "I have welcomed every piece of criticism I have ever received without a trace of annoyance.",
      reverseCoded: false,
      impressionManagement: true,
    },
  ],
};
