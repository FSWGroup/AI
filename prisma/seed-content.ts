/**
 * Demonstration content for FSW Academy.
 *
 * IMPORTANT: this is example content that shows how the platform works. It is
 * explicitly labelled as a demonstration and is NOT approved FSW Group policy.
 * Real procedures must be written and approved by their owners.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { Block, SopMeta } from "../src/lib/content/types";

const DEMO_NOTICE =
  "Demonstration content. This example shows how an SOP is structured in FSW Academy. " +
  "It has not been reviewed or approved as official FSW Group procedure.";

export interface SopSpec {
  code: string;
  title: string;
  summary: string;
  category: string;
  department: string;
  businessUnit: "welsford" | "valveman" | "shared";
  ownerEmail: string;
  smeEmail?: string;
  approverEmail: string;
  kind: "SOP" | "POLICY";
  reviewCycleDays: number;
  meta: Partial<SopMeta>;
  blocks: Block[];
}

export const DEMO_SOPS: SopSpec[] = [
  {
    code: "SALES-001",
    title: "Create a Customer Quote",
    summary:
      "How to build, price, and send a customer quote in the ERP, including when to involve Application Engineering.",
    category: "Quoting",
    department: "Sales",
    businessUnit: "welsford",
    ownerEmail: "sales.manager@fswelsford.com",
    smeEmail: "kim.harlow@fswelsford.com",
    approverEmail: "sales.manager@fswelsford.com",
    kind: "SOP",
    reviewCycleDays: 180,
    meta: {
      purpose:
        "Ensure every customer quote is complete, correctly priced, technically sound, and traceable.",
      scope:
        "Applies to all Inside Sales and Outside Sales personnel producing quotes for Welsford customers.",
      definitions: [
        { term: "RFQ", definition: "Request for Quote — a customer's request for pricing." },
        { term: "AE", definition: "Application Engineering — the internal technical selection team." },
        { term: "Lead time", definition: "The time from order placement to expected shipment." },
      ],
      prerequisites: [
        "ERP access with quoting permission",
        "Customer account exists in the ERP",
        "Completed Valve Fundamentals training",
      ],
      requiredTools: ["P21 ERP", "Microsoft Outlook", "Price sheets"],
      safetyConsiderations:
        "No physical safety hazards. Handle customer pricing as confidential business information.",
      troubleshooting: [
        {
          problem: "The customer account does not exist in the ERP.",
          resolution:
            "Do not quote against a placeholder account. Request account setup through Accounting, then continue.",
        },
        {
          problem: "The requested item is non-stock or obsolete.",
          resolution:
            "Send the request to Application Engineering for an equivalent selection before quoting.",
        },
        {
          problem: "The customer needs a lead time shorter than the vendor quotes.",
          resolution:
            "Ask Purchasing to confirm expedite options and cost before committing to a date in writing.",
        },
      ],
      exceptions:
        "Quotes above the discount authority in the pricing matrix require Sales Manager approval before they are sent.",
    },
    blocks: [
      {
        id: "b1",
        type: "callout",
        tone: "note",
        title: "Demonstration content",
        text: DEMO_NOTICE,
      },
      {
        id: "b2",
        type: "paragraph",
        text: "A quote is a commitment in the customer's eyes. It should be accurate the first time, technically correct, and traceable back to the person who produced it.",
      },
      { id: "b3", type: "heading", level: 2, text: "Before you start" },
      {
        id: "b4",
        type: "checklist",
        title: "Confirm you have what you need",
        requireAll: true,
        items: [
          { id: "c1", text: "The customer's written request (email, portal, or phone notes)" },
          { id: "c2", text: "Quantity and required delivery date" },
          { id: "c3", text: "Part number or a clear application description" },
          { id: "c4", text: "The correct customer account in the ERP" },
        ],
      },
      { id: "b5", type: "heading", level: 2, text: "Procedure" },
      {
        id: "b6",
        type: "list",
        ordered: true,
        items: [
          "Open the ERP and start a new quote against the correct customer account.",
          "Enter the ship-to location and confirm it matches what the customer asked for.",
          "Add each line item with quantity. Use the customer's part number in the description when they gave one.",
          "Check stock availability and lead time for every line.",
          "Apply pricing from the current price sheet. Do not hand-enter a price without a documented reason.",
          "If any line needs technical selection, send it to Application Engineering before you continue.",
          "Enter the freight terms and estimated freight cost.",
          "Set the quote validity period. The standard is 30 days unless the vendor quote is shorter.",
          "Review the whole quote once against the customer's original request.",
          "Send the quote to the customer and log the send date in the ERP.",
          "Set a follow-up task for three business days out.",
        ],
      },
      { id: "b7", type: "heading", level: 2, text: "Decision points" },
      {
        id: "b8",
        type: "flowchart",
        title: "When to involve Application Engineering",
        nodes: [
          { id: "n1", label: "Quote request received", kind: "start" },
          { id: "n2", label: "Did the customer give a specific part number?", kind: "decision" },
          { id: "n3", label: "Quote the part directly", kind: "step" },
          { id: "n4", label: "Send to Application Engineering for selection", kind: "step" },
          { id: "n5", label: "Is the part in stock at standard lead time?", kind: "decision" },
          { id: "n6", label: "Confirm expedite options with Purchasing", kind: "step" },
          { id: "n7", label: "Send quote to customer", kind: "end" },
        ],
        edges: [
          { from: "n1", to: "n2" },
          { from: "n2", to: "n3", label: "Yes" },
          { from: "n2", to: "n4", label: "No, or application described" },
          { from: "n4", to: "n3", label: "Selection returned" },
          { from: "n3", to: "n5" },
          { from: "n5", to: "n7", label: "Yes" },
          { from: "n5", to: "n6", label: "No" },
          { from: "n6", to: "n7" },
        ],
      },
      {
        id: "b9",
        type: "warning",
        severity: "warning",
        title: "Never quote a lead time you have not confirmed",
        text: "If a customer plans around a date we invented, we lose the order and the relationship. Confirm with Purchasing before putting a date in writing.",
      },
      { id: "b10", type: "heading", level: 2, text: "Pricing authority" },
      {
        id: "b11",
        type: "table",
        headers: ["Discount from list", "Who can approve", "What to document"],
        rows: [
          ["Up to 10%", "Inside Sales Representative", "Nothing extra"],
          ["10% to 20%", "Sales Manager", "Reason in the quote notes"],
          ["Over 20%", "Sales Manager and Business Unit lead", "Written approval attached to the quote"],
        ],
        caption: "Example discount authority. Confirm current thresholds with your manager.",
      },
      {
        id: "b12",
        type: "callout",
        tone: "tip",
        title: "Follow up beats discounting",
        text: "Most lost quotes are never followed up, not lost on price. The three-day follow-up task is the highest-value step in this procedure.",
      },
    ],
  },
  {
    code: "OPS-014",
    title: "Receive an Inbound Shipment",
    summary:
      "How to verify, record, and put away inbound material so inventory stays accurate and damage claims stay valid.",
    category: "Warehouse",
    department: "Operations",
    businessUnit: "welsford",
    ownerEmail: "sales.manager@fswelsford.com",
    approverEmail: "hr.admin@fswelsford.com",
    kind: "SOP",
    reviewCycleDays: 365,
    meta: {
      purpose:
        "Keep inventory records accurate and preserve our ability to make a freight or vendor claim.",
      scope: "Applies to all warehouse personnel receiving material at any FSW location.",
      prerequisites: ["ERP receiving access", "Completed Warehouse Safety training"],
      requiredTools: ["Barcode scanner", "Pallet jack or forklift", "Box cutter", "Camera or phone"],
      safetyConsiderations:
        "Wear steel-toe footwear and high-visibility vest in the receiving area. Only certified operators use the forklift. Never walk under a raised load.",
      troubleshooting: [
        {
          problem: "The packing slip quantity does not match what arrived.",
          resolution:
            "Note the actual count on the delivery receipt before the driver leaves, photograph the discrepancy, and notify Purchasing the same day.",
        },
        {
          problem: "Visible damage to the carton or pallet.",
          resolution:
            "Photograph before opening, write 'damaged' on the delivery receipt, and do not sign a clean receipt.",
        },
      ],
      exceptions:
        "Direct-ship material that never enters our warehouse is confirmed by the vendor's proof of delivery instead.",
    },
    blocks: [
      {
        id: "b1",
        type: "callout",
        tone: "note",
        title: "Demonstration content",
        text: DEMO_NOTICE,
      },
      {
        id: "b2",
        type: "warning",
        severity: "danger",
        title: "Sign for what actually arrived",
        text: "Once a clean delivery receipt is signed, a freight claim becomes very hard to win. Count and inspect before the driver leaves.",
      },
      { id: "b3", type: "heading", level: 2, text: "Procedure" },
      {
        id: "b4",
        type: "list",
        ordered: true,
        items: [
          "Meet the driver and confirm the shipment is addressed to this location.",
          "Inspect the outside of every pallet and carton for crushing, punctures, or water damage.",
          "Photograph any damage before anything is moved or opened.",
          "Count the pieces against the delivery receipt. Write the actual count on the receipt if it differs.",
          "Note any damage on the delivery receipt, then sign and keep your copy.",
          "Move the material to the receiving staging area.",
          "Open cartons and verify part numbers and quantities against the purchase order.",
          "Receive the purchase order lines in the ERP with the actual quantities.",
          "Print and attach put-away labels.",
          "Put material away in its assigned bin location and scan to confirm.",
          "File the packing slip and delivery receipt with the purchase order.",
        ],
      },
      { id: "b5", type: "heading", level: 2, text: "Common problems" },
      {
        id: "b6",
        type: "accordion",
        sections: [
          {
            id: "a1",
            title: "The purchase order is not in the ERP",
            text: "Do not receive against a guess. Stage the material, tag it clearly, and ask Purchasing to confirm the order before receiving.",
          },
          {
            id: "a2",
            title: "Partial shipment arrived",
            text: "Receive what arrived. The ERP keeps the balance open. Tell Inside Sales if the shipment covers a customer order so they can update the customer.",
          },
          {
            id: "a3",
            title: "No bin location assigned",
            text: "Ask the warehouse lead to assign one rather than putting it in an open space. Unassigned material becomes lost material.",
          },
        ],
      },
      {
        id: "b7",
        type: "callout",
        tone: "info",
        title: "Why the photos matter",
        text: "Freight carriers routinely deny claims without photographic evidence taken before the shipment was opened. Thirty seconds of photos protects thousands of dollars.",
      },
    ],
  },
  {
    code: "POL-001",
    title: "Acceptable Use of Company Technology",
    summary:
      "What is expected when using FSW email, devices, systems, and data — and what to do if something goes wrong.",
    category: "Information Security",
    department: "Information Technology",
    businessUnit: "shared",
    ownerEmail: "admin@fswelsford.com",
    approverEmail: "hr.admin@fswelsford.com",
    kind: "POLICY",
    reviewCycleDays: 365,
    meta: {
      purpose:
        "Protect FSW Group, our customers, and our vendors from avoidable security and data-loss incidents.",
      scope:
        "Applies to every employee and contractor who uses FSW systems, devices, accounts, or data.",
      prerequisites: [],
      requiredTools: [],
      safetyConsiderations: "",
      exceptions:
        "Exceptions require written approval from IT and the relevant business unit leader, recorded with an expiry date.",
    },
    blocks: [
      {
        id: "b1",
        type: "callout",
        tone: "note",
        title: "Demonstration content",
        text:
          "Demonstration policy. This example shows how a policy and its acknowledgement work in FSW Academy. " +
          "It is not an approved FSW Group policy — replace it with your reviewed version before rollout.",
      },
      { id: "b2", type: "heading", level: 2, text: "What we expect" },
      {
        id: "b3",
        type: "list",
        ordered: false,
        items: [
          "Use your own account. Never share a password or sign in as someone else.",
          "Use multi-factor authentication everywhere it is offered.",
          "Keep customer, vendor, and employee data inside approved FSW systems.",
          "Lock your screen when you step away.",
          "Report a suspected phishing email or lost device immediately — the same day.",
        ],
      },
      { id: "b4", type: "heading", level: 2, text: "What is not acceptable" },
      {
        id: "b5",
        type: "list",
        ordered: false,
        items: [
          "Forwarding company data to a personal email account or personal cloud storage.",
          "Installing software on a company device without IT approval.",
          "Using a personal AI tool with customer, pricing, or employee data pasted into it.",
          "Connecting an unknown USB device to a company computer.",
        ],
      },
      {
        id: "b6",
        type: "warning",
        severity: "caution",
        title: "Reporting a mistake is never the thing that gets you in trouble",
        text: "If you clicked a link, entered a password on the wrong page, or lost a device, tell IT immediately. Fast reporting is what limits the damage. Nobody is disciplined for reporting quickly and honestly.",
      },
      { id: "b7", type: "heading", level: 2, text: "How to report a security concern" },
      {
        id: "b8",
        type: "table",
        headers: ["Situation", "What to do", "How fast"],
        rows: [
          ["Suspicious email", "Use the Report Phishing button, then delete it", "Immediately"],
          ["Entered your password on a suspicious site", "Call IT and change your password", "Within minutes"],
          ["Lost laptop or phone", "Call IT so the device can be wiped remotely", "Immediately"],
          ["Data sent to the wrong recipient", "Notify IT and your manager", "Same day"],
        ],
      },
    ],
  },
  {
    code: "KNOW-001",
    title: "How to Find an SOP in FSW Academy",
    summary:
      "Three ways to find the approved answer fast: search, the SOP library, and Ask FSW AI.",
    category: "Getting Started",
    department: "People and Culture",
    businessUnit: "shared",
    ownerEmail: "training.admin@fswelsford.com",
    approverEmail: "hr.admin@fswelsford.com",
    kind: "SOP",
    reviewCycleDays: 365,
    meta: {
      purpose: "Make sure nobody guesses when a written answer already exists.",
      scope: "Everyone using FSW Academy.",
    },
    blocks: [
      {
        id: "b1",
        type: "paragraph",
        text: "You are not expected to memorize how everything works. You are expected to know where the answer lives. There are three ways to get there.",
      },
      { id: "b2", type: "heading", level: 2, text: "1. Press Cmd+K (or Ctrl+K)" },
      {
        id: "b3",
        type: "paragraph",
        text: "The fastest route. Type a few words — a part of the title, an SOP code, or a phrase from the body — and results appear as you type. This searches SOP titles and full text, courses, video transcripts, skills, and people.",
      },
      { id: "b4", type: "heading", level: 2, text: "2. Browse the SOP Library" },
      {
        id: "b5",
        type: "paragraph",
        text: "Use **SOP Library** in the left navigation when you want to see everything for a department or process rather than one specific answer. Filter by department, category, or owner.",
      },
      { id: "b6", type: "heading", level: 2, text: "3. Ask FSW AI" },
      {
        id: "b7",
        type: "paragraph",
        text: "Ask a question in plain language, like *\"who approves a discount over 20%?\"*. You get an answer with a citation you can click to open the source. If no approved FSW source covers it, the assistant says so instead of guessing — and points you to who owns that area.",
      },
      {
        id: "b8",
        type: "callout",
        tone: "tip",
        title: "Found something wrong or out of date?",
        text: "Every SOP has a Report outdated information button. Use it. It goes straight to the SOP owner, and it is the main way our procedures stay accurate.",
      },
    ],
  },
];

export interface CourseSpec {
  key: string;
  title: string;
  description: string;
  category: string;
  department: string;
  difficulty: "INTRO" | "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  estimatedMinutes: number;
  ownerEmail: string;
  passingScore?: number;
  recertifyMonths?: number;
  selfEnrollAllowed?: boolean;
  skills?: { name: string; level: number }[];
  sections: {
    title: string;
    lessons: {
      title: string;
      type: string;
      estimatedMinutes?: number;
      required?: boolean;
      content?: Record<string, unknown>;
      questions?: {
        type: string;
        prompt: string;
        config: Record<string, unknown>;
        points?: number;
        explanation?: string;
      }[];
    }[];
  }[];
}

export const DEMO_COURSES: CourseSpec[] = [
  {
    key: "welcome",
    title: "Welcome to FSW",
    description:
      "Your first stop. Who we are, how we work, and what to expect in your first weeks.",
    category: "Onboarding",
    department: "People and Culture",
    difficulty: "INTRO",
    estimatedMinutes: 20,
    ownerEmail: "hr.admin@fswelsford.com",
    selfEnrollAllowed: true,
    sections: [
      {
        title: "Getting oriented",
        lessons: [
          {
            title: "Welcome from the team",
            type: "RICH_TEXT",
            estimatedMinutes: 4,
            content: {
              blocks: [
                {
                  id: "w1",
                  type: "paragraph",
                  text: "Welcome to FSW Group. We are a family-run industrial distribution business, and the way we work reflects that: direct communication, real ownership of problems, and a strong preference for writing things down so the next person does not have to figure it out again.",
                },
                {
                  id: "w2",
                  type: "heading",
                  level: 2,
                  text: "What this platform is for",
                },
                {
                  id: "w3",
                  type: "paragraph",
                  text: "FSW Academy answers four questions for you: what you are supposed to know, how to do your job, what training you still owe, and where to find the answer when you forget. That last one matters most — nobody memorizes everything.",
                },
                {
                  id: "w4",
                  type: "callout",
                  tone: "tip",
                  title: "The one shortcut worth learning today",
                  text: "Press Cmd+K (Ctrl+K on Windows) anywhere in FSW Academy to search everything you have access to.",
                },
              ],
            },
          },
          {
            title: "How FSW Group is organized",
            type: "RICH_TEXT",
            estimatedMinutes: 5,
            content: {
              blocks: [
                {
                  id: "o1",
                  type: "paragraph",
                  text: "FSW Group operates several businesses that share services and standards but serve customers differently.",
                },
                {
                  id: "o2",
                  type: "table",
                  headers: ["Business", "What it does", "Who it serves"],
                  rows: [
                    [
                      "Welsford",
                      "Industrial valve and flow-control distribution",
                      "Industrial plants, contractors, OEMs",
                    ],
                    [
                      "ValveMan",
                      "Direct-to-customer e-commerce valve sales",
                      "Online buyers, small contractors",
                    ],
                    [
                      "Shared Services",
                      "Accounting, HR, IT, and corporate functions",
                      "Every FSW business",
                    ],
                  ],
                },
                {
                  id: "o3",
                  type: "paragraph",
                  text: "You can see the full reporting structure any time under **People**, including who your manager is and who else is on your team.",
                },
              ],
            },
          },
          {
            title: "Check your understanding",
            type: "QUIZ",
            estimatedMinutes: 3,
            questions: [
              {
                type: "MULTIPLE_CHOICE",
                prompt: "What is the fastest way to find an approved answer in FSW Academy?",
                config: {
                  options: [
                    "Email your manager",
                    "Press Cmd+K or Ctrl+K and search",
                    "Scroll through every SOP in the library",
                    "Wait for the next team meeting",
                  ],
                  correctIndex: 1,
                },
                explanation:
                  "The command palette searches SOP titles and full text, courses, video transcripts, skills, and people — everything you have access to.",
              },
              {
                type: "TRUE_FALSE",
                prompt:
                  "If you find information in an SOP that is out of date, you should report it using the Report outdated information button.",
                config: { correct: true },
                explanation:
                  "Reports go straight to the SOP owner. This is the main way procedures stay accurate.",
              },
              {
                type: "MULTIPLE_SELECT",
                prompt: "Which businesses are part of FSW Group? Select all that apply.",
                config: {
                  options: ["Welsford", "ValveMan", "Shared Services", "A competitor"],
                  correctIndexes: [0, 1, 2],
                },
                points: 2,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "cyber",
    title: "Cybersecurity Fundamentals",
    description:
      "The security habits that prevent almost every incident we actually see: phishing, passwords, data handling, and fast reporting.",
    category: "Compliance",
    department: "Information Technology",
    difficulty: "BEGINNER",
    estimatedMinutes: 30,
    ownerEmail: "admin@fswelsford.com",
    passingScore: 80,
    recertifyMonths: 12,
    skills: [{ name: "Cybersecurity Awareness", level: 3 }],
    sections: [
      {
        title: "Recognizing threats",
        lessons: [
          {
            title: "How attacks actually reach us",
            type: "RICH_TEXT",
            estimatedMinutes: 6,
            content: {
              blocks: [
                {
                  id: "c1",
                  type: "paragraph",
                  text: "Almost every security incident at a distribution business starts the same way: a convincing email. Not a movie-style hacker — an invoice that looks real, a password reset you did not request, or a vendor asking to update their bank details.",
                },
                {
                  id: "c2",
                  type: "heading",
                  level: 2,
                  text: "The four signals worth memorizing",
                },
                {
                  id: "c3",
                  type: "list",
                  ordered: true,
                  items: [
                    "**Urgency.** Real colleagues rarely need something in the next ten minutes or else.",
                    "**A payment or banking change.** Any request to change where money goes is a stop-and-verify moment, every time.",
                    "**An unexpected login prompt.** If you did not click sign in, do not enter a password.",
                    "**A slightly wrong address.** Check the domain character by character, not the display name.",
                  ],
                },
                {
                  id: "c4",
                  type: "warning",
                  severity: "danger",
                  title: "Vendor bank-change requests",
                  text: "A request to change a vendor's bank account must be verified by calling a phone number you already had on file — never a number in the email. This single habit prevents the most expensive fraud in our industry.",
                },
              ],
            },
          },
          {
            title: "Passwords and multi-factor authentication",
            type: "RICH_TEXT",
            estimatedMinutes: 5,
            content: {
              blocks: [
                {
                  id: "p1",
                  type: "paragraph",
                  text: "Long beats complicated. A passphrase of four unrelated words is stronger and easier to remember than a short password with symbol substitutions.",
                },
                {
                  id: "p2",
                  type: "list",
                  ordered: false,
                  items: [
                    "Never reuse your work password anywhere else.",
                    "Turn on multi-factor authentication everywhere it is offered.",
                    "If an MFA prompt appears and you did not trigger it, deny it and tell IT — someone has your password.",
                  ],
                },
              ],
            },
          },
          {
            title: "Spot the phishing email",
            type: "SCENARIO",
            estimatedMinutes: 6,
            content: {
              scenario:
                "You receive an email that appears to be from a long-standing vendor. It says their bank changed and asks you to update payment details for an invoice due tomorrow. The signature and logo look right. The reply address is one character different from their usual domain.",
              choices: [
                {
                  id: "s1",
                  label: "Update the bank details so the invoice is not late",
                  correct: false,
                  feedback:
                    "This is exactly how vendor-impersonation fraud succeeds. Urgency plus a banking change is the highest-risk combination there is.",
                },
                {
                  id: "s2",
                  label: "Reply to the email and ask them to confirm",
                  correct: false,
                  feedback:
                    "A reply goes to the attacker, who will happily confirm. Verification must use a channel you already trusted.",
                },
                {
                  id: "s3",
                  label: "Call the vendor on the number already on file and report the email to IT",
                  correct: true,
                  feedback:
                    "Correct. Verify through a known-good channel and report it so IT can block the sender for everyone else.",
                },
              ],
            },
          },
          {
            title: "Cybersecurity assessment",
            type: "QUIZ",
            estimatedMinutes: 8,
            questions: [
              {
                type: "MULTIPLE_CHOICE",
                prompt:
                  "A vendor emails asking you to change the bank account for their next payment. What do you do first?",
                config: {
                  options: [
                    "Update the details — the email looks legitimate",
                    "Reply and ask them to confirm the change",
                    "Call the vendor using a number you already had on file",
                    "Forward it to Accounting to handle",
                  ],
                  correctIndex: 2,
                },
                points: 2,
                explanation:
                  "Verify through a channel you already trusted. A reply or a number from the email itself reaches the attacker.",
              },
              {
                type: "TRUE_FALSE",
                prompt:
                  "If you accidentally enter your password on a suspicious site, you should wait to see if anything bad happens before telling IT.",
                config: { correct: false },
                points: 2,
                explanation:
                  "Report it within minutes. Fast reporting is what limits damage, and reporting a mistake is never what gets someone in trouble.",
              },
              {
                type: "MULTIPLE_SELECT",
                prompt: "Which of these are warning signs of a phishing email? Select all that apply.",
                config: {
                  options: [
                    "Unusual urgency",
                    "A request to change payment details",
                    "A sender domain that is slightly misspelled",
                    "An unexpected login prompt",
                  ],
                  correctIndexes: [0, 1, 2, 3],
                },
                points: 2,
              },
              {
                type: "SHORT_ANSWER",
                prompt:
                  "In your own words: what should you do if you lose a company laptop or phone?",
                config: {
                  acceptableKeywords: ["call it", "contact it", "report", "immediately", "wipe"],
                  manualGrading: false,
                },
                points: 2,
                explanation:
                  "Contact IT immediately so the device can be wiped remotely before anyone can reach company data.",
              },
            ],
          },
          {
            title: "Acknowledge the Acceptable Use policy",
            type: "ACKNOWLEDGEMENT",
            estimatedMinutes: 2,
            content: {
              statement:
                "I acknowledge that I have read and understand the Acceptable Use of Company Technology policy, and I understand my responsibility to report suspected security incidents immediately.",
              sopCode: "POL-001",
              requireTypedSignature: true,
            },
          },
        ],
      },
    ],
  },
  {
    key: "quote-process",
    title: "The Customer Quote Process",
    description:
      "Turn the quoting SOP into practice: build a complete quote, know when to involve Application Engineering, and follow up.",
    category: "Sales",
    department: "Sales",
    difficulty: "BEGINNER",
    estimatedMinutes: 35,
    ownerEmail: "sales.manager@fswelsford.com",
    passingScore: 80,
    skills: [
      { name: "Quoting", level: 3 },
      { name: "ERP System (P21)", level: 2 },
    ],
    sections: [
      {
        title: "The procedure",
        lessons: [
          {
            title: "Read the quoting SOP",
            type: "SOP_REF",
            estimatedMinutes: 10,
            content: { sopCode: "SALES-001" },
          },
          {
            title: "Quote completeness checklist",
            type: "CHECKLIST",
            estimatedMinutes: 5,
            content: {
              requireAll: true,
              items: [
                { id: "q1", text: "Correct customer account and ship-to location" },
                { id: "q2", text: "Every line has quantity, price, and lead time" },
                { id: "q3", text: "Technical selection confirmed or sent to Application Engineering" },
                { id: "q4", text: "Freight terms and estimated cost entered" },
                { id: "q5", text: "Validity period set" },
                { id: "q6", text: "Follow-up task created for three business days out" },
              ],
            },
          },
          {
            title: "Quote process assessment",
            type: "QUIZ",
            estimatedMinutes: 10,
            questions: [
              {
                type: "MULTIPLE_CHOICE",
                prompt:
                  "A customer describes an application but does not give a part number. What is the correct next step?",
                config: {
                  options: [
                    "Quote the closest part you can find",
                    "Send the line to Application Engineering for selection",
                    "Ask the customer to figure out the part number",
                    "Quote a placeholder and correct it later",
                  ],
                  correctIndex: 1,
                },
                points: 2,
                explanation:
                  "Application Engineering owns technical selection. Guessing produces returns, lost trust, and rework.",
              },
              {
                type: "MULTIPLE_CHOICE",
                prompt:
                  "The customer needs delivery sooner than the vendor's standard lead time. What do you put on the quote?",
                config: {
                  options: [
                    "The date the customer asked for",
                    "The standard lead time, with a note that it might improve",
                    "Nothing — leave lead time blank",
                    "A date confirmed with Purchasing after checking expedite options",
                  ],
                  correctIndex: 3,
                },
                points: 2,
                explanation:
                  "Never commit to a date in writing that Purchasing has not confirmed.",
              },
              {
                type: "ORDERING",
                prompt: "Put the quoting steps in the correct order.",
                config: {
                  items: [
                    "Confirm the customer account and ship-to",
                    "Add line items with quantities",
                    "Check stock and lead time",
                    "Apply pricing from the current price sheet",
                    "Send the quote and log the send date",
                    "Create a three-day follow-up task",
                  ],
                },
                points: 3,
              },
              {
                type: "TRUE_FALSE",
                prompt: "A 25% discount from list can be approved by an Inside Sales Representative alone.",
                config: { correct: false },
                points: 1,
                explanation:
                  "Discounts over 20% need Sales Manager and business unit leader approval, documented in writing.",
              },
            ],
          },
          {
            title: "Manager sign-off: build a real quote",
            type: "MANAGER_SIGNOFF",
            estimatedMinutes: 10,
            content: {
              instruction:
                "Build a complete quote for a real customer request without assistance. Your manager will review the quote against the completeness checklist and record the result.",
              criteria: [
                "Correct account and ship-to",
                "All lines priced from the current price sheet",
                "Lead times confirmed",
                "Follow-up task created",
              ],
            },
          },
        ],
      },
    ],
  },
  {
    key: "warehouse-safety",
    title: "Warehouse Safety and Receiving",
    description:
      "Safe work practices in the distribution center, plus the receiving procedure that keeps inventory accurate.",
    category: "Safety",
    department: "Operations",
    difficulty: "BEGINNER",
    estimatedMinutes: 30,
    ownerEmail: "compliance@fswelsford.com",
    passingScore: 90,
    recertifyMonths: 12,
    skills: [{ name: "Warehouse Receiving", level: 3 }],
    sections: [
      {
        title: "Working safely",
        lessons: [
          {
            title: "Warehouse hazard awareness",
            type: "RICH_TEXT",
            estimatedMinutes: 8,
            content: {
              blocks: [
                {
                  id: "s1",
                  type: "callout",
                  tone: "note",
                  title: "Demonstration content",
                  text: "Example safety training. Verify all safety and regulatory requirements with a qualified safety advisor before relying on this material.",
                },
                {
                  id: "s2",
                  type: "heading",
                  level: 2,
                  text: "The hazards that actually cause injuries here",
                },
                {
                  id: "s3",
                  type: "table",
                  headers: ["Hazard", "What prevents it"],
                  rows: [
                    ["Forklift and pedestrian contact", "Designated walkways, eye contact before crossing, high-visibility vest"],
                    ["Falling material from racking", "Correct stacking, load limits, never climbing racking"],
                    ["Manual handling injuries", "Mechanical aids for heavy or awkward loads, team lifts"],
                    ["Cuts from banding and cartons", "Cut-resistant gloves, blade retracted when not in use"],
                    ["Slips and trips", "Immediate spill cleanup, clear aisles"],
                  ],
                },
                {
                  id: "s4",
                  type: "warning",
                  severity: "danger",
                  title: "Never walk under a raised load",
                  text: "No exceptions, no matter how briefly. This is the single most common cause of fatal warehouse incidents.",
                },
              ],
            },
          },
          {
            title: "Read the receiving SOP",
            type: "SOP_REF",
            estimatedMinutes: 10,
            content: { sopCode: "OPS-014" },
          },
          {
            title: "Safety and receiving assessment",
            type: "QUIZ",
            estimatedMinutes: 8,
            questions: [
              {
                type: "MULTIPLE_CHOICE",
                prompt:
                  "A pallet arrives with a crushed corner and visible water damage. What do you do first?",
                config: {
                  options: [
                    "Open it to see whether the contents are damaged",
                    "Photograph the damage before anything is moved or opened",
                    "Sign the delivery receipt and sort it out later",
                    "Refuse the entire shipment",
                  ],
                  correctIndex: 1,
                },
                points: 3,
                explanation:
                  "Carriers deny claims without photos taken before the shipment was opened.",
              },
              {
                type: "TRUE_FALSE",
                prompt:
                  "It is acceptable to walk quickly under a raised forklift load if the operator sees you.",
                config: { correct: false },
                points: 3,
                explanation: "Never, under any circumstances. There are no safe exceptions.",
              },
              {
                type: "MULTIPLE_CHOICE",
                prompt: "The purchase order for an arriving shipment is not in the ERP. What do you do?",
                config: {
                  options: [
                    "Receive it against the closest matching purchase order",
                    "Stage and tag the material, then ask Purchasing to confirm",
                    "Put it away and receive it when the order appears",
                    "Send the shipment back",
                  ],
                  correctIndex: 1,
                },
                points: 2,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "valve-fundamentals",
    title: "Valve Fundamentals",
    description:
      "The product knowledge every FSW role needs: valve types, what each one is for, and the vocabulary customers use.",
    category: "Product Knowledge",
    department: "Application Engineering",
    difficulty: "BEGINNER",
    estimatedMinutes: 45,
    ownerEmail: "kim.harlow@fswelsford.com",
    passingScore: 75,
    selfEnrollAllowed: true,
    skills: [
      { name: "Valve Fundamentals", level: 3 },
      { name: "Ball Valves", level: 2 },
    ],
    sections: [
      {
        title: "Valve types and applications",
        lessons: [
          {
            title: "What a valve actually does",
            type: "RICH_TEXT",
            estimatedMinutes: 8,
            content: {
              blocks: [
                {
                  id: "v1",
                  type: "paragraph",
                  text: "Every valve does one of three jobs: start and stop flow, regulate flow, or prevent backflow. Almost every product question a customer asks comes back to which of those three they actually need.",
                },
                {
                  id: "v2",
                  type: "table",
                  headers: ["Valve type", "Primary job", "Typical use"],
                  rows: [
                    ["Ball valve", "On/off isolation", "Quarter-turn shutoff, tight sealing"],
                    ["Gate valve", "On/off isolation", "Infrequent operation, full unobstructed flow"],
                    ["Globe valve", "Throttling", "Flow regulation where pressure drop is acceptable"],
                    ["Butterfly valve", "Isolation and throttling", "Large lines where space and weight matter"],
                    ["Check valve", "Prevent backflow", "Protecting pumps and preventing reverse flow"],
                    ["Control valve", "Precise modulation", "Automated process control with a positioner"],
                  ],
                },
                {
                  id: "v3",
                  type: "callout",
                  tone: "tip",
                  title: "The question that solves most calls",
                  text: "Ask \"are you trying to shut it off, or control how much flows?\" That one question eliminates most of the wrong answers immediately.",
                },
              ],
            },
          },
          {
            title: "Sizing, materials, and end connections",
            type: "RICH_TEXT",
            estimatedMinutes: 10,
            content: {
              blocks: [
                {
                  id: "m1",
                  type: "heading",
                  level: 2,
                  text: "The five things you always need to know",
                },
                {
                  id: "m2",
                  type: "list",
                  ordered: true,
                  items: [
                    "**Size** — nominal pipe size of the line.",
                    "**Pressure class** — the rating the application requires.",
                    "**Body material** — carbon steel, stainless, bronze, or plastic depending on the medium.",
                    "**Seat and seal material** — determined by temperature and chemical compatibility.",
                    "**End connection** — threaded, flanged, welded, or grooved.",
                  ],
                },
                {
                  id: "m3",
                  type: "warning",
                  severity: "warning",
                  title: "Material compatibility is not a guess",
                  text: "If the medium is anything other than clean water or air, confirm material compatibility with Application Engineering. A wrong seat material can fail in days.",
                },
              ],
            },
          },
          {
            title: "Valve fundamentals assessment",
            type: "QUIZ",
            estimatedMinutes: 10,
            questions: [
              {
                type: "MATCHING",
                prompt: "Match each valve type to its primary job.",
                config: {
                  pairs: [
                    { left: "Ball valve", right: "Quarter-turn on/off isolation" },
                    { left: "Globe valve", right: "Throttling and flow regulation" },
                    { left: "Check valve", right: "Preventing backflow" },
                    { left: "Control valve", right: "Precise automated modulation" },
                  ],
                },
                points: 4,
              },
              {
                type: "MULTIPLE_CHOICE",
                prompt:
                  "A customer needs to regulate flow precisely in an automated process. Which valve type fits best?",
                config: {
                  options: ["Gate valve", "Control valve", "Check valve", "Ball valve"],
                  correctIndex: 1,
                },
                points: 2,
              },
              {
                type: "MULTIPLE_SELECT",
                prompt:
                  "Which details must you confirm before selecting a valve? Select all that apply.",
                config: {
                  options: [
                    "Nominal size",
                    "Pressure class",
                    "Body material",
                    "End connection",
                    "The customer's favorite brand",
                  ],
                  correctIndexes: [0, 1, 2, 3],
                },
                points: 3,
              },
              {
                type: "FILL_BLANK",
                prompt:
                  "A valve whose only job is to prevent reverse flow is called a ______ valve.",
                config: { acceptableAnswers: ["check", "check valve", "non-return"] },
                points: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "fsw-overview",
    title: "FSW Company Overview",
    description:
      "How FSW Group makes money, who our customers are, and how the businesses fit together.",
    category: "Onboarding",
    department: "People and Culture",
    difficulty: "INTRO",
    estimatedMinutes: 15,
    ownerEmail: "hr.admin@fswelsford.com",
    selfEnrollAllowed: true,
    sections: [
      {
        title: "The business",
        lessons: [
          {
            title: "How industrial distribution works",
            type: "RICH_TEXT",
            estimatedMinutes: 8,
            content: {
              blocks: [
                {
                  id: "f1",
                  type: "paragraph",
                  text: "We buy from manufacturers, hold inventory, and sell to customers who need the right part, correctly specified, when they need it. Our value is not the product itself — the manufacturer makes that. Our value is availability, technical selection, and reliability.",
                },
                {
                  id: "f2",
                  type: "heading",
                  level: 2,
                  text: "Where we win",
                },
                {
                  id: "f3",
                  type: "list",
                  ordered: false,
                  items: [
                    "**Availability.** The part is on the shelf when a plant is down.",
                    "**Technical selection.** We get the specification right so the customer does not eat a failure.",
                    "**Follow-through.** We answer, we quote, we ship, we call back.",
                  ],
                },
                {
                  id: "f4",
                  type: "callout",
                  tone: "info",
                  title: "Why plant downtime shapes everything",
                  text: "When a customer's line is stopped, the cost of waiting dwarfs the price of the valve. Speed and accuracy matter far more than being the cheapest quote.",
                },
              ],
            },
          },
          {
            title: "Overview check",
            type: "QUIZ",
            estimatedMinutes: 4,
            questions: [
              {
                type: "MULTIPLE_CHOICE",
                prompt: "What is the primary value FSW provides to customers?",
                config: {
                  options: [
                    "Manufacturing the products ourselves",
                    "Always having the lowest price",
                    "Availability, correct technical selection, and follow-through",
                    "The largest product catalog in the industry",
                  ],
                  correctIndex: 2,
                },
              },
            ],
          },
        ],
      },
    ],
  },
];

export interface PathSpec {
  title: string;
  description: string;
  ownerEmail: string;
  items: {
    label: string;
    targetType: "COURSE" | "SOP" | "LEARNING_PATH";
    courseKey?: string;
    sopCode?: string;
    dueDaysAfterStart: number;
    required: boolean;
    isMilestone?: boolean;
  }[];
}

export const DEMO_PATH: PathSpec = {
  title: "New Employee Onboarding",
  description:
    "Everything a new FSW team member needs in their first 90 days, sequenced so nothing lands before it is useful.",
  ownerEmail: "hr.admin@fswelsford.com",
  items: [
    { label: "Day 1", targetType: "COURSE", courseKey: "welcome", dueDaysAfterStart: 1, required: true },
    { label: "Day 1", targetType: "COURSE", courseKey: "fsw-overview", dueDaysAfterStart: 2, required: true },
    {
      label: "Day 1",
      targetType: "SOP",
      sopCode: "KNOW-001",
      dueDaysAfterStart: 2,
      required: true,
    },
    {
      label: "Day 2",
      targetType: "SOP",
      sopCode: "POL-001",
      dueDaysAfterStart: 3,
      required: true,
    },
    { label: "Week 1", targetType: "COURSE", courseKey: "cyber", dueDaysAfterStart: 7, required: true },
    {
      label: "Week 2",
      targetType: "COURSE",
      courseKey: "valve-fundamentals",
      dueDaysAfterStart: 14,
      required: true,
    },
    {
      label: "Day 30 — check-in",
      targetType: "COURSE",
      courseKey: "quote-process",
      dueDaysAfterStart: 30,
      required: true,
      isMilestone: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Seeding functions
// ---------------------------------------------------------------------------

function nextVersion(current: string | null): string {
  if (!current) return "1.0";
  const [major = "1", minor = "0"] = current.split(".");
  return `${major}.${Number(minor) + 1}`;
}

export async function seedSops(
  prisma: PrismaClient,
  specs: SopSpec[],
  userIds: Map<string, string>,
  departments: Map<string, string>,
  units: { welsford: string; valveman: string; shared: string },
): Promise<Map<string, string>> {
  console.log("→ SOPs and policies");
  const sopIds = new Map<string, string>();

  const fullMeta = (partial: Partial<SopMeta>): SopMeta => ({
    purpose: partial.purpose ?? "",
    scope: partial.scope ?? "",
    definitions: partial.definitions ?? [],
    prerequisites: partial.prerequisites ?? [],
    requiredTools: partial.requiredTools ?? [],
    safetyConsiderations: partial.safetyConsiderations ?? "",
    troubleshooting: partial.troubleshooting ?? [],
    exceptions: partial.exceptions ?? "",
    relatedSopIds: partial.relatedSopIds ?? [],
    relatedCourseIds: partial.relatedCourseIds ?? [],
    externalLinks: partial.externalLinks ?? [],
  });

  for (const spec of specs) {
    const ownerId = userIds.get(spec.ownerEmail) ?? null;
    const approverId = userIds.get(spec.approverEmail) ?? null;
    const smeId = spec.smeEmail ? (userIds.get(spec.smeEmail) ?? null) : null;
    const meta = fullMeta(spec.meta);

    const existing = await prisma.sop.findUnique({
      where: { sopCode: spec.code },
      select: { id: true, currentVersion: { select: { versionNumber: true } } },
    });

    const reviewedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const nextReviewAt = new Date(
      reviewedAt.getTime() + spec.reviewCycleDays * 24 * 60 * 60 * 1000,
    );

    const sop = existing
      ? await prisma.sop.update({
          where: { id: existing.id },
          data: {
            title: spec.title,
            summary: spec.summary,
            draftBlocks: spec.blocks as unknown as Prisma.InputJsonValue,
            draftMeta: meta as unknown as Prisma.InputJsonValue,
          },
          select: { id: true, currentVersionId: true },
        })
      : await prisma.sop.create({
          data: {
            sopCode: spec.code,
            kind: spec.kind,
            title: spec.title,
            summary: spec.summary,
            category: spec.category,
            departmentId: departments.get(spec.department) ?? null,
            businessUnitId: units[spec.businessUnit],
            ownerId,
            smeId,
            approverId,
            status: "PUBLISHED",
            draftBlocks: spec.blocks as unknown as Prisma.InputJsonValue,
            draftMeta: meta as unknown as Prisma.InputJsonValue,
            reviewCycleDays: spec.reviewCycleDays,
            lastReviewedAt: reviewedAt,
            nextReviewAt,
            createdById: ownerId ?? userIds.get("admin@fswelsford.com") ?? "",
          },
          select: { id: true, currentVersionId: true },
        });

    sopIds.set(spec.code, sop.id);

    // Publish an immutable version if none exists yet.
    if (!sop.currentVersionId) {
      const version = await prisma.sopVersion.create({
        data: {
          sopId: sop.id,
          versionNumber: nextVersion(existing?.currentVersion?.versionNumber ?? null),
          title: spec.title,
          blocks: spec.blocks as unknown as Prisma.InputJsonValue,
          meta: meta as unknown as Prisma.InputJsonValue,
          changeSummary: "Initial published version (demonstration content).",
          authorId: ownerId ?? userIds.get("admin@fswelsford.com") ?? "",
          approverId,
        },
        select: { id: true },
      });

      await prisma.sop.update({
        where: { id: sop.id },
        data: { currentVersionId: version.id, status: "PUBLISHED" },
      });
    }
  }

  return sopIds;
}

export async function seedCourses(
  prisma: PrismaClient,
  specs: CourseSpec[],
  userIds: Map<string, string>,
  skillIds: Map<string, string>,
  sopIds: Map<string, string>,
  departments: Map<string, string>,
): Promise<Map<string, string>> {
  console.log("→ Courses, lessons, and questions");
  const courseIds = new Map<string, string>();

  for (const spec of specs) {
    const ownerId = userIds.get(spec.ownerEmail) ?? userIds.get("admin@fswelsford.com") ?? "";

    const existing = await prisma.course.findFirst({
      where: { title: spec.title },
      select: { id: true, currentVersionId: true },
    });

    const course = existing
      ? await prisma.course.update({
          where: { id: existing.id },
          data: { description: spec.description, estimatedMinutes: spec.estimatedMinutes },
          select: { id: true, currentVersionId: true },
        })
      : await prisma.course.create({
          data: {
            title: spec.title,
            description: spec.description,
            category: spec.category,
            departmentId: departments.get(spec.department) ?? null,
            difficulty: spec.difficulty,
            estimatedMinutes: spec.estimatedMinutes,
            ownerId,
            status: "PUBLISHED",
            passingScore: spec.passingScore ?? null,
            recertifyMonths: spec.recertifyMonths ?? null,
            selfEnrollAllowed: spec.selfEnrollAllowed ?? false,
            createdById: ownerId,
          },
          select: { id: true, currentVersionId: true },
        });

    courseIds.set(spec.key, course.id);

    // Skills granted by this course.
    for (const skill of spec.skills ?? []) {
      const skillId = skillIds.get(skill.name);
      if (!skillId) continue;
      await prisma.courseSkill.upsert({
        where: { courseId_skillId: { courseId: course.id, skillId } },
        create: { courseId: course.id, skillId, levelValue: skill.level },
        update: { levelValue: skill.level },
      });
    }

    // Rebuild structure only on first creation, so re-seeding does not orphan
    // learner progress rows that reference lesson IDs.
    const hasSections = await prisma.courseSection.count({ where: { courseId: course.id } });
    if (hasSections === 0) {
      for (const [sectionIndex, sectionSpec] of spec.sections.entries()) {
        const section = await prisma.courseSection.create({
          data: { courseId: course.id, title: sectionSpec.title, order: sectionIndex },
          select: { id: true },
        });

        for (const [lessonIndex, lessonSpec] of sectionSpec.lessons.entries()) {
          // Resolve SOP references from code to id at seed time.
          let content = lessonSpec.content ?? null;
          if (content && typeof content.sopCode === "string") {
            const sopId = sopIds.get(content.sopCode);
            content = { ...content, sopId: sopId ?? null };
          }

          const lesson = await prisma.lesson.create({
            data: {
              sectionId: section.id,
              title: lessonSpec.title,
              type: lessonSpec.type as never,
              order: lessonIndex,
              required: lessonSpec.required ?? true,
              estimatedMinutes: lessonSpec.estimatedMinutes ?? null,
              content: (content ?? undefined) as Prisma.InputJsonValue | undefined,
            },
            select: { id: true },
          });

          for (const [questionIndex, questionSpec] of (lessonSpec.questions ?? []).entries()) {
            await prisma.question.create({
              data: {
                lessonId: lesson.id,
                type: questionSpec.type as never,
                order: questionIndex,
                prompt: questionSpec.prompt,
                config: questionSpec.config as Prisma.InputJsonValue,
                points: questionSpec.points ?? 1,
                explanation: questionSpec.explanation ?? null,
              },
            });
          }
        }
      }
    }

    // Publish an immutable course version snapshot.
    if (!course.currentVersionId) {
      const snapshot = await buildCourseSnapshot(prisma, course.id);
      const version = await prisma.courseVersion.create({
        data: {
          courseId: course.id,
          versionNumber: "1.0",
          title: spec.title,
          snapshot: snapshot as Prisma.InputJsonValue,
          changeSummary: "Initial published version (demonstration content).",
          authorId: ownerId,
        },
        select: { id: true },
      });
      await prisma.course.update({
        where: { id: course.id },
        data: { currentVersionId: version.id, status: "PUBLISHED" },
      });
    }
  }

  return courseIds;
}

/** Build the full immutable snapshot of a course's structure and content. */
export async function buildCourseSnapshot(
  prisma: PrismaClient,
  courseId: string,
): Promise<Record<string, unknown>> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      difficulty: true,
      estimatedMinutes: true,
      passingScore: true,
      attemptLimit: true,
      recertifyMonths: true,
      requiredVideoPercent: true,
      sections: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          order: true,
          lessons: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              type: true,
              order: true,
              required: true,
              estimatedMinutes: true,
              content: true,
              questions: {
                orderBy: { order: "asc" },
                select: {
                  id: true,
                  type: true,
                  order: true,
                  prompt: true,
                  config: true,
                  points: true,
                  explanation: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!course) throw new Error(`Course ${courseId} not found while building snapshot`);
  return JSON.parse(JSON.stringify(course)) as Record<string, unknown>;
}

export async function seedLearningPath(
  prisma: PrismaClient,
  spec: PathSpec,
  userIds: Map<string, string>,
  courseIds: Map<string, string>,
  sopIds: Map<string, string>,
): Promise<string> {
  console.log("→ Learning path");
  const ownerId = userIds.get(spec.ownerEmail) ?? userIds.get("admin@fswelsford.com") ?? "";

  const existing = await prisma.learningPath.findFirst({
    where: { title: spec.title },
    select: { id: true },
  });

  const path =
    existing ??
    (await prisma.learningPath.create({
      data: {
        title: spec.title,
        description: spec.description,
        ownerId,
        status: "PUBLISHED",
        createdById: ownerId,
      },
      select: { id: true },
    }));

  const itemCount = await prisma.learningPathItem.count({ where: { pathId: path.id } });
  if (itemCount === 0) {
    for (const [index, item] of spec.items.entries()) {
      await prisma.learningPathItem.create({
        data: {
          pathId: path.id,
          order: index,
          label: item.label,
          targetType: item.targetType,
          courseId: item.courseKey ? (courseIds.get(item.courseKey) ?? null) : null,
          sopId: item.sopCode ? (sopIds.get(item.sopCode) ?? null) : null,
          required: item.required,
          isMilestone: item.isMilestone ?? false,
          dueDaysAfterStart: item.dueDaysAfterStart,
        },
      });
    }
  }

  return path.id;
}

export async function seedRulesAndCompliance(
  prisma: PrismaClient,
  userIds: Map<string, string>,
  courseIds: Map<string, string>,
  positionIds: Map<string, string>,
  sopIds: Map<string, string>,
): Promise<void> {
  console.log("→ Assignment rules and compliance rules");

  const adminId = userIds.get("admin@fswelsford.com") ?? "";
  const complianceOwner = userIds.get("compliance@fswelsford.com") ?? null;

  const rules: {
    name: string;
    description: string;
    criteria: Record<string, unknown>;
    targetType: "COURSE" | "SOP" | "LEARNING_PATH";
    courseKey?: string;
    sopCode?: string;
    dueDays: number;
  }[] = [
    {
      name: "All employees — Cybersecurity Fundamentals",
      description:
        "Every employee and contractor completes cybersecurity training within 14 days of their start date, then annually.",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      targetType: "COURSE",
      courseKey: "cyber",
      dueDays: 14,
    },
    {
      name: "Sales department — Customer Quote Process",
      description: "Anyone in Sales learns the quoting procedure.",
      criteria: {
        all: [
          { field: "departmentName", op: "eq", value: "Sales" },
          { field: "status", op: "eq", value: "ACTIVE" },
        ],
      },
      targetType: "COURSE",
      courseKey: "quote-process",
      dueDays: 30,
    },
    {
      name: "Operations — Warehouse Safety and Receiving",
      description: "Warehouse and Operations personnel complete safety and receiving training.",
      criteria: {
        all: [
          { field: "departmentName", op: "eq", value: "Operations" },
          { field: "status", op: "eq", value: "ACTIVE" },
        ],
      },
      targetType: "COURSE",
      courseKey: "warehouse-safety",
      dueDays: 7,
    },
    {
      name: "Philippines contractors — Acceptable Use policy",
      description:
        "Philippines-based contractors acknowledge the technology acceptable use policy.",
      criteria: {
        all: [
          { field: "country", op: "eq", value: "PH" },
          { field: "workerType", op: "eq", value: "PH_CONTRACTOR" },
        ],
      },
      targetType: "SOP",
      sopCode: "POL-001",
      dueDays: 5,
    },
    {
      name: "US employees — Acceptable Use policy",
      description: "US employees acknowledge the technology acceptable use policy annually.",
      criteria: {
        all: [
          { field: "country", op: "eq", value: "US" },
          { field: "workerType", op: "eq", value: "US_EMPLOYEE" },
        ],
      },
      targetType: "SOP",
      sopCode: "POL-001",
      dueDays: 10,
    },
  ];

  for (const rule of rules) {
    const existing = await prisma.assignmentRule.findFirst({
      where: { name: rule.name },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.assignmentRule.create({
      data: {
        name: rule.name,
        description: rule.description,
        criteria: rule.criteria as Prisma.InputJsonValue,
        targetType: rule.targetType,
        courseId: rule.courseKey ? (courseIds.get(rule.courseKey) ?? null) : null,
        sopId: rule.sopCode ? (sopIds.get(rule.sopCode) ?? null) : null,
        dueDays: rule.dueDays,
        createdById: adminId,
      },
    });
  }

  // Position training requirements — what a role needs by definition.
  const positionRequirements: { positionId: string; courseKey: string }[] = [
    { positionId: "pos_inside_sales", courseKey: "quote-process" },
    { positionId: "pos_inside_sales", courseKey: "valve-fundamentals" },
    { positionId: "pos_outside_sales", courseKey: "quote-process" },
    { positionId: "pos_outside_sales", courseKey: "valve-fundamentals" },
    { positionId: "pos_app_engineer", courseKey: "valve-fundamentals" },
    { positionId: "pos_warehouse_assoc", courseKey: "warehouse-safety" },
    { positionId: "pos_ecom_specialist", courseKey: "valve-fundamentals" },
  ];

  for (const requirement of positionRequirements) {
    const positionId = positionIds.get(requirement.positionId);
    const courseId = courseIds.get(requirement.courseKey);
    if (!positionId || !courseId) continue;

    const existing = await prisma.positionTrainingRequirement.findFirst({
      where: { positionId, courseId },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.positionTrainingRequirement.create({
      data: { positionId, targetType: "COURSE", courseId, required: true },
    });
  }

  // Compliance rules — configurable, with an explicit verification reminder.
  const complianceRules: {
    name: string;
    jurisdiction: string;
    requirement: string;
    courseKey?: string;
    criteria: Record<string, unknown>;
    frequencyMonths: number | null;
    retentionYears: number;
    notes: string;
  }[] = [
    {
      name: "Cybersecurity awareness training",
      jurisdiction: "FSW Group policy",
      requirement:
        "All personnel with system access complete cybersecurity awareness training annually.",
      courseKey: "cyber",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      frequencyMonths: 12,
      retentionYears: 3,
      notes:
        "Internal policy requirement. Verify insurance and customer contractual requirements with a qualified advisor.",
    },
    {
      name: "Warehouse safety training",
      jurisdiction: "US-Federal",
      requirement:
        "Personnel working in the distribution center complete hazard awareness and safe work practice training.",
      courseKey: "warehouse-safety",
      criteria: {
        all: [{ field: "departmentName", op: "eq", value: "Operations" }],
      },
      frequencyMonths: 12,
      retentionYears: 5,
      notes:
        "Verify requirement, content, and recordkeeping obligations with a qualified legal or safety advisor. This platform manages evidence; it does not determine regulatory applicability.",
    },
    {
      name: "Technology acceptable use acknowledgement",
      jurisdiction: "FSW Group policy",
      requirement:
        "All personnel acknowledge the acceptable use policy at hire and after any material revision.",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      frequencyMonths: 12,
      retentionYears: 7,
      notes: "Internal policy requirement.",
    },
  ];

  for (const rule of complianceRules) {
    const existing = await prisma.complianceRule.findFirst({
      where: { name: rule.name },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.complianceRule.create({
      data: {
        name: rule.name,
        jurisdiction: rule.jurisdiction,
        requirement: rule.requirement,
        courseId: rule.courseKey ? (courseIds.get(rule.courseKey) ?? null) : null,
        criteria: rule.criteria as Prisma.InputJsonValue,
        frequencyMonths: rule.frequencyMonths,
        retentionYears: rule.retentionYears,
        ownerId: complianceOwner,
        lastVerifiedAt: new Date(),
        notes: rule.notes,
        effectiveDate: new Date("2026-01-01"),
      },
    });
  }
}

export async function seedAnnouncements(
  prisma: PrismaClient,
  userIds: Map<string, string>,
): Promise<void> {
  console.log("→ Announcements");
  const authorId = userIds.get("hr.admin@fswelsford.com") ?? userIds.get("admin@fswelsford.com") ?? "";

  const existing = await prisma.announcement.findFirst({
    where: { title: "FSW Academy is live" },
    select: { id: true },
  });
  if (existing) return;

  await prisma.announcement.create({
    data: {
      title: "FSW Academy is live",
      body:
        "FSW Academy is now the single place for our procedures, training, and answers. " +
        "Start with your assigned training on the Home page. If you cannot find something, " +
        "press Cmd+K to search or ask FSW AI — and if an SOP looks out of date, use the " +
        "Report outdated information button so the owner can fix it.",
      authorId,
      pinned: true,
      requiresAck: false,
      startsAt: new Date(),
    },
  });
}
