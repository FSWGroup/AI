/**
 * FSW WorkFit — development recommendation templates.
 *
 * Original FSW Group content. One template per developable dimension: the
 * ten behavioral dimensions plus the four aptitude areas that respond to
 * exposure and practice (Business Terms, Awareness and Memory, Vocabulary,
 * Mechanical Interest). Recommendations are concrete workplace actions —
 * systems, routines, practice structures, and feedback loops — written for
 * a development plan, not a performance verdict.
 *
 * All text follows the LANGUAGE RULES in ../narrative-types.ts: practical
 * and work-related, no clinical language, no personality-change framing.
 * Mechanical Interest recommendations build product and technical
 * knowledge; they never ask the person to become someone else.
 */

import type { DevelopmentTemplate } from "../narrative-types";

export const developmentTemplates: DevelopmentTemplate[] = [
  // =========================================================== BEHAVIORAL
  {
    construct: "ENERGY",
    recommendations: [
      "Block the two highest-value tasks of the day into a fixed morning window before opening email or messages.",
      "Track daily output for two weeks in a simple tally (calls made, tickets closed, units finished) to establish a personal baseline before setting stretch targets.",
      "Break long tasks into 25-30 minute focused intervals with a short reset between them, and record how many intervals each recurring task actually takes.",
      "Agree with a manager on one pace metric to review together weekly, so tempo expectations are explicit rather than assumed.",
      "Schedule the most demanding work into the peak-alertness hours the two-week tally reveals, moving low-effort administrative work into the off-peak slots.",
      "End each day by staging tomorrow's first task — materials open, next step written down — so the day starts with motion instead of a decision.",
    ],
  },
  {
    construct: "FLEXIBILITY",
    recommendations: [
      "When a change is announced, write down the first three concrete steps it requires before voicing any objection, then raise concerns once with the decision owner.",
      "Volunteer for one small rotation each quarter — covering another desk, shift, or territory — to build a personal track record of changes handled well.",
      "Keep a change log noting each significant change, the initial concern, and the outcome ninety days later, and review it when the next change lands.",
      "Adopt a standard switching routine between task types: a two-line closing note on the old task, then the first step of the new one written before starting.",
      "Ask a manager to flag one process expected to change next quarter and prepare for it in advance, converting surprise changes into planned ones.",
      "In team discussions of a new approach, state one thing the new way does better before raising what it does worse.",
    ],
  },
  {
    construct: "ORGANIZATION",
    recommendations: [
      "Maintain a single task list in one tool, reviewed at a fixed time each morning, with stray notes and mental reminders migrated into it the same day.",
      "Capture every commitment made in meetings or hallway conversations within one minute — into the list or the calendar — rather than trusting later recall.",
      "Run a fifteen-minute Friday review: close finished items, re-date slipped ones, and pick the top three for Monday.",
      "Give every active project a one-page running note holding the next action, waiting-on items, and due dates, updated at each touch.",
      "Use calendar blocks, not memory, for anything time-bound, including preparation time booked separately from the event itself.",
      "Ask a well-organized colleague to walk through their system once, then adopt one element of it for thirty days before adding more.",
    ],
  },
  {
    construct: "COMMUNICATION",
    recommendations: [
      "Before important conversations, write the single sentence the other person should be able to repeat afterward, and build the conversation around it.",
      "End every substantive discussion by summarizing decisions and next steps aloud, then confirm them in a short written follow-up the same day.",
      "Adopt a fixed update cadence for each active project — a two-line status to stakeholders on a set day — instead of waiting to be asked.",
      "In meetings, ask one clarifying question before offering a position, and note whether the answer changed what you were going to say.",
      "Have a colleague observe one routine presentation or call per month and mark filler phrases, jargon, and unchecked assumptions.",
      "Translate one internal or technical term per week into plain language a new customer would understand, and keep the translations in a shared glossary.",
    ],
  },
  {
    construct: "EMOTIONAL_DEVELOPMENT",
    recommendations: [
      "After receiving critical feedback, wait a day, then write down the one specific behavior to change and a date to check progress with the person who gave it.",
      "Keep a brief weekly wins-and-fixes log — one line each — to build an evidence-based self-view that neither inflates good weeks nor collapses on bad ones.",
      "Rehearse a standard recovery script for visible mistakes ('here is what happened, here is the fix, here is the prevention') so the moment has a procedure instead of improvisation.",
      "Before high-stakes meetings, write the realistic worst case and the planned response to it, converting free-floating pressure into a handled scenario.",
      "Book a monthly ten-minute conversation with one trusted colleague around a standing question: what am I not seeing?",
      "When a setback lands, schedule its post-mortem for a fixed later time and return to the current task, keeping analysis deliberate rather than constant.",
    ],
  },
  {
    construct: "ASSERTIVENESS",
    recommendations: [
      "Prepare one written position statement — view, evidence, request — before any meeting where you have a stake, and commit to voicing it in the first half of the meeting.",
      "Practice direct asks weekly in low-stakes settings — a deadline extension, a resource request — so making requests becomes routine rather than exceptional.",
      "Replace hedged phrasing in emails ('just wondering if maybe') with a direct request and a proposed default: 'I would like X by Friday; if I hear nothing I will proceed.'",
      "When you disagree with a decision, book fifteen minutes with the decision owner within two days rather than raising it in passing or not at all.",
      "Set a personal negotiation rule: never accept the first position without at least one counter-question or counter-proposal.",
      "Debrief one difficult conversation per month with a manager or mentor, focusing on where you conceded and what a firmer alternative would have looked like.",
    ],
  },
  {
    construct: "COMPETITIVENESS",
    recommendations: [
      "Convert team goals into a personal scoreboard: pick two measurable weekly numbers you control and post them where you will see them daily.",
      "Run a brief written post-mortem after each lost deal or missed target separating what was controllable from what was not, and carry one controllable fix into the next attempt.",
      "Pick one benchmark peer with stronger numbers and compare process rather than results — sit in on one of their calls or reviews each month.",
      "Enter one voluntary contest, certification, or ranked activity per quarter to build comfort with head-to-head measurement in low-stakes settings.",
      "Set a beat-yesterday target on one key metric each morning, keeping competition anchored to your own trend line as well as the team's.",
      "Where a team leaderboard exists, review it with a manager on a fixed weekly schedule, translating each gap into a specific skill or activity difference.",
    ],
  },
  {
    construct: "MENTAL_TOUGHNESS",
    recommendations: [
      "After a rejection or setback, complete one small immediate next action — the next call, the next submission — before any analysis, so momentum never fully stops.",
      "Run a brief written post-mortem after each significant loss separating what was controllable from what was not; keep it to one page, then close it.",
      "Track rejection volume alongside wins (for example, contacts per closed sale) so individual refusals read as expected units of the process rather than verdicts.",
      "Rehearse responses to the three most common objections or criticisms in the role until the real thing arrives pre-handled.",
      "Use a fixed reset routine between difficult interactions — stand up, two minutes, notes closed — so each one starts clean.",
      "Ask a manager to review one tough interaction per month and name specifically what was handled well, building a recorded track record of recoveries rather than a remembered one.",
    ],
  },
  {
    construct: "QUESTIONING_PROBING",
    recommendations: [
      "Prepare five written questions before every discovery or requirements conversation, and hold back solutions until at least three are asked and answered.",
      "Practice a three-whys habit on one request per day: ask enough follow-ups to state the requester's real goal in your own words.",
      "Restate every incoming request back to the requester in one sentence and get an explicit yes before starting work.",
      "Keep a running list of assumptions on each project and verify the two most expensive ones each week.",
      "After each finished piece of work, ask the recipient one calibration question — 'what should I have asked earlier?' — and add the answer to your intake checklist.",
      "Sit in with a strong interviewer, seller, or analyst monthly and log the questions they asked that you would not have.",
    ],
  },
  {
    construct: "MOTIVATION",
    recommendations: [
      "Set one written ninety-day goal with a numeric target and a weekly leading indicator, and review both every Friday at a fixed time.",
      "Share each goal with a manager or colleague and book the review meetings in advance, so progress has an audience by design.",
      "Break long-horizon goals into weekly deliverables small enough that each week produces a visible, finishable unit.",
      "Track one simple daily activity metric (calls, drafts, visits) and treat maintaining the streak as the target during weeks when results run slow.",
      "Identify the recurring task you most consistently defer and pin it to the same fixed slot each day for a month.",
      "Keep a one-line purpose statement for each major goal at the top of the task list, and rewrite it whenever the goal changes shape or owner.",
    ],
  },

  // ===================================== APTITUDE AREAS BUILT BY EXPOSURE
  {
    construct: "BUSINESS_TERMS",
    recommendations: [
      "Keep a personal glossary of unknown terms encountered in meetings and documents, adding definitions the same day and reviewing ten entries each Friday.",
      "Read one industry or trade article per day and summarize it in two sentences, flagging any term that needed a lookup.",
      "Ask finance or operations colleagues to walk through one core document each month — an invoice, a profit-and-loss summary, a purchase order — line by line.",
      "Sit in on one commercial meeting per month outside your own function, such as a pricing review or vendor negotiation, purely to hear terms used in context.",
      "Complete a short structured course on business fundamentals and apply one concept per week to a live example from your own workplace.",
      "Explain one commercial concept per week to a colleague in plain language, since teaching exposes gaps faster than reading does.",
    ],
  },
  {
    construct: "AWARENESS_MEMORY",
    recommendations: [
      "Carry one capture tool everywhere — a pocket notebook or a phone note — and record names, numbers, and commitments within a minute of hearing them.",
      "Say a new contact's name aloud twice in the first conversation and record it with one distinguishing detail immediately afterward.",
      "Convert verbal instructions into an on-the-spot read-back: 'So I will do X by Y — anything I am missing?'",
      "Start each shift or day with a two-minute review of yesterday's notes and open details before taking in new information.",
      "Use checklists for any recurring multi-step task, and update the checklist the same day any step is missed.",
      "At the end of each customer or stakeholder interaction, log three facts worth keeping into the account record or file while they are fresh.",
    ],
  },
  {
    construct: "VOCABULARY",
    recommendations: [
      "Read fifteen minutes of demanding material daily — trade press, quality journalism, technical documentation — and record three unknown words with their meanings.",
      "Review the running word list weekly and deliberately use two of the new words in written work where they genuinely fit.",
      "Draft important emails, set them aside, and revise once specifically for word choice: replace vague terms with exact ones and cut anything decorative.",
      "Keep a bank of well-written examples from your field — clear proposals, strong reports — and imitate one structure per month in your own writing.",
      "Look up unknown words in documents instead of skipping them, and flag any term that appears three or more times in your role's material for permanent learning.",
      "Ask a strong writer to mark up one piece of your written work per month, focusing on precision rather than grammar alone.",
    ],
  },
  {
    construct: "MECHANICAL_INTEREST",
    recommendations: [
      "Block thirty minutes weekly to study one product spec sheet, writing three plain-language sentences on what the product does, for whom, and how it differs from its nearest alternative.",
      "Shadow a technician, installer, or engineer for half a day each quarter and keep a log of the questions customers actually asked them.",
      "Build a personal reference of the ten most common technical questions in the role and refine one answer per week with input from technical staff.",
      "For each product sold or supported, learn the three components or steps most often responsible for problems, rather than attempting full technical depth at once.",
      "Attend vendor or manufacturer training sessions when offered and convert each one into a single page of notes reusable in customer conversations.",
      "Pair with a technically strong colleague on one live customer issue per month, handling the conversation while they handle the depth, then swap notes afterward.",
    ],
  },
];
