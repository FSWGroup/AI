/**
 * FSW WorkFit — Vocabulary aptitude bank.
 *
 * ORIGINAL FSW Group content. Nothing in this file is copied from, adapted
 * from, or paraphrased out of any third-party assessment instrument.
 *
 * Measures English vocabulary, verbal comprehension, word relationships,
 * and communication-related comprehension for working adults. Target words
 * are those a strong professional communicator actually uses — no obscure
 * trivia words, no region-specific idioms.
 *
 * Subtypes:
 *   synonym             — word closest in meaning to the target
 *   antonym             — word most nearly opposite the target
 *   context_meaning     — meaning of a word as used in a business sentence
 *   word_relationship   — complete the analogy / relationship
 *   sentence_completion — word that best completes a professional sentence
 *
 * Difficulty: 1 = common words, 2 = professional vocabulary,
 * 3 = precise distinctions between near-synonyms (still non-obscure).
 *
 * `explanation` is admin-facing review rationale; never shown to candidates.
 */
import type { AptitudeBank } from "../types";

export const vocabularyBank: AptitudeBank = {
  construct: "VOCABULARY",
  items: [
    // ============================== SYNONYM ==============================
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 1,
      prompt: 'Which word is closest in meaning to "concise"?',
      choices: ["lengthy", "brief", "vague", "loud"],
      correctIndex: 1,
      explanation:
        "Concise means expressed in few words; brief matches. Lengthy is the opposite; vague and loud describe unrelated qualities.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 1,
      prompt: 'Which word is closest in meaning to "feasible"?',
      choices: ["expensive", "mandatory", "popular", "achievable"],
      correctIndex: 3,
      explanation:
        "Feasible means capable of being done; achievable matches. Cost, obligation, and popularity are separate ideas.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "mitigate"?',
      choices: ["lessen", "intensify", "delay", "document"],
      correctIndex: 0,
      explanation:
        "To mitigate is to make less severe; lessen matches. Intensify is the opposite; delay and document are different actions.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "redundant"?',
      choices: ["essential", "accurate", "unnecessary", "complicated"],
      correctIndex: 2,
      explanation:
        "Redundant means no longer needed or duplicating something else; unnecessary matches. Essential is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "tentative"?',
      choices: ["final", "provisional", "careless", "aggressive"],
      correctIndex: 1,
      explanation:
        "Tentative means not yet fixed or confirmed; provisional matches. Final is the opposite; the others are unrelated.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word or phrase is closest in meaning to "expedite"?',
      choices: ["postpone", "cancel", "complicate", "speed up"],
      correctIndex: 3,
      explanation:
        "To expedite is to make something happen faster; speed up matches. Postpone is roughly the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "discrepancy"?',
      choices: ["inconsistency", "agreement", "summary", "estimate"],
      correctIndex: 0,
      explanation:
        "A discrepancy is a difference between things that should match; inconsistency matches. Agreement is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 1,
      prompt: 'Which word or phrase is closest in meaning to "consensus"?',
      choices: ["dispute", "census", "general agreement", "instruction"],
      correctIndex: 2,
      explanation:
        "Consensus means broad agreement within a group. Census is a look-alike word for a population count; dispute is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 1,
      prompt: 'Which word is closest in meaning to "adjacent"?',
      choices: ["distant", "neighboring", "identical", "temporary"],
      correctIndex: 1,
      explanation:
        "Adjacent means next to or adjoining; neighboring matches. Distant is the opposite; identical and temporary are unrelated.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "candid"?',
      choices: ["secretive", "hesitant", "formal", "frank"],
      correctIndex: 3,
      explanation:
        "Candid means honest and direct; frank matches. Secretive is close to the opposite; hesitant and formal describe manner, not honesty.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 1,
      prompt: 'Which word is closest in meaning to "diligent"?',
      choices: ["hardworking", "careless", "talkative", "occasional"],
      correctIndex: 0,
      explanation:
        "Diligent means showing steady, careful effort; hardworking matches. Careless is close to the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "augment"?',
      choices: ["replace", "reduce", "increase", "predict"],
      correctIndex: 2,
      explanation:
        "To augment is to add to or enlarge; increase matches. Reduce is the opposite; replace and predict are different actions.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "ambiguous"?',
      choices: ["obvious", "unclear", "ambitious", "forbidden"],
      correctIndex: 1,
      explanation:
        "Ambiguous means open to more than one interpretation; unclear matches. Ambitious is a sound-alike trap; obvious is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "pragmatic"?',
      choices: ["idealistic", "dramatic", "pessimistic", "practical"],
      correctIndex: 3,
      explanation:
        "Pragmatic means guided by what works in practice; practical matches. Idealistic is close to the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word or phrase is closest in meaning to "meticulous"?',
      choices: ["very careful", "hasty", "forgetful", "relaxed"],
      correctIndex: 0,
      explanation:
        "Meticulous means showing great attention to detail; very careful matches. Hasty and relaxed suggest the opposite attitude.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "lucrative"?',
      choices: ["costly", "effortless", "profitable", "optional"],
      correctIndex: 2,
      explanation:
        "Lucrative means producing substantial profit; profitable matches. Costly describes expense, not return.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "verify"?',
      choices: ["guess", "confirm", "deny", "record"],
      correctIndex: 1,
      explanation:
        "To verify is to check that something is true; confirm matches. Recording stores information without checking it; guessing is the reverse of checking.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 3,
      prompt: 'Which word is closest in meaning to "concur"?',
      choices: ["refuse", "conclude", "compete", "agree"],
      correctIndex: 3,
      explanation:
        "To concur is to agree. Conclude is a sound-alike trap meaning to finish or decide; refuse and compete are unrelated.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 3,
      prompt: 'Which word is closest in meaning to "alleviate"?',
      choices: ["ease", "aggravate", "eliminate", "diagnose"],
      correctIndex: 0,
      explanation:
        "To alleviate is to make a problem less severe — to ease it. Eliminate goes too far (complete removal); aggravate is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 3,
      prompt: 'Which word is closest in meaning to "astute"?',
      choices: ["stubborn", "wealthy", "shrewd", "honest"],
      correctIndex: 2,
      explanation:
        "Astute means quick to see and judge situations accurately; shrewd matches. Honesty and wealth are different qualities.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 2,
      prompt: 'Which word is closest in meaning to "frugal"?',
      choices: ["wasteful", "thrifty", "wealthy", "careless"],
      correctIndex: 1,
      explanation:
        "Frugal means careful and sparing with money; thrifty matches. Wasteful is the opposite; frugality says nothing about wealth.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 3,
      prompt: 'Which word or phrase is closest in meaning to "coherent"?',
      choices: ["confusing", "lengthy", "persuasive", "logically consistent"],
      correctIndex: 3,
      explanation:
        "Coherent means the parts fit together logically. A coherent argument is not necessarily persuasive; confusing is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "synonym",
      difficulty: 3,
      prompt: 'Which word is closest in meaning to "imply"?',
      choices: ["suggest", "infer", "demand", "prove"],
      correctIndex: 0,
      explanation:
        "To imply is to suggest without stating directly. Infer is the classic confusion: the speaker implies, the listener infers.",
    },

    // ============================== ANTONYM ==============================
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 1,
      prompt: 'Which word is most nearly opposite in meaning to "expand"?',
      choices: ["enlarge", "extend", "shrink", "improve"],
      correctIndex: 2,
      explanation:
        "Expand means to grow larger; shrink is the opposite. Enlarge and extend are near-synonyms of expand.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 3,
      prompt: 'Which word is most nearly opposite in meaning to "transparent"?',
      choices: ["clear", "opaque", "visible", "fragile"],
      correctIndex: 1,
      explanation:
        "Transparent means able to be seen through (literally or figuratively); opaque is the opposite. Clear and visible are near-synonyms.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 1,
      prompt: 'Which word is most nearly opposite in meaning to "mandatory"?',
      choices: ["required", "important", "official", "optional"],
      correctIndex: 3,
      explanation:
        "Mandatory means required; optional is the opposite. Required is a synonym; important and official are unrelated.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "surplus"?',
      choices: ["shortage", "excess", "abundance", "inventory"],
      correctIndex: 0,
      explanation:
        "A surplus is more than is needed; a shortage is less than is needed. Excess and abundance are near-synonyms of surplus.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 3,
      prompt: 'Which word is most nearly opposite in meaning to "verbose"?',
      choices: ["wordy", "repetitive", "succinct", "lengthy"],
      correctIndex: 2,
      explanation:
        "Verbose means using more words than necessary; succinct (brief and to the point) is the opposite. The other three describe wordiness.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 1,
      prompt: 'Which word is most nearly opposite in meaning to "flexible"?',
      choices: ["adaptable", "rigid", "elastic", "versatile"],
      correctIndex: 1,
      explanation:
        "Flexible means able to bend or adapt; rigid is the opposite. Adaptable, elastic, and versatile are near-synonyms.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 1,
      prompt: 'Which word is most nearly opposite in meaning to "temporary"?',
      choices: ["brief", "seasonal", "momentary", "permanent"],
      correctIndex: 3,
      explanation:
        "Temporary means lasting a limited time; permanent is the opposite. Brief and momentary are near-synonyms of temporary.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 1,
      prompt: 'Which phrase is most nearly opposite in meaning to "accelerate"?',
      choices: ["slow down", "speed up", "rush ahead", "move forward"],
      correctIndex: 0,
      explanation:
        "Accelerate means to speed up, so slow down is the opposite. Speed up is a synonym; the others describe motion, not rate change.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "abundant"?',
      choices: ["plentiful", "generous", "scarce", "numerous"],
      correctIndex: 2,
      explanation:
        "Abundant means existing in large quantity; scarce is the opposite. Plentiful and numerous are near-synonyms.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "novice"?',
      choices: ["beginner", "expert", "trainee", "apprentice"],
      correctIndex: 1,
      explanation:
        "A novice is someone new to a field; an expert is the opposite. Beginner, trainee, and apprentice are near-synonyms of novice.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 1,
      prompt: 'Which word is most nearly opposite in meaning to "profit"?',
      choices: ["gain", "revenue", "income", "loss"],
      correctIndex: 3,
      explanation:
        "Profit is money gained; loss is money forfeited. Gain is a synonym; revenue and income are related but not opposites.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "compliance"?',
      choices: ["defiance", "obedience", "conformity", "agreement"],
      correctIndex: 0,
      explanation:
        "Compliance is acting in accordance with rules or requests; defiance is open refusal to do so. The other three are near-synonyms.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 3,
      prompt: 'Which word or phrase is most nearly opposite in meaning to "obsolete"?',
      choices: ["outdated", "antique", "up-to-date", "discontinued"],
      correctIndex: 2,
      explanation:
        "Obsolete means no longer in use or current; up-to-date is the opposite. Outdated, antique, and discontinued all lean toward obsolete.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "amplify"?',
      choices: ["broadcast", "diminish", "magnify", "strengthen"],
      correctIndex: 1,
      explanation:
        "Amplify means to increase in strength or degree; diminish is the opposite. Magnify and strengthen are near-synonyms.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "hostile"?',
      choices: ["antagonistic", "aggressive", "bitter", "friendly"],
      correctIndex: 3,
      explanation:
        "Hostile means unfriendly or opposed; friendly is the opposite. The other three describe hostility itself.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 3,
      prompt: 'Which word is most nearly opposite in meaning to "lenient"?',
      choices: ["strict", "permissive", "tolerant", "gentle"],
      correctIndex: 0,
      explanation:
        "Lenient means mild in enforcing rules; strict is the opposite. Permissive, tolerant, and gentle are near-synonyms of lenient.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 3,
      prompt: 'Which word is most nearly opposite in meaning to "prudent"?',
      choices: ["cautious", "sensible", "reckless", "thrifty"],
      correctIndex: 2,
      explanation:
        "Prudent means acting with care and foresight; reckless is the opposite. Cautious and sensible are near-synonyms.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 3,
      prompt: 'Which word is most nearly opposite in meaning to "unanimous"?',
      choices: ["united", "divided", "agreed", "complete"],
      correctIndex: 1,
      explanation:
        "A unanimous decision has everyone in agreement; a divided one does not. United and agreed are near-synonyms of unanimous.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "conceal"?',
      choices: ["hide", "disguise", "protect", "reveal"],
      correctIndex: 3,
      explanation:
        "To conceal is to keep from being seen or known; to reveal is the opposite. Hide and disguise are near-synonyms of conceal.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 1,
      prompt: 'Which word is most nearly opposite in meaning to "optimistic"?',
      choices: ["pessimistic", "hopeful", "confident", "cheerful"],
      correctIndex: 0,
      explanation:
        "Optimistic means expecting good outcomes; pessimistic is the opposite. Hopeful, confident, and cheerful are near-synonyms.",
    },
    {
      construct: "VOCABULARY",
      subtype: "antonym",
      difficulty: 2,
      prompt: 'Which word is most nearly opposite in meaning to "vague"?',
      choices: ["unclear", "general", "precise", "brief"],
      correctIndex: 2,
      explanation:
        "Vague means not clearly expressed; precise is the opposite. Unclear and general are near-synonyms of vague; brief concerns length, not clarity.",
    },

    // ========================== CONTEXT MEANING ==========================
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 1,
      prompt:
        'In the sentence "Please forward the invoice to the accounting team," the word "forward" most nearly means:',
      choices: ["approve", "print", "cancel", "send"],
      correctIndex: 3,
      explanation:
        "To forward a document is to send it on to someone. Approving, printing, and canceling are different actions.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "The launch was postponed pending further review," the word "pending" most nearly means:',
      choices: ["while awaiting", "despite", "instead of", "because of"],
      correctIndex: 0,
      explanation:
        "Pending here means until something happens — the launch waits while the review is completed.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "We need to streamline the onboarding process," the word "streamline" most nearly means:',
      choices: [
        "eliminate entirely",
        "outsource",
        "make simpler and more efficient",
        "document in detail",
      ],
      correctIndex: 2,
      explanation:
        "To streamline a process is to remove unnecessary steps so it runs more efficiently — not to abolish, outsource, or merely document it.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "Her role encompasses budgeting, scheduling, and vendor management," the word "encompasses" most nearly means:',
      choices: ["replaces", "includes", "excludes", "complicates"],
      correctIndex: 1,
      explanation:
        "Encompasses means includes or covers. Excludes is the opposite; replaces and complicates are different actions.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "The two teams will liaise weekly to keep the project on track," the word "liaise" most nearly means:',
      choices: ["compete", "merge", "rotate staff", "communicate and coordinate"],
      correctIndex: 3,
      explanation:
        "To liaise is to maintain communication and cooperation between groups — not to compete, combine, or exchange staff.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 1,
      prompt:
        'In the sentence "The deadline is firm, so plan your work accordingly," the word "firm" most nearly means:',
      choices: ["fixed and not open to change", "approximate", "flexible", "unofficial"],
      correctIndex: 0,
      explanation:
        "A firm deadline is fixed and will not move. The other options describe deadlines that could change.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "Sales figures plateaued in the third quarter," the word "plateaued" most nearly means:',
      choices: ["dropped sharply", "doubled", "stopped rising and leveled off", "became unreliable"],
      correctIndex: 2,
      explanation:
        "To plateau is to stop increasing and hold steady, like flat ground after a climb — not to fall, double, or become inaccurate.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 3,
      prompt:
        'In the sentence "The proposal was well received, albeit with some reservations," the word "albeit" most nearly means:',
      choices: ["because", "although", "therefore", "unless"],
      correctIndex: 1,
      explanation:
        "Albeit introduces a concession and means although. The other options signal cause, consequence, or condition.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "The committee deferred the decision until next quarter," the word "deferred" most nearly means:',
      choices: ["announced", "reversed", "delegated", "postponed"],
      correctIndex: 3,
      explanation:
        "To defer a decision is to put it off until later. Delegated (handed to someone else) is the closest trap but still a different action.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 3,
      prompt:
        'In the sentence "The audit uncovered several material errors in the accounts," the word "material" most nearly means:',
      choices: ["significant", "physical", "minor", "typographical"],
      correctIndex: 0,
      explanation:
        "In business and legal use, a material error is one significant enough to affect decisions. Physical is the everyday-sense trap.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 1,
      prompt:
        'In the sentence "Please address the client\'s concerns before Friday," the word "address" most nearly means:',
      choices: ["ignore", "mail", "deal with", "record"],
      correctIndex: 2,
      explanation:
        "To address a concern is to attend to and deal with it. Mail plays on the postal sense of address; recording is merely noting it.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "The vendor was reluctant to commit to a delivery date," the word "reluctant" most nearly means:',
      choices: ["eager", "unwilling", "unable", "quick"],
      correctIndex: 1,
      explanation:
        "Reluctant means hesitant or unwilling. Unable concerns capacity rather than willingness; eager is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "The new policy supersedes all previous guidelines," the word "supersedes" most nearly means:',
      choices: ["summarizes", "supports", "references", "replaces"],
      correctIndex: 3,
      explanation:
        "To supersede is to take the place of something older, making it no longer in effect — not to summarize, support, or cite it.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 3,
      prompt:
        'In the sentence "We anticipate a modest increase in demand," the word "modest" most nearly means:',
      choices: ["small", "humble", "sudden", "record-breaking"],
      correctIndex: 0,
      explanation:
        "Applied to a quantity, modest means small in size. Humble is the person-describing sense and does not fit an increase.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 3,
      prompt:
        'In the sentence "The auditor flagged an anomaly in the payment records," the word "anomaly" most nearly means:',
      choices: ["routine entry", "improvement", "irregularity", "signature"],
      correctIndex: 2,
      explanation:
        "An anomaly is something that deviates from what is normal or expected — an irregularity. A routine entry is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 1,
      prompt:
        'In the sentence "The setup instructions were straightforward," the word "straightforward" most nearly means:',
      choices: ["confusing", "easy to understand", "detailed", "incomplete"],
      correctIndex: 1,
      explanation:
        "Straightforward means simple and easy to follow. Detailed describes thoroughness, not ease; confusing is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 3,
      prompt:
        'In the sentence "The firm will absorb the additional shipping costs," the word "absorb" most nearly means:',
      choices: ["dispute", "calculate", "refund", "take on the cost itself"],
      correctIndex: 3,
      explanation:
        "To absorb a cost is to bear it internally rather than passing it on to customers — a figurative use of absorb.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 3,
      prompt:
        'In the sentence "His comments were construed as criticism of the plan," the word "construed" most nearly means:',
      choices: ["interpreted", "rejected", "intended", "repeated"],
      correctIndex: 0,
      explanation:
        "Construed means interpreted or understood in a particular way. Intended is the trap: construal is about how listeners took it, not what he meant.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "The project is contingent on board approval," the word "contingent" most nearly means:',
      choices: ["unrelated", "accelerated", "dependent", "improved"],
      correctIndex: 2,
      explanation:
        "Contingent on means dependent on — the project goes ahead only if the board approves. Unrelated is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 1,
      prompt:
        'In the sentence "Staff are encouraged to voice their concerns," the word "voice" most nearly means:',
      choices: ["hide", "express", "reconsider", "shout"],
      correctIndex: 1,
      explanation:
        "To voice a concern is to express it. Shout plays on the sound sense of voice; hide is the opposite.",
    },
    {
      construct: "VOCABULARY",
      subtype: "context_meaning",
      difficulty: 2,
      prompt:
        'In the sentence "The consultant gave a candid appraisal of the department\'s weaknesses," the word "appraisal" most nearly means:',
      choices: ["praise", "denial", "forecast", "assessment"],
      correctIndex: 3,
      explanation:
        "An appraisal is an evaluation or assessment. Praise is a sound-alike trap; a forecast predicts rather than evaluates.",
    },

    // ========================= WORD RELATIONSHIP =========================
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "scarce" is to "plentiful" as "brief" is to ___',
      choices: ["lengthy", "short", "quick", "small"],
      correctIndex: 0,
      explanation:
        "Scarce and plentiful are opposites, so the answer must be the opposite of brief: lengthy. Short and quick are synonyms of brief.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "author" is to "book" as "architect" is to ___',
      choices: ["hammer", "city", "building", "paint"],
      correctIndex: 2,
      explanation:
        "An author creates a book; an architect creates (designs) a building. The other options are not the architect's end product.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "drought" is to "rainfall" as "shortage" is to ___',
      choices: ["demand", "supply", "price", "warehouse"],
      correctIndex: 1,
      explanation:
        "A drought is a prolonged lack of rainfall; a shortage is a lack of supply. Demand is the trap — a shortage is not a lack of demand.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "doctor" is to "patient" as "teacher" is to ___',
      choices: ["classroom", "lesson", "school", "student"],
      correctIndex: 3,
      explanation:
        "A doctor serves a patient; a teacher serves a student. Classroom, lesson, and school are settings or materials, not the person served.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "minute" is to "hour" as "centimeter" is to ___',
      choices: ["meter", "kilogram", "inch", "ruler"],
      correctIndex: 0,
      explanation:
        "A minute is a small unit within an hour; a centimeter is a small unit within a meter. Kilogram measures mass; inch belongs to a different system.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "praise" is to "criticize" as "accept" is to ___',
      choices: ["receive", "approve", "reject", "consider"],
      correctIndex: 2,
      explanation:
        "Praise and criticize are opposites, so the answer must be the opposite of accept: reject. Receive and approve are near-synonyms of accept.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "thermometer" is to "temperature" as "scale" is to ___',
      choices: ["height", "weight", "distance", "fever"],
      correctIndex: 1,
      explanation:
        "A thermometer measures temperature; a scale measures weight. Height and distance are measured by other instruments.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "draft" is to "report" as "rehearsal" is to ___',
      choices: ["audience", "script", "stage", "performance"],
      correctIndex: 3,
      explanation:
        "A draft is the preparatory version of a report; a rehearsal is the preparatory version of a performance.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "employee" is to "salary" as "landlord" is to ___',
      choices: ["rent", "tenant", "property", "deed"],
      correctIndex: 0,
      explanation:
        "An employee receives a salary; a landlord receives rent. Tenant, property, and deed are related nouns but not the payment received.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "glove" is to "hand" as "helmet" is to ___',
      choices: ["safety", "bicycle", "head", "shoulder"],
      correctIndex: 2,
      explanation:
        "A glove protects the hand; a helmet protects the head. Safety is the purpose, not the body part protected.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "insomnia" is to "sleep" as "famine" is to ___',
      choices: ["farming", "food", "hunger", "money"],
      correctIndex: 1,
      explanation:
        "Insomnia is a lack of sleep; famine is a lack of food. Hunger is the result of famine, not the thing lacking.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "manager" is to "team" as "conductor" is to ___',
      choices: ["baton", "audience", "theater", "orchestra"],
      correctIndex: 3,
      explanation:
        "A manager directs a team; a conductor directs an orchestra. Baton is a tool; audience and theater are not the group led.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 3,
      prompt: 'Complete the relationship: "mitigate" is to "severity" as "abbreviate" is to ___',
      choices: ["length", "meaning", "clarity", "importance"],
      correctIndex: 0,
      explanation:
        "To mitigate something reduces its severity; to abbreviate something reduces its length — not its meaning, clarity, or importance.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 2,
      prompt: 'Complete the relationship: "contract" is to "parties" as "treaty" is to ___',
      choices: ["lawyers", "soldiers", "nations", "borders"],
      correctIndex: 2,
      explanation:
        "A contract is an agreement between parties; a treaty is an agreement between nations. Lawyers draft contracts but are not the signatories in this relationship.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "pen" is to "write" as "scissors" is to ___',
      choices: ["fold", "cut", "sharpen", "staple"],
      correctIndex: 1,
      explanation:
        "A pen is a tool used to write; scissors are a tool used to cut. Folding, sharpening, and stapling are done with other tools.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 3,
      prompt: 'Complete the relationship: "cautious" is to "risk" as "skeptical" is to ___',
      choices: ["dangers", "savings", "rules", "claims"],
      correctIndex: 3,
      explanation:
        "A cautious person is wary of risk; a skeptical person is doubtful of claims. Dangers pairs with cautious, not with skeptical.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "chapter" is to "book" as "episode" is to ___',
      choices: ["series", "actor", "channel", "review"],
      correctIndex: 0,
      explanation:
        "A chapter is one installment of a book; an episode is one installment of a series. Actor, channel, and review are not the containing whole.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 3,
      prompt: 'Complete the relationship: "verbose" is to "words" as "ornate" is to ___',
      choices: ["silence", "buildings", "decoration", "simplicity"],
      correctIndex: 2,
      explanation:
        "Verbose means marked by an excess of words; ornate means marked by an excess of decoration. Simplicity is the opposite quality.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 3,
      prompt: 'Complete the relationship: "invoice" is to "payment" as "invitation" is to ___',
      choices: ["celebration", "attendance", "envelope", "gift"],
      correctIndex: 1,
      explanation:
        "An invoice is a document requesting payment; an invitation is a document requesting attendance. Celebration is the occasion, not what is requested.",
    },
    {
      construct: "VOCABULARY",
      subtype: "word_relationship",
      difficulty: 1,
      prompt: 'Complete the relationship: "smoke" is to "fire" as "symptom" is to ___',
      choices: ["medicine", "doctor", "recovery", "illness"],
      correctIndex: 3,
      explanation:
        "Smoke is a visible sign of fire; a symptom is a visible sign of illness. Medicine, doctor, and recovery are responses, not the underlying cause.",
    },

    // ========================= SENTENCE COMPLETION =========================
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: The instructions must be ___ so that new employees can follow them without help.",
      choices: ["lengthy", "clear", "urgent", "expensive"],
      correctIndex: 1,
      explanation:
        "Only clear explains why employees could follow the instructions unaided. Length, urgency, and cost do not aid understanding.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: The two reports gave ___ results, so the analyst asked which source was correct.",
      choices: ["conflicting", "identical", "satisfying", "confidential"],
      correctIndex: 0,
      explanation:
        "Asking which source is correct makes sense only if the results disagree — conflicting. Identical results would raise no such question.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: The committee could not reach a decision, so the vote was ___ until next month.",
      choices: ["unanimous", "counted", "approved", "postponed"],
      correctIndex: 3,
      explanation:
        "A vote pushed to next month is postponed. Unanimous and approved contradict the failure to decide; counted does not fit \"until next month.\"",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: Please ___ your travel receipts to the finance team by Friday.",
      choices: ["spend", "deny", "submit", "earn"],
      correctIndex: 2,
      explanation:
        "Receipts are submitted (handed in) to finance. Spend, deny, and earn do not describe giving documents to a team.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: The schedule is still ___; final dates will be confirmed after the client meeting.",
      choices: ["complete", "preliminary", "overdue", "mandatory"],
      correctIndex: 1,
      explanation:
        "If final dates are yet to come, the schedule is preliminary. Complete contradicts the sentence; overdue and mandatory do not fit.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: Hiring a second technician would ___ the workload on the current staff.",
      choices: ["ease", "increase", "monitor", "justify"],
      correctIndex: 0,
      explanation:
        "Adding a technician lightens — eases — the load on existing staff. Increase reverses the logic; monitor and justify are different actions.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: Her explanation was so ___ that even customers with no technical background understood it.",
      choices: ["technical", "lengthy", "abrupt", "simple"],
      correctIndex: 3,
      explanation:
        "Simple explains why non-technical customers understood. Technical would have the opposite effect; length and abruptness do not aid understanding.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 3,
      prompt:
        "Choose the word that best completes the sentence: The lawyer asked for more ___ wording, since the current clause could be read in two different ways.",
      choices: ["persuasive", "formal", "precise", "concise"],
      correctIndex: 2,
      explanation:
        "A clause readable two ways needs precision, which removes ambiguity. Concise is the trap: shorter wording is not necessarily less ambiguous.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: Managers should ___ team feedback promptly rather than letting concerns build up.",
      choices: ["ignore", "acknowledge", "resent", "forget"],
      correctIndex: 1,
      explanation:
        "Acknowledging feedback promptly prevents concerns from building up. Ignore and forget would let them build up; resent is counterproductive.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: We chose the vendor whose bid was most ___ with our budget.",
      choices: ["compatible", "generous", "familiar", "patient"],
      correctIndex: 0,
      explanation:
        "A bid can be compatible with (fit within) a budget. Generous, familiar, and patient do not pair sensibly with \"with our budget.\"",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: The report should ___ the key findings without repeating every detail.",
      choices: ["duplicate", "obscure", "extend", "summarize"],
      correctIndex: 3,
      explanation:
        "Presenting key findings without every detail is summarizing. Duplicate contradicts \"without repeating\"; obscure and extend do not fit.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: Regular maintenance can ___ the life of the equipment.",
      choices: ["shorten", "measure", "prolong", "insure"],
      correctIndex: 2,
      explanation:
        "Maintenance prolongs (extends) equipment life. Shorten is the opposite effect; measure and insure are unrelated to lifespan change.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: Both regional offices must ___ their schedules so the product launches on the same day everywhere.",
      choices: ["abbreviate", "synchronize", "advertise", "memorize"],
      correctIndex: 1,
      explanation:
        "Launching on the same day everywhere requires the schedules to be synchronized — aligned in time.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 3,
      prompt:
        "Choose the word that best completes the sentence: The findings are promising, but the sample was too small to support any ___ conclusions.",
      choices: ["definitive", "preliminary", "numerical", "optional"],
      correctIndex: 0,
      explanation:
        "A small sample can still yield preliminary conclusions; what it cannot support is definitive (final, conclusive) ones.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: The invoice and the purchase order ___ each other, so payment was placed on hold.",
      choices: ["supported", "matched", "followed", "contradicted"],
      correctIndex: 3,
      explanation:
        "Payment is held when the documents disagree — contradict each other. Supported and matched would clear the way for payment.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: New employees receive a handbook that ___ the company's policies.",
      choices: ["violates", "purchases", "outlines", "hides"],
      correctIndex: 2,
      explanation:
        "A handbook outlines (sets out) policies. Violates and hides are contrary to a handbook's purpose; purchases is nonsensical here.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 2,
      prompt:
        "Choose the word that best completes the sentence: To stay within budget, the team decided to ___ nonessential features from the first release.",
      choices: ["highlight", "omit", "install", "expand"],
      correctIndex: 1,
      explanation:
        "Saving money means leaving nonessential features out — omitting them. Highlight, install, and expand would keep or grow them.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 3,
      prompt:
        "Choose the word that best completes the sentence: The manager praised the intern's ___ in spotting the billing error before the invoice went out.",
      choices: ["vigilance", "ambition", "patience", "humility"],
      correctIndex: 0,
      explanation:
        "Catching an error before it leaves the building shows vigilance — watchful attention. Ambition, patience, and humility are different virtues.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: Demand for the product proved ___, rising every summer and falling every winter.",
      choices: ["constant", "unpredictable", "insufficient", "seasonal"],
      correctIndex: 3,
      explanation:
        "A regular summer-winter pattern is seasonal. Constant contradicts the swings; a repeating pattern is predictable, not unpredictable.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 1,
      prompt:
        "Choose the word that best completes the sentence: Rather than guessing, the engineer ran a test to ___ which component was causing the fault.",
      choices: ["assume", "aggravate", "determine", "disguise"],
      correctIndex: 2,
      explanation:
        "Testing establishes — determines — the faulty component. Assume contradicts \"rather than guessing\"; aggravate and disguise do not fit.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 3,
      prompt:
        "Choose the word that best completes the sentence: The consultant's fee was high, but the savings she identified more than ___ the cost.",
      choices: ["increased", "offset", "ignored", "predicted"],
      correctIndex: 1,
      explanation:
        "Savings that outweigh a fee offset (counterbalance) its cost. Increased reverses the logic; ignored and predicted do not act on a cost this way.",
    },
    {
      construct: "VOCABULARY",
      subtype: "sentence_completion",
      difficulty: 3,
      prompt:
        "Choose the word that best completes the sentence: The memo was ___: it conveyed the full decision in three short sentences without losing any meaning.",
      choices: ["succinct", "elaborate", "repetitive", "tentative"],
      correctIndex: 0,
      explanation:
        "Complete meaning in very few words is the definition of succinct. Elaborate and repetitive contradict the brevity; tentative concerns certainty.",
    },
  ],
};
