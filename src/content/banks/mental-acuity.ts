/**
 * FSW Talent Scout — Mental Acuity item bank.
 *
 * 100% ORIGINAL FSW Group content. Nothing in this file is copied from,
 * derived from, or paraphrased from any third-party assessment instrument.
 *
 * Measures learning comprehension, judgment, practical reasoning, deductive
 * and logical reasoning, problem solving, interpretation of information, and
 * recognition of relationships and patterns. Deliberately mixes nine item
 * families so the section is a broad work-relevant reasoning measure, not a
 * narrow IQ-style test.
 *
 * Subtypes (14 items each, 4 easy / 6 medium / 4 hard):
 *   verbal_analogy, number_series, logical_deduction, practical_judgment,
 *   letter_pattern, odd_one_out, info_interpretation, sequence_completion,
 *   quantitative_reasoning
 *
 * `explanation` is admin-facing review rationale only; never shown to
 * candidates.
 */

import type { AptitudeBank } from "../types";

export const mentalAcuityBank: AptitudeBank = {
  construct: "MENTAL_ACUITY",
  items: [
    // ------------------------------------------------------------------
    // VERBAL ANALOGY (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 1,
      prompt: "Glove is to hand as sock is to ___.",
      choices: ["shoe", "leg", "foot", "toe"],
      correctIndex: 2,
      explanation:
        "A glove is a covering worn on a hand; a sock is a covering worn on a foot. 'Shoe' is worn over a sock, not the body part it covers.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 1,
      prompt: "Puppy is to dog as kitten is to ___.",
      choices: ["cat", "rabbit", "cub", "goat"],
      correctIndex: 0,
      explanation:
        "A puppy is a young dog; a kitten is a young cat. 'Cub' is another young animal, not the adult of a kitten.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 1,
      prompt: "Hot is to cold as tall is to ___.",
      choices: ["high", "wide", "long", "short"],
      correctIndex: 3,
      explanation:
        "Hot and cold are opposites; the opposite of tall is short. 'High' is a near-synonym, the classic wrong pull.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 1,
      prompt: "Hammer is to nail as screwdriver is to ___.",
      choices: ["bolt", "screw", "drill", "wrench"],
      correctIndex: 1,
      explanation:
        "A hammer drives a nail; a screwdriver drives a screw. A bolt is turned with a wrench, not a screwdriver.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 2,
      prompt: "Rung is to ladder as step is to ___.",
      choices: ["staircase", "elevator", "hallway", "doorway"],
      correctIndex: 0,
      explanation:
        "A rung is one of the repeated footholds of a ladder; a step is one of the repeated footholds of a staircase.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 2,
      prompt: "Thermometer is to temperature as scale is to ___.",
      choices: ["height", "distance", "weight", "speed"],
      correctIndex: 2,
      explanation:
        "A thermometer is the instrument that measures temperature; a scale is the instrument that measures weight.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 2,
      prompt: "Drought is to rain as famine is to ___.",
      choices: ["hunger", "food", "disease", "poverty"],
      correctIndex: 1,
      explanation:
        "A drought is a severe shortage of rain; a famine is a severe shortage of food. 'Hunger' is the effect of famine, not the thing that is lacking.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 2,
      prompt: "Sculptor is to statue as architect is to ___.",
      choices: ["blueprint", "brick", "drawing", "building"],
      correctIndex: 3,
      explanation:
        "The finished product of a sculptor's work is a statue; the finished product of an architect's work is a building. A blueprint is only an intermediate plan.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 2,
      prompt: "Whisper is to shout as glance is to ___.",
      choices: ["blink", "wink", "peek", "stare"],
      correctIndex: 3,
      explanation:
        "A whisper is a mild form of speaking and a shout is an intense form; a glance is a brief look and a stare is an intense, prolonged look. 'Peek' is another brief look, so it repeats rather than intensifies.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 2,
      prompt: "Seed is to plant as egg is to ___.",
      choices: ["nest", "bird", "shell", "feather"],
      correctIndex: 1,
      explanation:
        "A seed develops into a plant; an egg develops into a bird. Nest, shell, and feather are associated objects, not what the egg becomes.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 3,
      prompt: "Scarce is to abundant as fragile is to ___.",
      choices: ["sturdy", "brittle", "delicate", "rare"],
      correctIndex: 0,
      explanation:
        "Scarce and abundant are opposites; the opposite of fragile is sturdy. 'Brittle' and 'delicate' are near-synonyms of fragile.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 3,
      prompt: "Miser is to spending as recluse is to ___.",
      choices: ["saving", "traveling", "socializing", "arguing"],
      correctIndex: 2,
      explanation:
        "A miser is someone who avoids spending; a recluse is someone who avoids socializing. 'Saving' is what a miser does, reversing the relationship.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 3,
      prompt: "Symptom is to illness as clue is to ___.",
      choices: ["evidence", "mystery", "detective", "answer"],
      correctIndex: 1,
      explanation:
        "A symptom is a sign that points toward an underlying illness; a clue is a sign that points toward the solution of a mystery. 'Evidence' is a near-synonym of clue, not what the clue points to.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "verbal_analogy",
      difficulty: 3,
      prompt: "Prune is to tree as edit is to ___.",
      choices: ["document", "pencil", "author", "library"],
      correctIndex: 0,
      explanation:
        "Pruning improves a tree by trimming and removing parts; editing improves a document the same way. The other options are a tool, a person, and a place.",
    },

    // ------------------------------------------------------------------
    // NUMBER SERIES (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 1,
      prompt: "What number comes next? 3, 6, 9, 12, ...",
      choices: ["15", "14", "16", "18"],
      correctIndex: 0,
      explanation: "The series increases by 3 each time: 12 + 3 = 15.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 1,
      prompt: "What number comes next? 2, 4, 8, 16, ...",
      choices: ["24", "30", "34", "32"],
      correctIndex: 3,
      explanation: "Each number doubles the one before it: 16 x 2 = 32.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 1,
      prompt: "What number comes next? 20, 18, 16, 14, ...",
      choices: ["13", "12", "11", "10"],
      correctIndex: 1,
      explanation: "The series decreases by 2 each time: 14 - 2 = 12.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 1,
      prompt: "What number comes next? 1, 4, 7, 10, ...",
      choices: ["11", "12", "13", "14"],
      correctIndex: 2,
      explanation: "The series increases by 3 each time: 10 + 3 = 13.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 2,
      prompt: "What number comes next? 2, 3, 5, 8, 12, ...",
      choices: ["15", "16", "18", "17"],
      correctIndex: 3,
      explanation:
        "The gaps grow by one each step: +1, +2, +3, +4, so the next gap is +5 and 12 + 5 = 17.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 2,
      prompt: "What number comes next? 40, 20, 10, 5, ...",
      choices: ["2", "2.5", "1", "0.5"],
      correctIndex: 1,
      explanation: "Each number is half the one before it: 5 / 2 = 2.5.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 2,
      prompt: "What number comes next? 1, 4, 9, 16, 25, ...",
      choices: ["30", "32", "36", "49"],
      correctIndex: 2,
      explanation:
        "These are the square numbers 1x1, 2x2, 3x3, 4x4, 5x5; next is 6x6 = 36. '49' skips ahead one square.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 2,
      prompt: "What number comes next? 5, 6, 8, 11, 15, ...",
      choices: ["20", "19", "21", "18"],
      correctIndex: 0,
      explanation:
        "The gaps grow by one each step: +1, +2, +3, +4, so the next gap is +5 and 15 + 5 = 20.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 2,
      prompt: "What number comes next? 81, 27, 9, 3, ...",
      choices: ["0", "2", "1", "0.5"],
      correctIndex: 2,
      explanation: "Each number is one third of the one before it: 3 / 3 = 1.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 2,
      prompt: "What number comes next? 3, 8, 4, 9, 5, 10, ...",
      choices: ["6", "11", "7", "12"],
      correctIndex: 0,
      explanation:
        "Two interleaved series: 3, 4, 5, ... and 8, 9, 10, ... The next term belongs to the first series: 5 + 1 = 6.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 3,
      prompt: "What number comes next? 2, 6, 12, 20, 30, ...",
      choices: ["40", "42", "44", "36"],
      correctIndex: 1,
      explanation:
        "The gaps are 4, 6, 8, 10, growing by 2 each time; the next gap is 12, so 30 + 12 = 42.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 3,
      prompt: "What number comes next? 1, 2, 6, 24, 120, ...",
      choices: ["240", "600", "620", "720"],
      correctIndex: 3,
      explanation:
        "The multiplier grows by one each step: x2, x3, x4, x5, so the next step is x6 and 120 x 6 = 720.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 3,
      prompt: "What number comes next? 100, 96, 88, 76, 60, ...",
      choices: ["40", "44", "36", "48"],
      correctIndex: 0,
      explanation:
        "The amounts subtracted grow by 4 each time: -4, -8, -12, -16, so the next is -20 and 60 - 20 = 40.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "number_series",
      difficulty: 3,
      prompt: "What number comes next? 4, 7, 13, 25, 49, ...",
      choices: ["93", "95", "97", "99"],
      correctIndex: 2,
      explanation:
        "Each term is double the previous term minus 1: 49 x 2 - 1 = 97. (Equivalently, the gaps double: 3, 6, 12, 24, 48.)",
    },

    // ------------------------------------------------------------------
    // LOGICAL DEDUCTION (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 1,
      prompt:
        "All managers at a company attend the Monday planning meeting. Priya is a manager at that company. Based only on these statements, what must be true?",
      choices: [
        "Priya leads the Monday planning meeting",
        "Priya is the most senior manager",
        "Priya sometimes skips the Monday planning meeting",
        "Priya attends the Monday planning meeting",
      ],
      correctIndex: 3,
      explanation:
        "Priya belongs to the group 'all managers,' and everyone in that group attends, so she attends. Nothing supports leading, seniority, or skipping.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 1,
      prompt:
        "No part-time staff at a store work on Sundays. Tomas works at the store on Sundays. Based only on these statements, what must be true?",
      choices: [
        "Tomas prefers weekend work",
        "Tomas is not a part-time staff member",
        "Tomas is a part-time staff member",
        "Tomas works every Sunday",
      ],
      correctIndex: 1,
      explanation:
        "If no part-time staff work Sundays and Tomas does work Sundays, he cannot be part-time. His preferences and full schedule are unknown.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 1,
      prompt:
        "Every package shipped from the depot has a tracking label. This package has no tracking label. Based only on these statements, what must be true?",
      choices: [
        "The label fell off during transport",
        "The package is lost",
        "The package was not shipped from the depot",
        "The package was shipped without approval",
      ],
      correctIndex: 2,
      explanation:
        "All depot packages have labels; a package with no label therefore did not come from the depot. The other options invent facts not given.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 1,
      prompt:
        "All the printers on the second floor are color printers. Printer 7 is on the second floor. Based only on these statements, what must be true?",
      choices: [
        "Printer 7 is a color printer",
        "Printer 7 is the newest printer",
        "All color printers are on the second floor",
        "Printer 7 is used more than the other printers",
      ],
      correctIndex: 0,
      explanation:
        "Printer 7 is in the group covered by the rule, so it is a color printer. Option three reverses the statement, which is invalid.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 2,
      prompt:
        "Some of the auditors speak French. All of the auditors are accountants. Based only on these statements, which conclusion must be true?",
      choices: [
        "All accountants speak French",
        "Some accountants speak French",
        "No accountants speak French",
        "All French speakers are auditors",
      ],
      correctIndex: 1,
      explanation:
        "The French-speaking auditors are all accountants, so at least some accountants speak French. The other options overreach or reverse the premises.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 2,
      prompt:
        "Company rule: if a shipment arrives late, the customer receives a credit. Customer Rowe did not receive a credit. Based only on these statements, what must be true?",
      choices: [
        "Rowe's shipment arrived late",
        "Rowe received a discount instead",
        "Rowe's order was canceled",
        "Rowe's shipment did not arrive late",
      ],
      correctIndex: 3,
      explanation:
        "If the shipment had been late, Rowe would have received a credit. Since no credit was given, the shipment was not late (denying the consequent).",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 2,
      prompt:
        "All items in bin A are red. All red items are marked for recycling. Based only on these statements, what must be true?",
      choices: [
        "All items in bin A are marked for recycling",
        "Only items from bin A are marked for recycling",
        "Some items in bin A are not red",
        "All recycled items come from bin A",
      ],
      correctIndex: 0,
      explanation:
        "Chaining the premises: bin A items are red, and red items are marked for recycling, so every bin A item is marked. The other options reverse or contradict the premises.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 2,
      prompt:
        "No trainees may sign purchase orders. Everyone who works in the mailroom is a trainee. Based only on these statements, what must be true?",
      choices: [
        "Some mailroom staff may sign purchase orders",
        "Trainees work only in the mailroom",
        "No one in the mailroom may sign purchase orders",
        "Purchase orders are always signed by managers",
      ],
      correctIndex: 2,
      explanation:
        "All mailroom staff are trainees, and trainees may not sign, so no mailroom staff may sign. Who does sign is not stated.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 2,
      prompt:
        "Every driver on the night shift has a safety certificate. Lena has a safety certificate. Based only on these statements, what must be true?",
      choices: [
        "It cannot be determined whether Lena works the night shift",
        "Lena is a night-shift driver",
        "Lena is not a night-shift driver",
        "Lena works the day shift",
      ],
      correctIndex: 0,
      explanation:
        "Holding a certificate is required for night-shift drivers, but others may hold one too. Concluding she is a night-shift driver would affirm the consequent, so her shift cannot be determined.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 2,
      prompt:
        "The report was either emailed or hand-delivered. It was not emailed. Based only on these statements, what must be true?",
      choices: [
        "The report was lost",
        "The report was sent late",
        "The report was hand-delivered",
        "The report was never sent",
      ],
      correctIndex: 2,
      explanation:
        "With exactly two possibilities and one eliminated, the other must hold: it was hand-delivered.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 3,
      prompt:
        "All of the senior technicians can service model X. Some of the people who can service model X are contractors. Based only on these statements, which conclusion must be true?",
      choices: [
        "Some senior technicians are contractors",
        "All contractors can service model X",
        "No senior technicians are contractors",
        "At least one person who can service model X is a contractor",
      ],
      correctIndex: 3,
      explanation:
        "'Some who can service model X are contractors' guarantees at least one such person exists. The contractors mentioned need not be senior technicians, so the first option does not follow.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 3,
      prompt:
        "If the alarm sounds, the building is evacuated. If the building is evacuated, the lifts are shut down. The lifts are currently running. Based only on these statements, what must be true?",
      choices: [
        "The building was evacuated",
        "The alarm did not sound",
        "The alarm sounded but was ignored",
        "The lifts are faulty",
      ],
      correctIndex: 1,
      explanation:
        "Running lifts mean the building was not evacuated, and no evacuation means the alarm did not sound — denying the consequent through the chain.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 3,
      prompt:
        "Dana files more reports than Eli. Eli files more reports than Fay. Gus files fewer reports than Fay. Who files the second-fewest reports?",
      choices: ["Eli", "Gus", "Fay", "Dana"],
      correctIndex: 2,
      explanation:
        "The order from most to fewest is Dana, Eli, Fay, Gus. Gus files the fewest, so Fay files the second-fewest.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "logical_deduction",
      difficulty: 3,
      prompt:
        "No orders placed after 3 p.m. ship the same day. Order 88 shipped on the same day it was placed. Some orders placed after 3 p.m. are rush orders. Based only on these statements, what must be true?",
      choices: [
        "Order 88 was a rush order",
        "Order 88 was placed at or before 3 p.m.",
        "Order 88 was placed after 3 p.m.",
        "Order 88 was not a rush order",
      ],
      correctIndex: 1,
      explanation:
        "Same-day shipping is impossible for after-3 p.m. orders, so Order 88 must have been placed by 3 p.m. The rush-order statement is a distractor premise that supports no conclusion about Order 88.",
    },

    // ------------------------------------------------------------------
    // PRACTICAL JUDGMENT (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 1,
      prompt:
        "On your way to a routine meeting, you notice a large water spill on the floor of a busy walkway. What is the best first action?",
      choices: [
        "Step around it and continue to your meeting",
        "Make the area safe or report the spill right away, then continue",
        "Mention the spill when you arrive at the meeting",
        "Assume the cleaning crew will find it soon",
      ],
      correctIndex: 1,
      explanation:
        "A spill in a busy walkway is an immediate slip hazard. Dealing with it (or reporting it) at once prevents injury; the meeting is routine and can wait a moment.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 1,
      prompt:
        "A customer asks you a product question you cannot answer. What is the best response?",
      choices: [
        "Give your best guess so the customer is not kept waiting",
        "Suggest the customer look it up online",
        "Say you will find out, then get the answer or someone who knows",
        "Steer the conversation to a question you can answer",
      ],
      correctIndex: 2,
      explanation:
        "Committing to find the correct answer serves the customer and protects accuracy. Guessing risks giving wrong information; deflecting leaves the customer unhelped.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 1,
      prompt:
        "You realize you made a calculation error in a report you already sent to your supervisor. What is the best action?",
      choices: [
        "Tell your supervisor about the error right away and send a corrected version",
        "Wait to see whether anyone notices the error",
        "Quietly fix it in the next version without mentioning it",
        "Explain that the source data caused the mistake",
      ],
      correctIndex: 0,
      explanation:
        "Prompt, honest correction limits the damage of decisions based on wrong numbers and maintains trust. Waiting or hiding the fix lets the error spread.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 1,
      prompt:
        "You realize you will miss a deadline because a task took much longer than expected. What is the best action?",
      choices: [
        "Keep working and hand the task in late without comment",
        "Submit whatever is finished and say nothing about the rest",
        "Ask a coworker to tell your supervisor for you",
        "Tell those affected as soon as possible and give a new completion estimate",
      ],
      correctIndex: 3,
      explanation:
        "Early notice with a revised estimate lets others adjust their plans. Silent lateness or partial delivery without explanation creates bigger problems downstream.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 2,
      prompt:
        "You have two tasks due this afternoon: preparing a client order that must ship today, and internal filing that can wait until tomorrow with no consequences. You only have time to finish one before the shipping cutoff. What is the best approach?",
      choices: [
        "Do the internal filing first because it is quicker",
        "Work on both tasks a little at a time",
        "Complete the client order first because it has a firm deadline today",
        "Ask a coworker to choose for you",
      ],
      correctIndex: 2,
      explanation:
        "The client order has a hard external deadline with real consequences; the filing explicitly has none until tomorrow. Prioritizing by deadline and impact is the sound choice.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 2,
      prompt:
        "A coworker who once trained you now regularly asks you to finish parts of their daily workload, and your own tasks are starting to slip. What is the best action?",
      choices: [
        "Speak with the coworker directly, explain your workload, and set limits on the extra help",
        "Keep doing the extra work because the coworker once helped you",
        "Complain about the coworker to other teammates",
        "Report the coworker to management without saying anything to them first",
      ],
      correctIndex: 0,
      explanation:
        "A direct, respectful conversation addresses the problem at the lowest level while protecting your own responsibilities. Escalating or venting to others before talking to the person is premature.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 2,
      prompt:
        "You receive an email that angrily criticizes your team's work and contains several factual mistakes. Several managers are copied. What is the best response?",
      choices: [
        "Reply immediately in the same tone, copying the same managers",
        "Forward the email to your team and ask them to respond",
        "Ignore the email since the criticism is inaccurate",
        "Reply calmly with the correct facts and offer to discuss the concerns",
      ],
      correctIndex: 3,
      explanation:
        "A calm, factual reply corrects the record for everyone copied without escalating conflict. Matching the tone damages credibility; ignoring it leaves wrong information standing.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 2,
      prompt:
        "Near the end of your shift you notice a safety guard on a machine has come loose. Repair requires the maintenance team, and the next shift arrives in ten minutes. What is the best action?",
      choices: [
        "Leave a note on your own desk to deal with it tomorrow",
        "Stop use of the machine, report it, and tell the incoming shift before you leave",
        "Attempt the repair yourself even though you are not trained for it",
        "Do nothing, since maintenance inspects all machines weekly",
      ],
      correctIndex: 1,
      explanation:
        "A loose guard is a safety risk for whoever uses the machine next. Taking it out of use, reporting it, and warning the incoming shift closes the risk immediately; the other options leave people exposed.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 2,
      prompt:
        "On Monday you are assigned a task due Friday and given a new software tool for it. The old, slower method also works, but you have never used the new tool. What is the best approach?",
      choices: [
        "Wait until Thursday and then decide which method to use",
        "Start learning the new tool now, while there is still time to fall back on the old method",
        "Use only the old method and ignore the new tool",
        "Ask a coworker to complete the task with the new tool for you",
      ],
      correctIndex: 1,
      explanation:
        "Starting early keeps both options open: if the new tool works, the task is faster; if problems appear, there is still time for the old method. Waiting removes the safety margin.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 2,
      prompt:
        "A customer at your counter is upset about a late order while other customers are waiting in line. What is the best first step?",
      choices: [
        "Tell the customer to calm down before you will help",
        "Explain that the delay is not your fault",
        "Serve the other customers first because they are waiting too",
        "Acknowledge the frustration, apologize, and check the order status so you can fix it",
      ],
      correctIndex: 3,
      explanation:
        "Acknowledging the problem and moving straight to resolution defuses the situation fastest, which also serves the waiting line. Blame-shifting or 'calm down' typically escalates.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 3,
      prompt:
        "Your supervisor asks you to complete a task using a method you believe wastes time, and you know a faster way. The deadline is comfortable. What is the best action?",
      choices: [
        "Briefly suggest the faster method, explain the benefit, and follow whatever your supervisor decides",
        "Use your own method without mentioning it",
        "Follow the instructions and never raise the idea",
        "Take your idea to your supervisor's manager instead",
      ],
      correctIndex: 0,
      explanation:
        "Raising the improvement respectfully adds value; deferring to the final decision respects the supervisor's authority and possible context you lack. Silent noncompliance and skip-level escalation both damage trust.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 3,
      prompt:
        "The day before an external audit, you discover a discrepancy in the inventory count. Your manager is traveling and unreachable for two hours, and the audit preparation meeting is in three hours. What is the best action?",
      choices: [
        "Adjust the records so the numbers match before the audit",
        "Do nothing until your manager returns",
        "Document the discrepancy, start checking possible causes, and brief your manager as soon as they are reachable",
        "Wait and mention it informally after the audit ends",
      ],
      correctIndex: 2,
      explanation:
        "Documenting and investigating uses the available time productively and keeps the record honest, and the manager is briefed before the meeting. Altering records or concealing the issue is a serious integrity failure.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 3,
      prompt:
        "Two teammates give you conflicting instructions for the same customer order, and the order must be processed within the hour. What is the best action?",
      choices: [
        "Follow the more senior teammate's instructions without checking",
        "Choose whichever instruction is easier to carry out",
        "Hold the order until tomorrow so the conflict can be settled",
        "Contact both teammates right away, point out the conflict, and confirm the correct instructions before processing",
      ],
      correctIndex: 3,
      explanation:
        "The conflict can likely be resolved in minutes, well inside the hour, and confirming avoids processing the order wrong. Guessing risks an error; delaying a day fails the customer.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "practical_judgment",
      difficulty: 3,
      prompt:
        "You finish all your assigned work two hours before your shift ends. Your supervisor is in a meeting and cannot be disturbed. What is the best use of the time?",
      choices: [
        "Begin the next useful task or help teammates, then confirm priorities when your supervisor is free",
        "Use the time for personal browsing since your work is done",
        "Leave early because nothing else was assigned",
        "Interrupt the meeting to ask what you should do next",
      ],
      correctIndex: 0,
      explanation:
        "Self-directed useful work keeps the team productive, and checking in afterward keeps the supervisor informed. Idling, leaving, or interrupting a meeting for a non-urgent question are all weaker choices.",
    },

    // ------------------------------------------------------------------
    // LETTER PATTERN (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 1,
      prompt: "What letter comes next? A, C, E, G, ...",
      choices: ["I", "H", "J", "K"],
      correctIndex: 0,
      explanation:
        "The pattern skips one letter each time (every second letter): after G comes I.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 1,
      prompt: "What letter comes next? Z, Y, X, W, ...",
      choices: ["U", "T", "V", "S"],
      correctIndex: 2,
      explanation: "The alphabet is running backward one letter at a time: after W comes V.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 1,
      prompt: "What letter comes next? B, D, F, H, ...",
      choices: ["I", "J", "K", "L"],
      correctIndex: 1,
      explanation: "Every second letter of the alphabet: after H, skip I, giving J.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 1,
      prompt: "What letter pair comes next? AB, CD, EF, GH, ...",
      choices: ["HI", "JK", "KL", "IJ"],
      correctIndex: 3,
      explanation:
        "The pairs move through the alphabet in order, two letters at a time: after GH comes IJ.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 2,
      prompt: "What letter comes next? A, B, D, G, K, ...",
      choices: ["P", "O", "Q", "N"],
      correctIndex: 0,
      explanation:
        "The jumps grow by one letter each time: +1, +2, +3, +4, so the next jump is +5. K (11th letter) + 5 = P (16th letter).",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 2,
      prompt: "What letter comes next? C, F, I, L, ...",
      choices: ["N", "O", "P", "M"],
      correctIndex: 1,
      explanation:
        "Each step moves forward three letters: C, F, I, L, then O (L is the 12th letter; 12 + 3 = 15 = O).",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 2,
      prompt: "What letter comes next? A, Z, B, Y, C, X, ...",
      choices: ["W", "E", "V", "D"],
      correctIndex: 3,
      explanation:
        "Two alternating series: one moves forward from the start (A, B, C, ...) and one backward from the end (Z, Y, X, ...). The next term belongs to the forward series: D.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 2,
      prompt: "What letter comes next? M, N, L, O, K, P, ...",
      choices: ["Q", "I", "J", "R"],
      correctIndex: 2,
      explanation:
        "The pattern swings outward from M: one letter after (N), one before (L), two after (O), two before (K), three after (P), then three before M, which is J.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 2,
      prompt: "What letter pair comes next? AZ, BY, CX, DW, ...",
      choices: ["EU", "FV", "EV", "EW"],
      correctIndex: 2,
      explanation:
        "The first letter moves forward (A, B, C, D, E) while the second moves backward (Z, Y, X, W, V), giving EV.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 2,
      prompt: "What letter comes next? D, H, L, P, ...",
      choices: ["T", "S", "U", "R"],
      correctIndex: 0,
      explanation:
        "Each step moves forward four letters: D (4), H (8), L (12), P (16), then T (20).",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 3,
      prompt: "What letter comes next? A, D, I, P, ...",
      choices: ["X", "Y", "W", "Z"],
      correctIndex: 1,
      explanation:
        "The letters sit at the square-number positions of the alphabet: 1 (A), 4 (D), 9 (I), 16 (P), so the next is position 25, which is Y.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 3,
      prompt: "What letter pair comes next? CE, FH, IK, LN, ...",
      choices: ["OP", "PR", "NQ", "OQ"],
      correctIndex: 3,
      explanation:
        "Within each pair the letters are two apart (C-E, F-H, ...), and each pair starts three letters after the previous one: C, F, I, L, then O. So the next pair is OQ.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 3,
      prompt: "What letter comes next? B, E, D, G, F, I, H, ...",
      choices: ["J", "K", "L", "I"],
      correctIndex: 1,
      explanation:
        "The steps alternate: forward three letters, back one. From H (8th letter), the next step is forward three, giving K (11th letter).",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "letter_pattern",
      difficulty: 3,
      prompt: "What letter comes next? A, C, F, J, O, ...",
      choices: ["U", "T", "V", "S"],
      correctIndex: 0,
      explanation:
        "The jumps grow by one each time: +2, +3, +4, +5, so the next jump is +6. O is the 15th letter; 15 + 6 = 21 = U.",
    },

    // ------------------------------------------------------------------
    // ODD ONE OUT (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 1,
      prompt: "Which one does not belong with the others?",
      choices: ["apple", "banana", "carrot", "cherry"],
      correctIndex: 2,
      explanation: "Apple, banana, and cherry are fruits; a carrot is a root vegetable.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 1,
      prompt: "Which one does not belong with the others?",
      choices: ["hammer", "saw", "screwdriver", "nail"],
      correctIndex: 3,
      explanation:
        "Hammer, saw, and screwdriver are tools; a nail is a fastener that tools are used on.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 1,
      prompt: "Which one does not belong with the others?",
      choices: ["spoon", "chair", "table", "sofa"],
      correctIndex: 0,
      explanation: "Chair, table, and sofa are furniture; a spoon is an eating utensil.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 1,
      prompt: "Which one does not belong with the others?",
      choices: ["triangle", "circle", "square", "pentagon"],
      correctIndex: 1,
      explanation:
        "Triangle, square, and pentagon are shapes made of straight sides and corners; a circle has neither.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 2,
      prompt: "Which one does not belong with the others?",
      choices: ["car", "bus", "truck", "bicycle"],
      correctIndex: 3,
      explanation:
        "Car, bus, and truck are motor vehicles; a bicycle is powered by the rider, not an engine.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 2,
      prompt: "Which one does not belong with the others?",
      choices: ["plastic", "copper", "iron", "aluminum"],
      correctIndex: 0,
      explanation: "Copper, iron, and aluminum are metals; plastic is a synthetic material.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 2,
      prompt: "Which one does not belong with the others?",
      choices: ["whisper", "listen", "shout", "mumble"],
      correctIndex: 1,
      explanation:
        "Whisper, shout, and mumble are ways of speaking (producing sound); listening is receiving sound.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 2,
      prompt: "Which one does not belong with the others?",
      choices: ["minute", "hour", "clock", "second"],
      correctIndex: 2,
      explanation:
        "Minute, hour, and second are units of time; a clock is the instrument that measures time.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 2,
      prompt: "Which one does not belong with the others?",
      choices: ["bat", "eagle", "sparrow", "pigeon"],
      correctIndex: 0,
      explanation:
        "Eagle, sparrow, and pigeon are birds; a bat is a flying mammal.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 2,
      prompt: "Which one does not belong with the others?",
      choices: ["lake", "island", "river", "ocean"],
      correctIndex: 1,
      explanation:
        "Lake, river, and ocean are bodies of water; an island is land surrounded by water.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 3,
      prompt: "Which number does not belong with the others?",
      choices: ["9", "16", "25", "36", "48"],
      correctIndex: 4,
      explanation:
        "9, 16, 25, and 36 are perfect squares (3x3, 4x4, 5x5, 6x6); 48 is not a perfect square.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 3,
      prompt: "Which number does not belong with the others?",
      choices: ["2", "3", "9", "5", "7"],
      correctIndex: 2,
      explanation:
        "2, 3, 5, and 7 are prime numbers; 9 is divisible by 3, so it is not prime.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 3,
      prompt: "Which word does not belong with the others?",
      choices: ["diligent", "thorough", "meticulous", "careless"],
      correctIndex: 3,
      explanation:
        "Diligent, thorough, and meticulous all describe careful, attentive work; careless is the opposite.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "odd_one_out",
      difficulty: 3,
      prompt: "Which word does not belong with the others?",
      choices: ["century", "anniversary", "decade", "millennium"],
      correctIndex: 1,
      explanation:
        "Century, decade, and millennium are fixed spans of years (100, 10, 1000); an anniversary is a recurring date, not a span of time.",
    },

    // ------------------------------------------------------------------
    // INFO INTERPRETATION (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 1,
      prompt:
        "A stockroom log shows units received: 40 on Monday, 55 on Tuesday, and 50 on Wednesday. On which day were the most units received?",
      choices: ["Monday", "Tuesday", "Wednesday", "The three days were equal"],
      correctIndex: 1,
      explanation: "55 (Tuesday) is greater than 50 (Wednesday) and 40 (Monday).",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 1,
      prompt:
        "A notice reads: 'The office is closed on weekends and on public holidays.' Next Tuesday is a public holiday. What does the notice tell you about next Tuesday?",
      choices: [
        "The office will be closed next Tuesday",
        "The office will be open as usual next Tuesday",
        "The office will open for a half day next Tuesday",
        "The notice does not say anything about next Tuesday",
      ],
      correctIndex: 0,
      explanation:
        "The notice covers all public holidays, and next Tuesday is one, so the office is closed that day.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 1,
      prompt:
        "A memo states: 'Refund requests over $100 require a supervisor's signature. Requests of $100 or less can be approved by any cashier.' A customer requests an $85 refund. What does the memo say about this request?",
      choices: [
        "It requires a supervisor's signature",
        "It cannot be processed the same day",
        "Any cashier can approve it",
        "It requires both a cashier and a supervisor",
      ],
      correctIndex: 2,
      explanation:
        "$85 is $100 or less, so under the memo any cashier can approve it; no supervisor signature is needed.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 1,
      prompt:
        "A shipping guide states: 'Standard orders are delivered five business days after they are placed; express orders are delivered two business days after they are placed.' An express order is placed on a Monday in a week with no holidays. When will it be delivered?",
      choices: ["Tuesday", "Thursday", "Friday", "Wednesday"],
      correctIndex: 3,
      explanation:
        "Two business days after Monday: Tuesday is one, Wednesday is two, so delivery is Wednesday.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 2,
      prompt:
        "A survey report states: 'Of the 200 employees surveyed, 120 prefer updates by email and 60 prefer updates in meetings. The rest expressed no preference.' How many employees expressed no preference?",
      choices: ["10", "20", "30", "40"],
      correctIndex: 1,
      explanation: "120 + 60 = 180, and 200 - 180 = 20 employees with no preference.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 2,
      prompt:
        "A sales summary states: 'Branch A sold more than Branch B in every month of the year except June.' Which conclusion is supported?",
      choices: [
        "Branch A sold more than Branch B in total for the year",
        "Branch B is the company's smallest branch",
        "Branch B sold at least as much as Branch A in June",
        "Branch A sold more than Branch B in June",
      ],
      correctIndex: 2,
      explanation:
        "June is the stated exception, so in June Branch A did not sell more — B sold at least as much. Yearly totals depend on amounts, which are not given.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 2,
      prompt:
        "A policy states: 'Employees may work remotely up to two days per week, with their manager's approval.' Which situation is consistent with the policy?",
      choices: [
        "An employee works remotely two days a week with the manager's approval",
        "An employee works remotely three days a week with the manager's approval",
        "An employee works remotely two days a week without telling the manager",
        "Every employee must work remotely at least two days a week",
      ],
      correctIndex: 0,
      explanation:
        "The policy allows at most two remote days and requires approval. Three days exceeds the limit, skipping approval breaks the condition, and the policy permits rather than requires remote work.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 2,
      prompt:
        "A quality report states: 'After the new inspection process was introduced, defects fell from 25 per thousand units to 20 per thousand units.' Which is the safest conclusion?",
      choices: [
        "The new process is proven to be the only cause of the change",
        "Defects have been almost eliminated",
        "The defect rate will continue to fall",
        "The defect rate was lower after the new process was introduced",
      ],
      correctIndex: 3,
      explanation:
        "The report shows only that the rate fell after the change. It does not prove the process caused it, predict future rates, or show near-elimination (20 per thousand remain).",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 2,
      prompt:
        "A staff handbook states: 'The cafeteria serves soup only on days when the forecast temperature is below 10°C.' Soup is being served today. What can you conclude?",
      choices: [
        "Soup is served on every day the forecast is below 10°C",
        "Today's forecast temperature was above 10°C",
        "Nothing can be concluded about today's forecast",
        "Today's forecast temperature was below 10°C",
      ],
      correctIndex: 3,
      explanation:
        "'Only on days below 10°C' means soup being served guarantees such a day. It does not promise soup on every cold day, so the first option overreaches.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 2,
      prompt:
        "A timesheet summary states: 'Each of the four team members worked between 35 and 40 hours this week.' Which statement must be true?",
      choices: [
        "The team worked between 140 and 160 hours in total",
        "The team worked exactly 150 hours in total",
        "The team worked more than 160 hours in total",
        "The team worked fewer than 140 hours in total",
      ],
      correctIndex: 0,
      explanation:
        "Four members at 35-40 hours each gives a total between 4 x 35 = 140 and 4 x 40 = 160 hours.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 3,
      prompt:
        "A warehouse log states: 'Each of yesterday's 60 pallets was scanned either in the morning or in the afternoon, never both. 22 pallets were scanned in the morning. All afternoon scans were done by Team B.' Which statement must be true?",
      choices: [
        "Team B scanned exactly 38 pallets",
        "Exactly 38 pallets were scanned in the afternoon",
        "Team B did not scan any pallets in the morning",
        "Team B scanned 22 pallets in the morning",
      ],
      correctIndex: 1,
      explanation:
        "60 - 22 = 38 pallets were scanned in the afternoon. Team B did all 38 afternoon scans but might also have done morning scans, so 'exactly 38 for Team B' is not guaranteed.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 3,
      prompt:
        "A sales note states: 'Product K outsold Product L in units this quarter, but Product L brought in more revenue.' Which conclusion must be true?",
      choices: [
        "Product L outsold Product K in units",
        "Product K's revenue increased over last quarter",
        "Product L's average price per unit is higher than Product K's",
        "Product L is higher quality than Product K",
      ],
      correctIndex: 2,
      explanation:
        "L earned more money from fewer units, so its revenue per unit (average price) must exceed K's. Quality and quarter-over-quarter change are not addressed.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 3,
      prompt:
        "A report states: 'Total overtime hours rose 10% during March and then fell 10% during April.' Compared with the start of March, overtime at the end of April is:",
      choices: [
        "Slightly lower than at the start of March",
        "Exactly the same as at the start of March",
        "Slightly higher than at the start of March",
        "Impossible to compare without the exact hours",
      ],
      correctIndex: 0,
      explanation:
        "A 10% rise then a 10% fall gives 1.10 x 0.90 = 0.99 of the original — about 1% lower. The percentages alone determine this, so exact hours are not needed.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "info_interpretation",
      difficulty: 3,
      prompt:
        "A support summary states: 'Of the 50 tickets closed this week, 30 were closed within one day. Every ticket about billing was closed within one day.' Which statement must be true?",
      choices: [
        "All tickets closed within one day were about billing",
        "No more than 30 of the closed tickets were about billing",
        "Exactly 30 of the closed tickets were about billing",
        "Billing tickets took longer to close than other tickets",
      ],
      correctIndex: 1,
      explanation:
        "All billing tickets sit inside the group of 30 closed within one day, so billing tickets cannot number more than 30. The first option reverses the statement; the exact count is unknown.",
    },

    // ------------------------------------------------------------------
    // SEQUENCE COMPLETION (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 1,
      prompt: "What comes next in the sequence? Monday, Wednesday, Friday, ...",
      choices: ["Saturday", "Tuesday", "Thursday", "Sunday"],
      correctIndex: 3,
      explanation: "The sequence moves forward two days at a time: Friday + 2 days = Sunday.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 1,
      prompt: "What comes next in the sequence? January, March, May, July, ...",
      choices: ["August", "October", "September", "November"],
      correctIndex: 2,
      explanation: "The sequence skips one month each time: July, skip August, giving September.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 1,
      prompt: "What comes next in the sequence? 2A, 4B, 6C, 8D, ...",
      choices: ["9E", "10E", "10F", "12E"],
      correctIndex: 1,
      explanation:
        "The numbers rise by 2 (2, 4, 6, 8, 10) and the letters advance one step (A, B, C, D, E), giving 10E.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 1,
      prompt: "What comes next in the sequence? spring, summer, autumn, ...",
      choices: ["winter", "spring", "harvest", "summer"],
      correctIndex: 0,
      explanation: "The four seasons in order: after autumn comes winter.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 2,
      prompt: "A schedule lists times: 9:00, 9:45, 10:30, 11:15, ... What time comes next?",
      choices: ["11:45", "12:15", "12:00", "11:30"],
      correctIndex: 2,
      explanation: "Each time is 45 minutes after the previous one: 11:15 + 45 minutes = 12:00.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 2,
      prompt: "What comes next in the sequence? Z1, Y3, X5, W7, ...",
      choices: ["V8", "U9", "W9", "V9"],
      correctIndex: 3,
      explanation:
        "The letters move backward through the alphabet (Z, Y, X, W, V) while the numbers rise by 2 (1, 3, 5, 7, 9), giving V9.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 2,
      prompt:
        "A pattern of shapes repeats in this order: triangle, triangle, square, circle. If the pattern keeps repeating, what is the 11th shape?",
      choices: ["triangle", "square", "circle", "It cannot be determined"],
      correctIndex: 1,
      explanation:
        "The cycle has 4 shapes, so positions 9-12 repeat positions 1-4. Position 11 matches position 3, which is a square.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 2,
      prompt: "What comes next in the sequence? A2, B4, C8, D16, ...",
      choices: ["E32", "E24", "F32", "E20"],
      correctIndex: 0,
      explanation:
        "The letters advance one step (A, B, C, D, E) and the numbers double (2, 4, 8, 16, 32), giving E32.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 2,
      prompt:
        "A schedule lists start times: 10:15, 10:30, 11:00, 11:45, ... If the gaps keep growing the same way, what time comes next?",
      choices: ["12:30", "12:45", "1:00", "12:15"],
      correctIndex: 1,
      explanation:
        "The gaps grow by 15 minutes each time: 15, 30, 45, so the next gap is 60 minutes and 11:45 + 60 minutes = 12:45.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 2,
      prompt: "What comes next in the sequence? 2A, 3B, 5C, 7D, 11E, ...",
      choices: ["12F", "13G", "13F", "15F"],
      correctIndex: 2,
      explanation:
        "The numbers are the prime numbers in order (2, 3, 5, 7, 11, 13) and the letters advance one step (A-F), giving 13F.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 3,
      prompt:
        "What comes next in the sequence? Sunday, Thursday, Monday, Friday, Tuesday, ...",
      choices: ["Saturday", "Wednesday", "Sunday", "Thursday"],
      correctIndex: 0,
      explanation:
        "Each step moves four days forward through the week: Sunday to Thursday, Thursday to Monday, and so on. Tuesday + 4 days = Saturday.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 3,
      prompt: "What comes next in the sequence? B2, D8, F18, H32, ...",
      choices: ["J48", "I50", "J46", "J50"],
      correctIndex: 3,
      explanation:
        "The letters advance two steps (B, D, F, H, J). The numbers are twice the square numbers: 2x1, 2x4, 2x9, 2x16, then 2x25 = 50, giving J50.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 3,
      prompt:
        "A duty roster repeats in this order: Kim, Lee, Noor, Pat, Noor, Lee, and then starts again from Kim. Who is on duty in position 10?",
      choices: ["Pat", "Kim", "Lee", "Noor"],
      correctIndex: 0,
      explanation:
        "The cycle is 6 positions long, so position 10 matches position 4 of the cycle (10 - 6 = 4), which is Pat.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "sequence_completion",
      difficulty: 3,
      prompt: "What number comes next in the sequence? 4, 9, 25, 49, ...",
      choices: ["81", "100", "121", "169"],
      correctIndex: 2,
      explanation:
        "These are the squares of the prime numbers 2, 3, 5, 7; the next prime is 11 and 11 x 11 = 121. '81' is a square (9x9) but 9 is not prime.",
    },

    // ------------------------------------------------------------------
    // QUANTITATIVE REASONING (14)
    // ------------------------------------------------------------------
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 1,
      prompt: "A pack of 6 identical notebooks costs $12. How much does one notebook cost?",
      choices: ["$2.00", "$1.50", "$2.50", "$3.00"],
      correctIndex: 0,
      explanation: "12 / 6 = 2, so each notebook costs $2.00.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 1,
      prompt:
        "A shift starts at 8:00 a.m. and lasts 7 hours and 30 minutes. What time does it end?",
      choices: ["3:00 p.m.", "3:30 p.m.", "4:00 p.m.", "2:30 p.m."],
      correctIndex: 1,
      explanation: "8:00 a.m. + 7 hours = 3:00 p.m.; adding 30 minutes gives 3:30 p.m.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 1,
      prompt:
        "A stockroom held 240 units this morning. During the day, 85 units were shipped out and none arrived. How many units remain?",
      choices: ["145", "165", "160", "155"],
      correctIndex: 3,
      explanation: "240 - 85 = 155 units remaining.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 1,
      prompt: "Photocopies cost 10 cents per page. How much do 25 pages cost?",
      choices: ["$2.25", "$2.75", "$2.50", "$25.00"],
      correctIndex: 2,
      explanation: "25 x $0.10 = $2.50.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 2,
      prompt:
        "Three workers each pack 40 boxes per day. At this rate, how many boxes do they pack together in 5 days?",
      choices: ["550", "600", "500", "450"],
      correctIndex: 1,
      explanation: "3 workers x 40 boxes = 120 boxes per day; 120 x 5 days = 600 boxes.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 2,
      prompt: "An item priced at $80 is discounted by 25%. What is the sale price?",
      choices: ["$60", "$55", "$65", "$20"],
      correctIndex: 0,
      explanation:
        "25% of $80 is $20, so the sale price is $80 - $20 = $60. '$20' is the discount amount, not the price.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 2,
      prompt:
        "A delivery van travels 180 km in 3 hours. At the same average speed, how long will a 300 km trip take?",
      choices: ["4.5 hours", "6 hours", "5 hours", "5.5 hours"],
      correctIndex: 2,
      explanation: "180 / 3 = 60 km per hour; 300 / 60 = 5 hours.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 2,
      prompt:
        "In a department, the ratio of supervisors to staff is 1 to 8. If there are 4 supervisors, how many staff are there?",
      choices: ["24", "28", "36", "32"],
      correctIndex: 3,
      explanation: "Each supervisor corresponds to 8 staff: 4 x 8 = 32 staff.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 2,
      prompt:
        "A meeting room seats 12 people per table. What is the smallest number of tables needed to seat 75 people?",
      choices: ["6", "8", "7", "9"],
      correctIndex: 2,
      explanation:
        "6 tables seat only 72 people, which is not enough; 7 tables seat 84, so 7 is the minimum.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 2,
      prompt:
        "A worker is paid $15 per hour for the first 8 hours of a day and 1.5 times that rate for each additional hour. How much is earned for a 10-hour day?",
      choices: ["$150", "$160", "$170", "$165"],
      correctIndex: 3,
      explanation:
        "8 x $15 = $120 for regular hours; the extra rate is $22.50, so 2 x $22.50 = $45. Total: $120 + $45 = $165.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 3,
      prompt:
        "Machine A fills 60 bottles per minute and machine B fills 40 bottles per minute. Working together, how long will they take to fill 3,000 bottles?",
      choices: ["25 minutes", "30 minutes", "35 minutes", "40 minutes"],
      correctIndex: 1,
      explanation: "Together they fill 60 + 40 = 100 bottles per minute; 3,000 / 100 = 30 minutes.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 3,
      prompt:
        "A price is increased by 20%, and later the new price is reduced by 20%. Compared with the original, the final price is:",
      choices: [
        "4% lower than the original",
        "Exactly the same as the original",
        "4% higher than the original",
        "2% lower than the original",
      ],
      correctIndex: 0,
      explanation:
        "1.20 x 0.80 = 0.96, so the final price is 96% of the original — 4% lower. The 20% reduction applies to the larger, increased price.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 3,
      prompt:
        "Two-fifths of a team of 45 employees hold a safety certification. How many employees do NOT hold the certification?",
      choices: ["18", "25", "27", "30"],
      correctIndex: 2,
      explanation:
        "Two-fifths of 45 is 18 certified, so 45 - 18 = 27 are not certified. '18' answers the wrong question.",
    },
    {
      construct: "MENTAL_ACUITY",
      subtype: "quantitative_reasoning",
      difficulty: 3,
      prompt:
        "A courier must deliver 96 parcels today. In the morning she delivers three-eighths of them. In the afternoon she delivers half of the remaining parcels. How many parcels are left?",
      choices: ["24", "36", "32", "30"],
      correctIndex: 3,
      explanation:
        "Three-eighths of 96 is 36, leaving 60. Half of 60 is 30 delivered in the afternoon, so 30 parcels remain.",
    },
  ],
};
