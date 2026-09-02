/**
 * FSW Talent Scout — structured interview guide templates.
 *
 * Original FSW Group content. Each scored dimension carries two templates:
 * BELOW_RANGE (probing whether an assessed lower standing shows up in real
 * work, and how the candidate compensates) and ABOVE_RANGE (probing fit
 * considerations that can accompany a result above the role's desired
 * range). The two response-quality indicators each carry one VALIDITY
 * template of neutral, information-gathering questions.
 *
 * All text follows the LANGUAGE RULES in ../narrative-types.ts:
 * probabilistic phrasing, no absolutes, no clinical language, and no
 * suggestion that a candidate be confronted or accused. Every question asks
 * for an actual past example, with alternate wording for candidates whose
 * experience comes mainly from school, volunteering, sports, projects, or
 * community activities.
 */

import type { InterviewTemplate } from "../narrative-types";

export const interviewTemplates: InterviewTemplate[] = [
  // ============================================================ APTITUDES
  // ------------------------------------------------------- MENTAL ACUITY
  {
    construct: "MENTAL_ACUITY",
    focus: "BELOW_RANGE",
    measures:
      "Mental Acuity reflects how quickly the candidate tends to absorb new information, connect ideas, and reason through problems they have not seen before.",
    questions: [
      {
        question:
          "Tell me about a time when you had to get up to speed quickly on a new system, product, or process. How did you go about learning it, and how long before you were comfortable?",
        altWording:
          "Tell me about a time in school, a club, or a volunteer role when you had to pick up something completely new on a short timeline. How did you go about learning it?",
        listenFor:
          "Listen for a concrete learning routine — written notes, repetition, practice runs, targeted questions to experienced people — rather than a vague claim of being a fast learner. A specific method suggests the candidate can close knowledge gaps dependably even when new material comes slowly at first.",
      },
      {
        question:
          "Walk me through a situation where a problem at work turned out to be more complicated than it first appeared. What did you do?",
        altWording:
          "Walk me through a school project or team situation that turned out to be more complicated than expected. What did you do?",
        listenFor:
          "A substantive answer breaks the problem into steps, names where the candidate sought input or checked their reasoning, and describes the outcome. Listen for whether they slowed down deliberately rather than guessing.",
      },
      {
        question:
          "Describe a time you made a mistake because you misread or misunderstood something. How did you catch it, and what did you change afterward?",
        altWording:
          "Describe a time you got something wrong on an assignment or in a group activity because you misunderstood the instructions. How did you catch it, and what did you change?",
        listenFor:
          "Ownership of the error, a specific correction, and a durable safeguard — checklists, read-backs, confirming instructions in writing — suggest the candidate manages the practical effects of a more deliberate processing pace.",
      },
    ],
  },
  {
    construct: "MENTAL_ACUITY",
    focus: "ABOVE_RANGE",
    measures:
      "Mental Acuity reflects how quickly the candidate tends to absorb new information, connect ideas, and reason through problems they have not seen before.",
    questions: [
      {
        question:
          "Tell me about the most repetitive stretch of work you have had. How did you keep your accuracy and your interest up over time?",
        altWording:
          "Tell me about a repetitive task you took on — data entry for a club, drills in a sport, filing as a volunteer. How did you keep your accuracy and interest up?",
        listenFor:
          "Listen for realistic strategies for staying engaged — self-set quality targets, small process improvements, deliberate pacing — rather than an admission of coasting. Restlessness with routine may indicate a fit risk if the role is largely repetitive.",
      },
      {
        question:
          "Describe a time you finished your work well ahead of others and had to wait. What did you do with that time?",
        altWording:
          "Describe a class or team setting where you regularly finished ahead of everyone else. What did you do with the extra time?",
        listenFor:
          "Constructive use of slack time — helping teammates, improving documentation, quality-checking — suggests the candidate channels quick processing productively instead of disengaging or creating friction.",
      },
      {
        question:
          "Tell me about a time you got impatient with a process, or with people who worked through things more slowly than you. How did you handle it?",
        altWording:
          "Tell me about a group project where teammates moved more slowly than you would have liked. How did you handle it?",
        listenFor:
          "Self-awareness about impatience and specific behaviors for keeping it in check — adjusting explanations, sharing the reasoning behind conclusions — suggest the candidate can work at a team's pace without frustration showing through.",
      },
    ],
  },
  // ------------------------------------------------------- BUSINESS TERMS
  {
    construct: "BUSINESS_TERMS",
    focus: "BELOW_RANGE",
    measures:
      "Business Terms reflects the candidate's working knowledge of everyday commercial vocabulary and concepts — the language of pricing, invoices, contracts, and customers.",
    questions: [
      {
        question:
          "Tell me about a time you had to work with business paperwork or terminology that was new to you — contracts, invoices, pricing, reports. How did you handle it?",
        altWording:
          "Tell me about a time in a club, fundraiser, or part-time role when you dealt with money, budgets, or official paperwork for the first time. How did you handle it?",
        listenFor:
          "Listen for whether the candidate asked for definitions, found reference material, or checked their understanding with someone experienced rather than pushing through on guesswork. A repeatable habit for closing vocabulary gaps suggests the gap is manageable on the job.",
      },
      {
        question:
          "Walk me through a situation where you had to explain a price, policy, or the terms of an agreement to someone. How did you prepare?",
        altWording:
          "Walk me through a time you had to explain the rules, costs, or sign-up terms of an event or activity to someone. How did you prepare?",
        listenFor:
          "Preparation habits — confirming details in advance, writing key numbers down, rehearsing the explanation — suggest the candidate compensates for developing commercial vocabulary with diligence.",
      },
      {
        question:
          "Describe a situation where a misunderstanding about business details — an order, a charge, a deadline — caused a problem. What was your part in resolving it?",
        altWording:
          "Describe a time a mix-up about money, schedules, or commitments caused a problem in a group you were part of. What was your part in sorting it out?",
        listenFor:
          "A substantive answer names the specific misunderstanding, the candidate's own contribution to it and to the fix, and what they now do differently. Vague blame-shifting suggests the gap may surface in customer-facing work.",
      },
    ],
  },
  {
    construct: "BUSINESS_TERMS",
    focus: "ABOVE_RANGE",
    measures:
      "Business Terms reflects the candidate's working knowledge of everyday commercial vocabulary and concepts — the language of pricing, invoices, contracts, and customers.",
    questions: [
      {
        question:
          "Tell me about a time you had to explain a commercial concept to someone with no business background. How did you adjust your explanation?",
        altWording:
          "Tell me about a time you had to explain budgeting, fundraising math, or event costs to people who had never dealt with them. How did you adjust?",
        listenFor:
          "Listen for deliberate translation — plain words, everyday examples, checking understanding — rather than pride in the vocabulary itself. Difficulty simplifying may indicate friction in roles where most contacts are not business-fluent.",
      },
      {
        question:
          "Describe a role or project where the commercial side was much simpler than what you were used to. What kept it worthwhile for you?",
        altWording:
          "Describe a time you took on a straightforward money task — a simple treasurer job, basic bookkeeping for an event — after handling more involved ones. What kept it worthwhile?",
        listenFor:
          "Realistic sources of engagement — service quality, relationships, throughput — suggest the candidate can stay motivated when the role does not use their full commercial range. Listen for signs the simplicity itself became a standing complaint.",
      },
      {
        question:
          "Tell me about a time a colleague or customer used a business term incorrectly or misunderstood a standard practice. What did you do?",
        altWording:
          "Tell me about a time a teammate misunderstood the rules or the money side of an activity you knew well. What did you do?",
        listenFor:
          "Tact matters more than correctness here: a substantive answer shows the candidate protecting the other person's footing while fixing the substance. Condescension in the retelling may indicate fit risk with less experienced colleagues.",
      },
    ],
  },
  // -------------------------------------------------- AWARENESS AND MEMORY
  {
    construct: "AWARENESS_MEMORY",
    focus: "BELOW_RANGE",
    measures:
      "Awareness and Memory reflects how dependably the candidate notices, retains, and recalls workplace details — names, instructions, product facts, and recent events.",
    questions: [
      {
        question:
          "Tell me about a time you had to keep track of many details at once — orders, requests, follow-ups. What systems did you use, and how well did they hold up?",
        altWording:
          "Tell me about a time you had to keep track of lots of details — event logistics, team schedules, assignment requirements. What did you use to stay on top of them?",
        listenFor:
          "Listen for external systems — written notes, checklists, confirmations, calendar entries — used consistently, not only during crunches. Dependable capture habits suggest the candidate manages detail work well despite a lighter natural recall.",
      },
      {
        question:
          "Describe a specific time a detail slipped past you at work — a name, an instruction, a step. What happened, and what did you change?",
        altWording:
          "Describe a time you forgot a commitment or missed a detail in school or a volunteer role. What happened, and what did you change?",
        listenFor:
          "Ownership plus a concrete new safeguard is the substantive pattern. An answer that treats missed details as unavoidable, with no changed routine, suggests the pattern may recur.",
      },
      {
        question:
          "Walk me through a job or task where instructions came verbally and quickly. How did you make sure nothing was lost?",
        altWording:
          "Walk me through a time a coach, teacher, or organizer gave you a string of verbal instructions. How did you make sure nothing was lost?",
        listenFor:
          "Behaviors like repeating instructions back, writing them down immediately, or confirming in writing afterward suggest a working compensation routine. Listen for whether the routine survived busy periods.",
      },
    ],
  },
  {
    construct: "AWARENESS_MEMORY",
    focus: "ABOVE_RANGE",
    measures:
      "Awareness and Memory reflects how dependably the candidate notices, retains, and recalls workplace details — names, instructions, product facts, and recent events.",
    questions: [
      {
        question:
          "Tell me about a time your attention to detail put you at odds with people who wanted to move faster. How did you resolve it?",
        altWording:
          "Tell me about a group project where you noticed problems others wanted to skip past. How did you resolve it?",
        listenFor:
          "Listen for judgment about which details genuinely mattered and a willingness to let minor ones go. A pattern of treating every detail as blocking may indicate friction in fast-moving roles.",
      },
      {
        question:
          "Describe a situation where you remembered something a colleague or customer had forgotten. How did you use that?",
        altWording:
          "Describe a time you were the one who remembered the plan, the score, or the commitment everyone else had lost track of. How did you handle it?",
        listenFor:
          "A substantive answer uses recall in service of the relationship or the outcome, not as a scorecard. Retellings that dwell on others' lapses may indicate fit risk on teams with looser habits.",
      },
      {
        question:
          "Tell me about a stretch of work that offered very little detail to engage with — simple, well-worn tasks. How did that sit with you?",
        altWording:
          "Tell me about a routine, low-detail role you took on — handing out programs, simple setup work. How did that sit with you?",
        listenFor:
          "Listen for whether the candidate found legitimate engagement or grew restless. Restlessness is not automatically negative, but it may indicate a mismatch if the open role is light on detail work.",
      },
    ],
  },
  // ----------------------------------------------------------- VOCABULARY
  {
    construct: "VOCABULARY",
    focus: "BELOW_RANGE",
    measures:
      "Vocabulary reflects the breadth and precision of the candidate's word knowledge, which supports understanding written material and expressing ideas exactly.",
    questions: [
      {
        question:
          "Tell me about a time you had to read and act on dense written material — a manual, a policy, a contract. How did you work through it?",
        altWording:
          "Tell me about a time you had to work through difficult reading — a textbook chapter, official rules, application instructions. How did you work through it?",
        listenFor:
          "Listen for practical tactics: rereading, looking terms up, summarizing in their own words, asking someone to confirm their reading. A routine like this suggests written complexity is manageable with a little extra time.",
      },
      {
        question:
          "Describe a situation where you struggled to find the right words in an important conversation — with a customer, a manager, or a colleague. What did you do?",
        altWording:
          "Describe a time you had trouble putting your point across in a class discussion, interview, or meeting. What did you do?",
        listenFor:
          "Substantive answers show recovery behavior — pausing, using an example, checking whether the message landed. Listen for whether the candidate confirms understanding rather than assuming it.",
      },
      {
        question:
          "Walk me through how you prepared the last time you had to write something important — an email to a customer, a report, a formal request.",
        altWording:
          "Walk me through how you prepared an important piece of writing — an application essay, a letter for a club, a speech.",
        listenFor:
          "Drafting habits, review by a second reader, and rewriting for plainness suggest the candidate produces clear written work despite a narrower word range. Listen for a repeatable process, not a one-time effort.",
      },
    ],
  },
  {
    construct: "VOCABULARY",
    focus: "ABOVE_RANGE",
    measures:
      "Vocabulary reflects the breadth and precision of the candidate's word knowledge, which supports understanding written material and expressing ideas exactly.",
    questions: [
      {
        question:
          "Tell me about a time you realized your explanation had gone over someone's head. How did you notice, and what did you change?",
        altWording:
          "Tell me about a time classmates or teammates did not follow what you were saying. How did you notice, and what did you change?",
        listenFor:
          "Listen for active audience-reading — watching reactions, inviting questions — and a genuine shift to plainer wording. Difficulty producing a simpler version on the spot may indicate friction in roles built on everyday conversation.",
      },
      {
        question:
          "Describe a situation where precise wording really mattered — and another where you had to let precision go to keep things moving.",
        altWording:
          "Describe a time exact wording mattered in something you wrote or presented — and a time you had to keep it rough and quick instead.",
        listenFor:
          "The substantive pattern is range: the candidate can name when precision earns its cost and when it becomes an obstacle. A one-sided answer favoring precision everywhere may indicate fit risk in fast, informal environments.",
      },
      {
        question:
          "Tell me about a time someone told you that you sounded too formal, wordy, or 'like a textbook.' What did you take from that?",
        altWording:
          "Tell me about feedback you received on being too formal or wordy in a presentation or paper. What did you take from it?",
        listenFor:
          "Non-defensive processing of the feedback and a specific adjustment suggest the candidate calibrates language to the setting. Dismissing the feedback as the listener's problem is the pattern to note.",
      },
    ],
  },
  // ------------------------------------------------- NUMERICAL PERCEPTION
  {
    construct: "NUMERICAL_PERCEPTION",
    focus: "BELOW_RANGE",
    measures:
      "Numerical Perception reflects how quickly and accurately the candidate works with figures — checking totals, spotting discrepancies, and handling everyday workplace arithmetic.",
    questions: [
      {
        question:
          "Tell me about a time your work involved numbers that had to be right — pricing, counts, measurements, cash handling. How did you make sure of accuracy?",
        altWording:
          "Tell me about a time you handled money or numbers for a club, event, or fundraiser. How did you make sure the figures were right?",
        listenFor:
          "Listen for concrete verification habits — double-checks, calculators used by default, a second set of eyes on important totals. Dependable safeguards suggest routine numeric work is manageable even if raw speed with figures is modest.",
      },
      {
        question:
          "Describe a specific numeric mistake you made or nearly made. How was it caught, and what did you change?",
        altWording:
          "Describe a time you miscounted, mismeasured, or misadded something that mattered. How was it caught, and what did you change?",
        listenFor:
          "Ownership and a durable process change are the substance. Answers where errors were only ever caught by someone else, with no new safeguard, suggest the pattern may continue.",
      },
      {
        question:
          "Walk me through a task where you had to work with figures under time pressure. How did you balance speed and accuracy?",
        altWording:
          "Walk me through a timed situation involving numbers — scoring a match, running a cash box at an event. How did you balance speed and accuracy?",
        listenFor:
          "A substantive answer names an explicit trade-off — slowing on high-stakes figures, batching checks — rather than claiming both were maximized. Listen for awareness of where their accuracy starts to slip.",
      },
    ],
  },
  {
    construct: "NUMERICAL_PERCEPTION",
    focus: "ABOVE_RANGE",
    measures:
      "Numerical Perception reflects how quickly and accurately the candidate works with figures — checking totals, spotting discrepancies, and handling everyday workplace arithmetic.",
    questions: [
      {
        question:
          "Tell me about a time you spotted a numeric error others had missed. What did you do with it?",
        altWording:
          "Tell me about a time you noticed the math was off in a group budget, score sheet, or plan. What did you do?",
        listenFor:
          "The interest is in delivery: raising the error in a way that fixed the problem without diminishing anyone. A habit of public corrections may indicate friction, even when the candidate is right.",
      },
      {
        question:
          "Describe a stretch of work where the numbers side was far simpler than what you were capable of. How did you keep your standards and interest up?",
        altWording:
          "Describe a time you handled very basic number tasks — simple tallies, basic scorekeeping — for a long stretch. How did you keep your interest up?",
        listenFor:
          "Realistic engagement strategies — accuracy streaks, process improvements, throughput goals — suggest the candidate stays sharp on routine figures. Boredom that led to errors is the risk pattern to listen for.",
      },
      {
        question:
          "Tell me about a time you wanted more data before deciding, but others were ready to move. What happened?",
        altWording:
          "Tell me about a group decision where you wanted to run the numbers first and others just wanted to pick. What happened?",
        listenFor:
          "Listen for calibrated judgment — knowing when the additional analysis was worth the delay and when it was not. An answer where analysis consistently overrode timeliness may indicate a fit risk in decision-paced roles.",
      },
    ],
  },
  // -------------------------------------------------- MECHANICAL INTEREST
  {
    construct: "MECHANICAL_INTEREST",
    focus: "BELOW_RANGE",
    measures:
      "Mechanical Interest reflects how much the candidate is drawn to how products, tools, and physical systems work — an interest pattern, not a measure of skill.",
    questions: [
      {
        question:
          "Tell me about a time you had to learn the technical side of a product or piece of equipment for a job. How did you approach it, and how deep did you go?",
        altWording:
          "Tell me about a time you had to learn how something worked — stage equipment for a school event, gear for a sport, tools for a volunteer build. How did you approach it?",
        listenFor:
          "Listen for a workable learning method and a realistic sense of the depth the role required. Candidates lower in mechanical interest can perform well when they build product knowledge deliberately; the substance is the routine, not the enthusiasm.",
      },
      {
        question:
          "Describe a situation where a customer or colleague asked you a technical question you could not answer. What did you do in the moment, and afterward?",
        altWording:
          "Describe a time someone asked you how something worked and you did not know. What did you do in the moment, and afterward?",
        listenFor:
          "A substantive answer shows a straightforward 'let me find out,' a prompt follow-up, and the answer added to their working knowledge. Improvising an answer, or never closing the loop, is the pattern to note.",
      },
      {
        question:
          "Walk me through how you kept product or equipment knowledge current in a past role.",
        altWording:
          "Walk me through how you kept up with the rules, gear, or tools in an activity you were part of.",
        listenFor:
          "Listen for any repeatable habit — reading spec material, asking technical staff, hands-on practice — however modest. The absence of any habit suggests product knowledge may plateau without added structure.",
      },
    ],
  },
  {
    construct: "MECHANICAL_INTEREST",
    focus: "ABOVE_RANGE",
    measures:
      "Mechanical Interest reflects how much the candidate is drawn to how products, tools, and physical systems work — an interest pattern, not a measure of skill.",
    questions: [
      {
        question:
          "Tell me about a time your interest in how something worked pulled you deeper into a problem than the job actually needed. What happened?",
        altWording:
          "Tell me about a time you got absorbed in figuring out how something worked — a device, a game system, a build — when the group just needed a quick fix. What happened?",
        listenFor:
          "Self-awareness about the pull and evidence they can cap it — setting a time limit, handing off, returning to the customer-facing task — suggest the interest is an asset. Repeated stories of disappearing into technical depth may indicate fit risk in service-paced roles.",
      },
      {
        question:
          "Describe a time you explained something technical to someone who only wanted the simple answer. How did you handle it?",
        altWording:
          "Describe a time you explained equipment or rules to someone who just wanted the short version. How did you handle it?",
        listenFor:
          "Listen for the candidate meeting the listener's actual need — the short answer first, depth only on request. Frustration with people who 'don't care how it works' may indicate friction with non-technical customers.",
      },
      {
        question:
          "Tell me about a role or stretch of work with little technical content. How satisfying was it, and why?",
        altWording:
          "Tell me about an activity with no technical side at all — front-desk volunteering, ushering, greeting. How satisfying was it, and why?",
        listenFor:
          "A candid answer about where their engagement comes from helps calibrate fit. If satisfaction depended entirely on technical content, a role light on it may not hold their interest.",
      },
    ],
  },

  // =========================================================== BEHAVIORAL
  // --------------------------------------------------------------- ENERGY
  {
    construct: "ENERGY",
    focus: "BELOW_RANGE",
    measures:
      "Energy reflects the candidate's typical working pace and capacity for sustained activity across a full day or a busy season.",
    questions: [
      {
        question:
          "Tell me about the busiest sustained period you have worked — a rush season, a launch, a staffing gap. How did you manage your output across it?",
        altWording:
          "Tell me about your busiest sustained stretch — exam season plus a job, tournament weeks, a big event build-up. How did you manage your output across it?",
        listenFor:
          "Listen for deliberate workload management — prioritization, steady routines, protected recovery time — and for whether commitments were actually met. Meeting the load with a measured style is a workable pattern; missed commitments are the concern.",
      },
      {
        question:
          "Describe a time you fell behind on volume — more tasks than hours. What did you do?",
        altWording:
          "Describe a time you had more on your plate than time to do it — assignments, practices, obligations. What did you do?",
        listenFor:
          "Substantive answers show early escalation, renegotiated priorities, or found efficiencies rather than silent slippage. Listen for who found out they were behind, and when.",
      },
      {
        question:
          "Walk me through a typical high-tempo day in your last role. Which parts of the pace suited you, and which wore on you?",
        altWording:
          "Walk me through your fullest regular day — school, practice, work, other commitments. Which parts of the pace suited you, and which wore on you?",
        listenFor:
          "Candid self-knowledge about pace is the substance. Compare the pace they describe as comfortable against this role's actual tempo, rather than expecting a claim of limitless stamina.",
      },
    ],
  },
  {
    construct: "ENERGY",
    focus: "ABOVE_RANGE",
    measures:
      "Energy reflects the candidate's typical working pace and capacity for sustained activity across a full day or a busy season.",
    questions: [
      {
        question:
          "Tell me about a time your pace ran ahead of the team's or the process's. What did that create, and how did you handle it?",
        altWording:
          "Tell me about a group project where you were ready to move long before everyone else. What did that create, and how did you handle it?",
        listenFor:
          "Listen for productive channeling — picking up adjacent work, prepping next steps — versus pressure that frayed the team. Awareness of the effect on others is the key signal.",
      },
      {
        question:
          "Describe a time you took on too much at once. How did you notice, and what gave?",
        altWording:
          "Describe a semester or season where you signed up for too much. How did you notice, and what gave?",
        listenFor:
          "A substantive answer includes a real correction — dropping, delegating, sequencing — not just pushing harder. A habit of chronic overcommitment without adjustment may indicate quality or follow-through risk.",
      },
      {
        question:
          "Tell me about work that required you to sit with slow, waiting-heavy tasks — approvals, long lead times. How did you handle the downtime?",
        altWording:
          "Tell me about an activity with lots of waiting — tech rehearsals, tournament downtime, long bus rides between events. How did you handle it?",
        listenFor:
          "Listen for constructive patience: useful work found in the gaps, without pushing the process off its rails. Restlessness that turned into workarounds or skipped steps is the risk pattern.",
      },
    ],
  },
  // ---------------------------------------------------------- FLEXIBILITY
  {
    construct: "FLEXIBILITY",
    focus: "BELOW_RANGE",
    measures:
      "Flexibility reflects how readily the candidate adjusts to changed priorities, methods, and circumstances.",
    questions: [
      {
        question:
          "Tell me about a time a plan you had invested in was changed late. Walk me through your first day under the new plan.",
        altWording:
          "Tell me about a time an event, project, or team plan you had worked on was changed at the last minute. Walk me through what you did next.",
        listenFor:
          "Some friction is normal; the substance is the transition — how quickly the candidate moved from objection to execution, and what the changeover cost. Listen for whether concerns were raised through the right channel and then set down.",
      },
      {
        question:
          "Describe a situation where you had to switch between very different tasks or roles in the same day. How did that go?",
        altWording:
          "Describe a day you had to jump between very different responsibilities — class, job, rehearsal, family obligations. How did that go?",
        listenFor:
          "Practical switching routines — closing notes, short reset habits, batching similar work — suggest the candidate manages change with structure. Listen for what happens to quality on the second and third switch.",
      },
      {
        question:
          "Tell me about a change at work you initially thought was a mistake. What did you do, and how did it play out?",
        altWording:
          "Tell me about a rule or plan change in a group you belonged to that you thought was wrong. What did you do, and how did it play out?",
        listenFor:
          "The strongest answers show disagreement voiced once through the right channel, genuine effort under the new approach, and a fair read of the result — including being wrong. Quiet non-compliance is the pattern to note.",
      },
    ],
  },
  {
    construct: "FLEXIBILITY",
    focus: "ABOVE_RANGE",
    measures:
      "Flexibility reflects how readily the candidate adjusts to changed priorities, methods, and circumstances.",
    questions: [
      {
        question:
          "Tell me about a time you changed approach mid-task and later wished you had stayed the course. What did you take from it?",
        altWording:
          "Tell me about a time you switched plans partway through a project or game and it cost you. What did you take from it?",
        listenFor:
          "Listen for whether the candidate has built any brake on their own changeability — criteria for when to switch, a habit of finishing before pivoting. Change treated as inherently good may indicate follow-through risk.",
      },
      {
        question:
          "Describe a long stretch of doing the same thing the same way because that was what the job needed. How did you keep at it?",
        altWording:
          "Describe a role where you repeated the same routine for months — a practice regimen, a weekly volunteer shift. How did you keep at it?",
        listenFor:
          "Sustained consistency with a stable process is the evidence sought here. If every example includes the candidate rewriting the process, weigh whether this role rewards that.",
      },
      {
        question:
          "Walk me through a time you had to follow a procedure exactly, even though you saw a better way. What did you do with your idea?",
        altWording:
          "Walk me through a time you had to follow the official rules of an event or competition despite seeing a better way. What did you do with your idea?",
        listenFor:
          "The workable pattern is compliance first, improvement proposed through channels second. Listen for respect for why procedures exist, not just tolerance of them.",
      },
    ],
  },
  // --------------------------------------------------------- ORGANIZATION
  {
    construct: "ORGANIZATION",
    focus: "BELOW_RANGE",
    measures:
      "Organization reflects how the candidate structures work — planning ahead, tracking commitments, and keeping tasks, materials, and time in order.",
    questions: [
      {
        question:
          "Tell me about a time you were responsible for keeping several commitments moving at once. What did you actually use to track them, and where did it strain?",
        altWording:
          "Tell me about balancing several obligations at once — classes, practices, a job. What did you actually use to keep track, and where did it strain?",
        listenFor:
          "Ask to hear the real system — a list, an app, a calendar — and how consistently it was used. A borrowed or externally imposed structure the candidate genuinely maintained is a good sign; 'I keep it in my head' is the pattern to test further.",
      },
      {
        question:
          "Describe a deadline you missed or nearly missed because something fell through the cracks. What changed afterward?",
        altWording:
          "Describe an assignment or commitment you missed or nearly missed because it slipped your mind. What changed afterward?",
        listenFor:
          "The substance is a durable new mechanism, not renewed intention. Listen for whether the fix survived the next busy period.",
      },
      {
        question:
          "Walk me through how you started a typical workday in your last role — the first thirty minutes.",
        altWording:
          "Walk me through how you started a typical school or activity day — the first thirty minutes.",
        listenFor:
          "A stable opening routine — reviewing a list, checking messages against priorities — suggests workable structure. A day that starts wherever the first interruption points it may indicate the assessed pattern shows up in practice.",
      },
    ],
  },
  {
    construct: "ORGANIZATION",
    focus: "ABOVE_RANGE",
    measures:
      "Organization reflects how the candidate structures work — planning ahead, tracking commitments, and keeping tasks, materials, and time in order.",
    questions: [
      {
        question:
          "Tell me about a time your plan for the day was upended by something urgent. What happened to the rest of the plan?",
        altWording:
          "Tell me about a day your schedule fell apart because something urgent came up. What happened to the rest of your plan?",
        listenFor:
          "Listen for graceful triage — re-sorting rather than defending the original plan. Distress at deviation, or urgency handled only after the planned items, may indicate rigidity in fast-changing work.",
      },
      {
        question:
          "Describe working closely with someone much less structured than you. What did you do about the difference?",
        altWording:
          "Describe a group project with a teammate far less organized than you. What did you do about the difference?",
        listenFor:
          "The strong pattern is lightweight shared structure that helped without imposing the candidate's full system on others. Listen for judgment about how much order the situation actually required.",
      },
      {
        question:
          "Tell me about a time preparing or perfecting the plan started to cost more than it returned. How did you catch it?",
        altWording:
          "Tell me about a time you over-prepared — for an event, a presentation — and it crowded out the actual work. How did you catch it?",
        listenFor:
          "Self-awareness that planning has a price, plus an example of deliberately proceeding at 'good enough,' suggests the candidate can flex. No such example may indicate speed risk in deadline-heavy roles.",
      },
    ],
  },
  // -------------------------------------------------------- COMMUNICATION
  {
    construct: "COMMUNICATION",
    focus: "BELOW_RANGE",
    measures:
      "Communication reflects how readily and clearly the candidate exchanges information — speaking up, explaining, and keeping others informed.",
    questions: [
      {
        question:
          "Tell me about a time you had to deliver a complicated message and it really mattered that it landed. How did you make sure it did?",
        altWording:
          "Tell me about a time you had to explain something complicated to a group — a project plan, event instructions. How did you make sure it landed?",
        listenFor:
          "Listen for verification behavior — questions invited, understanding checked, a written follow-up. Quieter candidates who build confirmation loops can be dependable communicators; the loop is the substance.",
      },
      {
        question:
          "Describe a situation where staying quiet cost you or the team something. What did you take from it?",
        altWording:
          "Describe a time you held back a question or concern in class or on a team and it cost something. What did you take from it?",
        listenFor:
          "Ownership and a changed behavior — a personal rule like 'if I'm confused, someone else is' — are the substance. Listen for a real later example of speaking up.",
      },
      {
        question:
          "Walk me through how you kept a manager or teammate informed on a long-running piece of work.",
        altWording:
          "Walk me through how you kept a teacher, coach, or organizer updated during a long project.",
        listenFor:
          "A proactive cadence — regular short updates without being asked — suggests the assessed pattern is offset by habit. Updates that only happened when requested may indicate the pattern operates on the job.",
      },
    ],
  },
  {
    construct: "COMMUNICATION",
    focus: "ABOVE_RANGE",
    measures:
      "Communication reflects how readily and clearly the candidate exchanges information — speaking up, explaining, and keeping others informed.",
    questions: [
      {
        question:
          "Tell me about a meeting or conversation where you realized afterward you had done most of the talking. What did you do about it?",
        altWording:
          "Tell me about a group discussion you realized you had dominated. What did you do about it?",
        listenFor:
          "Listen for genuine self-monitoring — deliberate questions, tracking airtime, inviting quieter voices — with a concrete later example. Treating a high talk-share as simply natural may indicate listening risk.",
      },
      {
        question:
          "Describe a time you learned something important only because you stopped explaining and started asking. What was it?",
        altWording:
          "Describe a time you found out something important in a group only after you stopped talking and asked questions. What was it?",
        listenFor:
          "The substantive answer shows the candidate valuing inbound information, with a specific discovery that changed their approach. Listen for whether asking is a practiced behavior or a one-off.",
      },
      {
        question:
          "Tell me about a time your directness or sheer volume of communication was too much for someone — a customer, a colleague. How did you find out, and what changed?",
        altWording:
          "Tell me about feedback that you talked too much or too strongly in a team or class setting. How did you find out, and what changed?",
        listenFor:
          "Non-defensive receipt of the feedback and a durable calibration are the substance. A retelling that centers on the other person's oversensitivity is the pattern to note.",
      },
    ],
  },
  // ---------------------------------------------- EMOTIONAL DEVELOPMENT
  {
    construct: "EMOTIONAL_DEVELOPMENT",
    focus: "BELOW_RANGE",
    measures:
      "Emotional Development reflects the candidate's composure and steadiness of self-view — taking feedback, absorbing setbacks, and staying even under stress.",
    questions: [
      {
        question:
          "Tell me about the most direct critical feedback you have received at work. What did you do in the week that followed?",
        altWording:
          "Tell me about the most direct critical feedback you have received from a teacher, coach, or team leader. What did you do in the week that followed?",
        listenFor:
          "The week matters more than the moment: listen for a specific behavioral change and any follow-up the candidate sought. An initial sting is normal; dwelling on it without action is the pattern to note.",
      },
      {
        question:
          "Describe a stressful situation at work where you felt your reaction starting to show. How did you manage it, and what did others see?",
        altWording:
          "Describe a high-pressure moment — a big game, a performance, an exam period — where your reaction started to show. How did you manage it?",
        listenFor:
          "Listen for a practiced steadying routine — a pause, a reset, a brief step away with a return — and candid awareness of what showed through. Claiming stress never shows may be less credible than a managed wobble.",
      },
      {
        question:
          "Walk me through a mistake that was clearly yours, made in front of others. What did you say at the time, and what happened next?",
        altWording:
          "Walk me through a visible mistake in front of a class or team. What did you say at the time, and what happened next?",
        listenFor:
          "A clean, prompt ownership statement followed by repair suggests workable steadiness. Extended self-criticism or deflection in the retelling may indicate the assessed pattern operates under pressure.",
      },
    ],
  },
  {
    construct: "EMOTIONAL_DEVELOPMENT",
    focus: "ABOVE_RANGE",
    measures:
      "Emotional Development reflects the candidate's composure and steadiness of self-view — taking feedback, absorbing setbacks, and staying even under stress.",
    questions: [
      {
        question:
          "Tell me about a time your confidence turned out to be miscalibrated — you were more certain than the situation warranted. What happened?",
        altWording:
          "Tell me about a time you were sure you were right — about a play, an answer, a plan — and were not. What happened?",
        listenFor:
          "Listen for whether contrary evidence got in, how fast, and what checking habits followed. An answer where being wrong is reframed as being nearly right may indicate resistance to feedback.",
      },
      {
        question:
          "Describe a situation where someone on your team was visibly struggling with pressure that did not bother you. What did you do?",
        altWording:
          "Describe a time a teammate was rattled by pressure that did not affect you. What did you do?",
        listenFor:
          "The substance is recognition and useful support, not the candidate's own composure. Steadiness that reads to others as indifference is the fit risk to probe.",
      },
      {
        question:
          "Tell me about the last time you asked for help on something you probably could have pushed through alone. What made you ask?",
        altWording:
          "Tell me about the last time you asked a teacher or teammate for help you could probably have done without. What made you ask?",
        listenFor:
          "A real, recent example suggests the candidate's self-assurance leaves room for input. Struggling to produce any example may indicate a lone-operator pattern.",
      },
    ],
  },
  // -------------------------------------------------------- ASSERTIVENESS
  {
    construct: "ASSERTIVENESS",
    focus: "BELOW_RANGE",
    measures:
      "Assertiveness reflects how readily the candidate states positions, makes requests, and presses for outcomes in the face of resistance.",
    questions: [
      {
        question:
          "Tell me about a time you disagreed with a decision that affected your work. What did you actually say, to whom, and when?",
        altWording:
          "Tell me about a time you disagreed with a coach's, teacher's, or group's decision. What did you actually say, to whom, and when?",
        listenFor:
          "The specifics matter: a real conversation, reasonably prompt, with the person who could act. Disagreement expressed only to peers afterward suggests the assessed pattern operates at work.",
      },
      {
        question:
          "Describe a situation where you had to ask for something uncomfortable — a raise, a deadline change, a bigger role. How did you set it up?",
        altWording:
          "Describe a time you had to ask for something awkward — more playing time, a grade review, a leadership spot. How did you set it up?",
        listenFor:
          "Preparation and a direct ask, even a modest one, are the substance. Listen for whether they made the request themselves or arranged circumstances so it became unnecessary.",
      },
      {
        question:
          "Walk me through a time a customer, colleague, or vendor pushed back hard and was wrong. What did you do?",
        altWording:
          "Walk me through a time an opponent, teammate, or classmate pushed back hard and was wrong. What did you do?",
        listenFor:
          "A substantive answer holds the position with evidence and civility rather than conceding for peace. Note whether the outcome was protected or surrendered, and how the relationship fared.",
      },
    ],
  },
  {
    construct: "ASSERTIVENESS",
    focus: "ABOVE_RANGE",
    measures:
      "Assertiveness reflects how readily the candidate states positions, makes requests, and presses for outcomes in the face of resistance.",
    questions: [
      {
        question:
          "Tell me about a time you pushed for your position and later realized you should have been listening instead. How do you catch that earlier now?",
        altWording:
          "Tell me about a time you argued hard for your plan in a group and later realized the other side had it right. How do you catch that earlier now?",
        listenFor:
          "Listen for a working calibration mechanism — a question quota before advocating, watching for repeated objections, a trusted colleague's signal. Insight without a mechanism tends not to hold under pressure.",
      },
      {
        question:
          "Describe a situation where easing off got you a better outcome than pressing would have. How did you decide?",
        altWording:
          "Describe a time backing off — in a negotiation with friends, a team dispute — worked better than pushing. How did you decide?",
        listenFor:
          "A real example with an articulated decision rule suggests genuine range. If every story resolves by the candidate prevailing, pressure may be their only gear.",
      },
      {
        question:
          "Tell me about someone who found you intimidating or overbearing to work with. How did you learn that, and what did you adjust?",
        altWording:
          "Tell me about a teammate or classmate who found you too forceful. How did you learn that, and what did you adjust?",
        listenFor:
          "Willingness to surface such feedback at all is informative. Listen for a concrete adjustment with the specific person, not a general resolution to be softer.",
      },
    ],
  },
  // ------------------------------------------------------ COMPETITIVENESS
  {
    construct: "COMPETITIVENESS",
    focus: "BELOW_RANGE",
    measures:
      "Competitiveness reflects how strongly the candidate is energized by winning, rankings, and measurable comparison against others.",
    questions: [
      {
        question:
          "Tell me about a time your results were compared directly against colleagues' — a leaderboard, a contest, a ranking. How did it affect what you did day to day?",
        altWording:
          "Tell me about a time you were ranked or compared directly — tryouts, class standing, competitions. How did it affect what you did day to day?",
        listenFor:
          "Candidates lower in competitiveness often run on internal standards; the substance is whether output held up regardless of the scoreboard. Listen for what actually drives their effort, and check it against how this role keeps score.",
      },
      {
        question:
          "Describe a situation where someone else was winning business or recognition you wanted. What did you do?",
        altWording:
          "Describe a time someone else got the spot, award, or role you wanted. What did you do?",
        listenFor:
          "A substantive answer converts the comparison into a specific improvement plan rather than either resentment or indifference. Indifference to losing may matter in quota-driven roles; weigh it against the role's design.",
      },
      {
        question:
          "Walk me through a goal you pursued hard when nobody was measuring you. What kept you at it?",
        altWording:
          "Walk me through a personal goal you chased with no ranking attached — a skill, a project. What kept you at it?",
        listenFor:
          "Strong self-generated drive can substitute for rivalry. Listen for sustained effort and a finished result; if drive appears only with external structure, the role must supply that structure.",
      },
    ],
  },
  {
    construct: "COMPETITIVENESS",
    focus: "ABOVE_RANGE",
    measures:
      "Competitiveness reflects how strongly the candidate is energized by winning, rankings, and measurable comparison against others.",
    questions: [
      {
        question:
          "Tell me about a time your drive to win created a problem with a teammate or colleague. What happened?",
        altWording:
          "Tell me about a time your competitiveness caused friction on a team. What happened?",
        listenFor:
          "Ownership of the friction and a specific repair suggest the drive is manageable. Stories where every conflict was the other person's envy are the pattern to note.",
      },
      {
        question:
          "Describe a situation where the best move for the team cost you a personal win. What did you do?",
        altWording:
          "Describe a time helping the team meant giving up your own shot — an assist instead of a goal, sharing credit on a project. What did you do?",
        listenFor:
          "A real example, told without lingering resentment, suggests the candidate can set the scoreboard aside when the work requires it. Listen for how they talk about the teammate who benefited.",
      },
      {
        question:
          "Tell me about losing — a deal, a contest, a promotion — to someone you felt you had outworked. How did you handle the aftermath?",
        altWording:
          "Tell me about losing a competition or selection you felt you deserved. How did you handle the aftermath?",
        listenFor:
          "The aftermath is the substance: gracious conduct, a fair analysis of why, and sustained effort afterward. Bitterness that changed their behavior toward the winner may indicate team risk.",
      },
    ],
  },
  // ----------------------------------------------------- MENTAL TOUGHNESS
  {
    construct: "MENTAL_TOUGHNESS",
    focus: "BELOW_RANGE",
    measures:
      "Mental Toughness reflects how well the candidate absorbs rejection, criticism, and pressure without losing effectiveness.",
    questions: [
      {
        question:
          "Tell me about a time you faced repeated rejection or failure in a short period — lost sales, turned-down proposals. What did your next week look like?",
        altWording:
          "Tell me about a stretch of repeated setbacks — cut from a team, rejected applications, failed attempts. What did your next week look like?",
        listenFor:
          "Recovery time and recovery behavior are the substance: how soon they re-engaged and what they changed. Listen for whether effort volume dropped after the setbacks, and for how long.",
      },
      {
        question:
          "Describe the harshest criticism you have received in front of others. What did you do in the moment, and afterward?",
        altWording:
          "Describe the toughest public criticism you have received — from a coach, a judge, a teacher. What did you do in the moment, and afterward?",
        listenFor:
          "A composed moment plus a considered follow-up suggests workable resilience even if the criticism landed hard. Avoiding the critic afterward is the pattern to probe.",
      },
      {
        question:
          "Walk me through a situation where you kept performing while something was going badly wrong in the background. How did you manage it?",
        altWording:
          "Walk me through a time you had to perform — a match, an exam, a recital — while dealing with a difficult situation in the background. How did you manage it?",
        listenFor:
          "Listen for a practical containment strategy — a set time to deal with the problem, tightened focus on next actions — and honest acknowledgment of the cost. A managed dip is a credible, workable answer.",
      },
    ],
  },
  {
    construct: "MENTAL_TOUGHNESS",
    focus: "ABOVE_RANGE",
    measures:
      "Mental Toughness reflects how well the candidate absorbs rejection, criticism, and pressure without losing effectiveness.",
    questions: [
      {
        question:
          "Tell me about a piece of criticism you initially shrugged off that turned out to be right. When did you realize, and what did it cost?",
        altWording:
          "Tell me about advice or criticism you brushed aside that turned out to be right. When did you realize, and what did it cost?",
        listenFor:
          "High resilience can shade into imperviousness; the substance is whether feedback gets in at all. Listen for a shortened loop since — a habit of testing criticism before setting it aside.",
      },
      {
        question:
          "Describe a time a colleague was hurt or discouraged by something that would not have bothered you. How did you respond?",
        altWording:
          "Describe a time a teammate was upset by something that would have rolled off you. How did you respond?",
        listenFor:
          "The substance is recognizing that others carry pressure differently and adjusting support accordingly. Answers suggesting others should simply toughen up may indicate fit risk in collaborative or coaching-heavy roles.",
      },
      {
        question:
          "Tell me about a setback that should have changed your approach but didn't — you kept going the same way. What happened?",
        altWording:
          "Tell me about a time you kept using the same approach after it failed — same study method, same play. What happened?",
        listenFor:
          "Persistence and stubbornness look identical from the inside; listen for whether the candidate now separates them. A rule for when to stop persisting — an evidence threshold, outside review — is the strong signal.",
      },
    ],
  },
  // ------------------------------------------------ QUESTIONING / PROBING
  {
    construct: "QUESTIONING_PROBING",
    focus: "BELOW_RANGE",
    measures:
      "Questioning and Probing reflects the candidate's drive to ask, dig, and uncover what is really going on beneath a surface answer.",
    questions: [
      {
        question:
          "Tell me about a time you discovered — too late — that a customer, colleague, or stakeholder needed something different from what they first said. What happened?",
        altWording:
          "Tell me about a time you built or planned what someone asked for, then found out they actually needed something else. What happened?",
        listenFor:
          "Listen for what changed in their intake process — standard questions now asked, restating the request back, confirming before starting. Without a changed routine, the miss is likely to repeat.",
      },
      {
        question:
          "Describe a situation where you accepted information at face value and it proved wrong. How do you decide now what to verify?",
        altWording:
          "Describe a time you took someone's word for something — an answer, a plan detail — and it proved wrong. How do you decide now what to check?",
        listenFor:
          "A substantive answer includes an explicit verification habit tied to stakes — checking anything that is expensive to get wrong. Listen for the rule, not just the anecdote.",
      },
      {
        question:
          "Walk me through the last time you asked a question that changed the direction of a conversation or a piece of work.",
        altWording:
          "Walk me through a time one of your questions changed a group's plan or a class discussion.",
        listenFor:
          "Recency and specificity matter here: a real, recent example suggests questioning is available to the candidate even if it is not their default. Difficulty producing one may indicate the assessed pattern operates day to day.",
      },
    ],
  },
  {
    construct: "QUESTIONING_PROBING",
    focus: "ABOVE_RANGE",
    measures:
      "Questioning and Probing reflects the candidate's drive to ask, dig, and uncover what is really going on beneath a surface answer.",
    questions: [
      {
        question:
          "Tell me about a time your questions started to feel like an interrogation to the other person. How did you notice, and what did you change?",
        altWording:
          "Tell me about a time your questions annoyed a teammate or made someone defensive. How did you notice, and what did you change?",
        listenFor:
          "Listen for sensitivity to the other person's signals and a softened technique — explaining why they ask, spacing questions out, trading information rather than only extracting it.",
      },
      {
        question:
          "Describe a decision you delayed because you wanted more answers, where waiting made things worse. What did you learn about when to stop asking?",
        altWording:
          "Describe a group decision you held up wanting more information, where the delay hurt. What did you learn about when to stop asking?",
        listenFor:
          "The substance is a stopping rule — a deadline, a sufficiency test — that the candidate now applies. Curiosity without a stopping rule may indicate decision drag in fast-paced roles.",
      },
      {
        question:
          "Tell me about a time you questioned a decision that was already final. What did you do once it was clear it would not change?",
        altWording:
          "Tell me about a time you kept questioning a call — a casting choice, a team selection — after it was final. What did you do once it was clear it would not change?",
        listenFor:
          "The workable pattern is registering the objection once, then committing. Continuing to reopen the decision afterward may indicate friction with leadership.",
      },
    ],
  },
  // ----------------------------------------------------------- MOTIVATION
  {
    construct: "MOTIVATION",
    focus: "BELOW_RANGE",
    measures:
      "Motivation reflects the strength and direction of the candidate's drive — the goals they set, the initiative they take, and what sustains their effort.",
    questions: [
      {
        question:
          "Tell me about a time you had to sustain effort on something with no one checking on you. How did you keep it moving?",
        altWording:
          "Tell me about a self-driven project — independent study, a personal build, training on your own. How did you keep it moving?",
        listenFor:
          "Listen for external commitments the candidate built for themselves — deadlines shared with others, scheduled sessions, visible progress markers. Structure that substitutes for spontaneous drive is a workable pattern.",
      },
      {
        question:
          "Describe a goal you set for yourself at work in the past year, and where it stands now.",
        altWording:
          "Describe a goal you set for yourself in school or an activity this past year, and where it stands now.",
        listenFor:
          "The substance is whether a real goal existed, had a measure, and shows progress. A goal produced only when asked, with no tracking behind it, suggests the role will need to supply goal structure.",
      },
      {
        question:
          "Walk me through a time your effort visibly dipped — a slow month, a flat stretch. What pulled you out of it?",
        altWording:
          "Walk me through a stretch where your effort dropped — mid-season, mid-semester. What pulled you out of it?",
        listenFor:
          "Everyone dips; the substance is the recovery mechanism and whether the candidate initiated it. Recoveries that only ever came from outside pressure tell you what the role must supply.",
      },
    ],
  },
  {
    construct: "MOTIVATION",
    focus: "ABOVE_RANGE",
    measures:
      "Motivation reflects the strength and direction of the candidate's drive — the goals they set, the initiative they take, and what sustains their effort.",
    questions: [
      {
        question:
          "Tell me about a time your ambitions ran ahead of what your role could offer. What did you do?",
        altWording:
          "Tell me about a time you wanted a bigger role — in a club, team, or job — than was available. What did you do?",
        listenFor:
          "Listen for constructive channeling — expanding the current role, building skills, an open conversation about a path — versus quick disengagement. Weigh honestly whether this role can hold the ambition described.",
      },
      {
        question:
          "Describe a period when the work was steady but unremarkable — no new challenge, no advancement in sight. How did your performance hold up?",
        altWording:
          "Describe a season or semester with no new challenge — same role, same routine. How did your effort hold up?",
        listenFor:
          "A candid answer about performance during plateaus is the substance. High-drive candidates who can name what keeps them engaged give you something concrete to check against the role.",
      },
      {
        question:
          "Tell me about a time you pushed a goal so hard that something else suffered — quality, a relationship, another commitment. What did you change?",
        altWording:
          "Tell me about a time chasing one goal — a grade, a record, a title — crowded out something else that mattered. What did you change?",
        listenFor:
          "Listen for genuine rebalancing with a specific mechanism, not just regret. Drive without brakes may indicate burnout or team-friction risk over a sustained role.",
      },
    ],
  },

  // ============================================== RESPONSE-QUALITY (VALIDITY)
  // ------------------------------------------------------------ DISTORTION
  {
    construct: "DISTORTION",
    focus: "VALIDITY",
    measures:
      "Distortion is a response-quality indicator reflecting how strongly the candidate described themselves in improbably favorable terms; it guides interpretation of the profile and is not a job-fit dimension.",
    questions: [
      {
        question:
          "Tell me about a genuine strength of yours, with a specific recent example — and then a genuine growth area, also with a specific example.",
        altWording:
          "Tell me about something you are genuinely good at, with a recent example from school or activities — and then something you are still working on, also with an example.",
        listenFor:
          "This indicator reflects response style, not candidate intent, and elevated results are common among motivated applicants. Listen simply for balance and specificity: a concrete growth area with a real example suggests the candidate can describe themselves in three dimensions.",
      },
      {
        question:
          "Walk me through a recent piece of work you were not fully satisfied with. What would you do differently?",
        altWording:
          "Walk me through a recent assignment, performance, or project you were not fully satisfied with. What would you do differently?",
        listenFor:
          "Remember this is a response-quality signal, not evidence of anything improper. A substantive answer names a real shortfall and a specific change; listen for whether the candidate can discuss imperfect work comfortably.",
      },
      {
        question:
          "Describe a time you received feedback that surprised you. What was it, and what did you do with it?",
        altWording:
          "Describe feedback from a teacher, coach, or peer that surprised you. What was it, and what did you do with it?",
        listenFor:
          "Treat this as added calibration for the assessment picture rather than a test of character. Willingness to share unflattering feedback and describe an actual response gives useful context alongside the elevated indicator.",
      },
      {
        question:
          "Tell me about a workweek that did not go as planned. What was your part in that, and what was outside your control?",
        altWording:
          "Tell me about a week of school or an event that did not go as planned. What was your part, and what was outside your control?",
        listenFor:
          "The indicator suggests interpreting self-descriptions with added care — nothing more. Listen for a fair split between owned factors and external ones; an answer with any owned factor at all adds confidence to the overall picture.",
      },
    ],
  },
  // --------------------------------------------------------- EQUIVOCATION
  {
    construct: "EQUIVOCATION",
    focus: "VALIDITY",
    measures:
      "Equivocation is a response-quality indicator reflecting a tendency toward neutral or mixed answering across related statements; it guides interpretation of the profile and is not a job-fit dimension.",
    questions: [
      {
        question:
          "Tell me about a work situation where you had a clear preference — a way of working, a type of task — and how it showed in what you did.",
        altWording:
          "Tell me about a school or team situation where you had a clear preference and how it showed in what you did.",
        listenFor:
          "This indicator reflects response style — mid-scale or mixed answering — and is not a mark against the candidate. Listen for whether firm, specific preferences emerge in conversation; if they do, the profile's trait results may simply understate them.",
      },
      {
        question:
          "Describe a decision you made with incomplete information. How did you land on a choice?",
        altWording:
          "Describe a decision you made — choosing a course, a project topic, a team — with incomplete information. How did you land on it?",
        listenFor:
          "Interpret this as gathering a richer sample of the candidate's decision style, not as correcting the assessment. A concrete decision process ending in an actual commitment is the substance.",
      },
      {
        question:
          "Walk me through a topic at work you hold a firm opinion on — and one where you genuinely see both sides. What puts each in its category?",
        altWording:
          "Walk me through something you hold a firm opinion about in your studies or activities — and something where you genuinely see both sides.",
        listenFor:
          "The aim is texture, not a verdict: candidates differ in how readily they commit to statements presented out of context. Clear reasoning about when they commit and when they withhold suggests a considered style rather than disengagement.",
      },
      {
        question:
          "Tell me about a time you changed your mind on something meaningful. What moved you?",
        altWording:
          "Tell me about a time you changed your mind about a plan, position, or group decision. What moved you?",
        listenFor:
          "A specific before-and-after with named reasons gives a fuller read than the scale results alone. Keep in mind the indicator calls for added conversation like this, not for discounting the candidate.",
      },
    ],
  },
];
