/**
 * FSW Talent Scout — Mechanical Interest statement bank.
 *
 * ORIGINAL FSW Group content. Nothing in this file is copied from, adapted
 * from, or paraphrased out of any third-party assessment instrument.
 *
 * Measures INTEREST in / orientation toward mechanical subjects — equipment,
 * machines, diagrams, physical systems, how products function — NOT
 * mechanical ability or knowledge.
 *
 * Scale: 5-point agree/disagree.
 *   reverseCoded: false — Strongly Agree scores HIGH mechanical interest.
 *   reverseCoded: true  — Strongly Agree scores LOW mechanical interest
 *   (statements a person with little mechanical interest would endorse,
 *   written neutrally, never disparagingly).
 */
import type { StatementBank } from "../types";

export const mechanicalInterestBank: StatementBank = {
  items: [
    // -------------------- Forward-coded (high interest) --------------------
    {
      construct: "MECHANICAL_INTEREST",
      text: "When a machine I use every day starts making a new noise, I want to find out what changed inside it.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I enjoy reading the specification sheet that comes with a new piece of equipment.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Given free time at a plant or shop, I would head over to watch the machinery run.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I like tracing a diagram to see how one moving part drives another.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I have taken devices apart just to see how they were put together.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "When a product works well, I find myself wondering how it was manufactured.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I would enjoy a tour of a factory floor more than a tour of the same company's front offices.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Figuring out why a pump, valve, or motor stopped working sounds like a satisfying puzzle to me.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I pay attention to how tools are engineered, not just whether they get the job done.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Videos or articles that show how everyday products are made hold my attention.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I like knowing the pressure, temperature, or load ratings of the equipment around me.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "If a piece of office equipment jams, I would rather open it up and take a look than wait for someone else.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Exploded-view drawings that show every part of an assembly are interesting to me.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I notice the plumbing, ductwork, and wiring in a building, not just the finished rooms.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I would gladly attend a training session on how our production equipment works, even if my job did not require it.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Conversations about torque, tolerances, or pipe fittings do not lose me — I want to hear more.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I keep the manuals for my equipment because I genuinely like consulting them.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "When crossing a bridge or riding an elevator, I sometimes think about the mechanisms that make it work.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I would rather assemble a piece of furniture myself than pay someone to do it, because the assembly is the fun part.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Troubleshooting a physical system step by step — checking one component at a time — appeals to me.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I like comparing two models of a machine to see which one is built better.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "At a trade show, the working equipment demonstrations are the booths I would visit first.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I enjoy explaining to others how a mechanical device does what it does.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Learning what each gauge and indicator on a control panel means sounds interesting to me.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "When something breaks at home, my first move is to open it up and investigate.",
      reverseCoded: false,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I like understanding why each step in an equipment maintenance schedule is there, not just following it.",
      reverseCoded: false,
    },

    // -------------------- Reverse-coded (low interest) --------------------
    {
      construct: "MECHANICAL_INTEREST",
      text: "When equipment acts up, I would rather hand it to a specialist than investigate it myself.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Technical manuals are something I skim only when I absolutely have to.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "How a machine works matters less to me than whether it works.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I would choose a seminar on working with people over one on how equipment operates.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Diagrams full of parts, arrows, and labels are the pages I tend to skip.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Talk about motors, fittings, and valves tends to lose my interest quickly.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I am content to use a device for years without ever wondering what is inside it.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Given a choice of assignments, I would pick the one that keeps me farthest from the machinery.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Assembly instructions are the part of a purchase I enjoy least.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I would rather write the report about a piece of equipment than spend the day around the equipment itself.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Specification tables full of ratings and measurements do not hold my attention.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "When a demonstration turns to the inner workings of a machine, my mind drifts to other things.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I leave questions about how our systems operate to the people who enjoy that sort of thing.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "On a site visit, I am more interested in the people and the schedule than in the equipment.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "If a gadget stops working, replacing it appeals to me more than opening it up.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "I rarely wonder how the products I use every day are made.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "Adjusting or calibrating equipment is a task I am happy to pass along to someone else.",
      reverseCoded: true,
    },
    {
      construct: "MECHANICAL_INTEREST",
      text: "The \"how it works\" section of a product description is the part I usually skip.",
      reverseCoded: true,
    },
  ],
};
