/**
 * FSW Talent Scout development seed.
 *
 * Seeds: org settings, dev-only admin accounts, the full original question
 * bank (versioned + approved), assessment form v1 with section timers,
 * transparent composite definitions, versioned narrative/interview/
 * development templates, the Welsford Inside Technical Sales benchmark
 * profile, a fictional opening, and the "Alex Sample" completed-report
 * fixture used to verify layout and selection rules.
 *
 * Admin passwords are dev-only and are refused in production.
 */

import { PrismaClient, type Construct, type Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

import { resolveDatabaseUrl } from "../src/lib/database-url";
import { hashPassword } from "../src/lib/auth/password";

// Accept Netlify DB / Neon connection strings under their various env names.
resolveDatabaseUrl();

import { mentalAcuityBank } from "../src/content/banks/mental-acuity";
import { businessTermsBank } from "../src/content/banks/business-terms";
import { vocabularyBank } from "../src/content/banks/vocabulary";
import { awarenessMemoryBank } from "../src/content/banks/awareness-memory";
import { behavioralBank } from "../src/content/banks/behavioral";
import { mechanicalInterestBank } from "../src/content/banks/mechanical-interest";
import { numericalPerceptionBank } from "../src/content/banks/numerical-perception";
import { aptitudeNarratives } from "../src/content/narratives/aptitude-narratives";
import { behavioralNarratives1 } from "../src/content/narratives/behavioral-narratives-1";
import { behavioralNarratives2 } from "../src/content/narratives/behavioral-narratives-2";
import { validityNarratives } from "../src/content/narratives/validity-narratives";
import { interviewTemplates } from "../src/content/narratives/interview-templates";
import { developmentTemplates } from "../src/content/narratives/development-templates";
import {
  BEHAVIORAL_CONSTRUCTS,
  type AptitudeItem,
  type StatementItem,
} from "../src/content/types";

const prisma = new PrismaClient();
const NARRATIVE_VERSION = "1.0";

const BEHAVIORAL_ORDER: string[] = [...BEHAVIORAL_CONSTRUCTS, "DISTORTION"];

async function main(): Promise<void> {
  console.log("Seeding FSW Talent Scout…");

  // ---- Org settings ---------------------------------------------------------
  await prisma.orgSettings.upsert({
    where: { id: "org" },
    create: {
      id: "org",
      companyName: "FSW Group",
      privacyContactEmail: "privacy@fswgroup.example",
      accommodationContactEmail: "hr@fswgroup.example",
      hrNotificationEmail: "hr@fswgroup.example",
      privacyNoticeConfigured: true,
      assessmentDisclaimer:
        "FSW Talent Scout is decision-support software and should not be the sole basis for an employment decision.",
    },
    update: {},
  });

  // ---- Production bootstrap admin ----------------------------------------------
  // On a fresh production database, create the first SUPER_ADMIN from env
  // vars so hosted deploys (e.g. Netlify) never need dev accounts.
  const userCount = await prisma.user.count();
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (userCount === 0 && bootstrapEmail && bootstrapPassword) {
    if (bootstrapPassword.length < 12) {
      throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.");
    }
    await prisma.user.create({
      data: {
        email: bootstrapEmail.toLowerCase(),
        name: "FSW Administrator",
        role: "SUPER_ADMIN",
        passwordHash: await hashPassword(bootstrapPassword),
      },
    });
    console.log(`Bootstrap SUPER_ADMIN created: ${bootstrapEmail.toLowerCase()}`);
  }

  // ---- Dev-only admin accounts -----------------------------------------------
  if (process.env.NODE_ENV === "production" && !process.env.SEED_DEV_USERS) {
    console.log("Production: skipping dev admin accounts (set real users manually).");
  } else {
    const password = process.env.SEED_ADMIN_PASSWORD ?? "fsw-talentscout-dev";
    const hash = await hashPassword(password);
    const users = [
      { email: "super@fsw.local", name: "Sam Superuser", role: "SUPER_ADMIN" },
      { email: "hr@fsw.local", name: "Harper Reyes (HR)", role: "HR_ADMIN" },
      { email: "manager@fsw.local", name: "Morgan Vale (Hiring Mgr)", role: "HIRING_MANAGER" },
      { email: "psych@fsw.local", name: "Avery Quinn (Assessment)", role: "ASSESSMENT_ADMIN" },
      { email: "viewer@fsw.local", name: "Val Reader (Viewer)", role: "VIEWER" },
    ] as const;
    for (const u of users) {
      await prisma.user.upsert({
        where: { email: u.email },
        create: { email: u.email, name: u.name, role: u.role, passwordHash: hash },
        update: {},
      });
    }
    console.log(`Dev admin accounts ready (password: ${password}).`);
  }

  // ---- Question bank ----------------------------------------------------------
  const existingQuestions = await prisma.question.count();
  let seedVersionIds: Map<string, { id: string; bucket: number; orderHint: number }[]>;
  if (existingQuestions > 0) {
    console.log(`Question bank already seeded (${existingQuestions} questions).`);
    seedVersionIds = await loadExistingBank();
  } else {
    seedVersionIds = await seedQuestionBank();
  }

  // ---- Assessment version v1 ---------------------------------------------------
  // Located by version number, not by name. An instance seeded before the
  // Talent Scout rename holds this same form under its old name; matching on
  // the name would create a SECOND active v1 beside it, and two active forms
  // means candidates competing for one opening can sit different assessments.
  let version = await prisma.assessmentVersion.findFirst({
    where: { versionNumber: 1 },
  });
  if (version && version.name !== "FSW Talent Scout Standard") {
    version = await prisma.assessmentVersion.update({
      where: { id: version.id },
      data: { name: "FSW Talent Scout Standard" },
    });
    console.log("Renamed the existing v1 assessment form to FSW Talent Scout Standard.");
  }
  if (!version) {
    version = await prisma.assessmentVersion.create({
      data: {
        name: "FSW Talent Scout Standard",
        versionNumber: 1,
        status: "ACTIVE",
        description:
          "Standard FSW Talent Scout form: behavioral inventory, mechanical interest, and five timed aptitude sections. Approx. 50-65 minutes.",
        scoringVersion: "1.0",
        narrativeVersion: NARRATIVE_VERSION,
        activatedAt: new Date(),
        sections: {
          create: [
            {
              key: "BEHAVIORAL",
              title: "Work Style Inventory",
              orderIndex: 0,
              timed: false,
              questionCount: 96,
              instructions:
                "This section asks how you typically work. There are no right or wrong answers — choose the response that genuinely describes you. It is untimed; most people finish in 15-20 minutes.",
            },
            {
              key: "MECHANICAL_INTEREST",
              title: "Technical & Mechanical Interests",
              orderIndex: 1,
              timed: false,
              questionCount: 18,
              instructions:
                "These statements ask about your interests — not your abilities. Choose the response that best reflects how interested you genuinely are. Untimed.",
            },
            {
              key: "MENTAL_ACUITY",
              title: "Reasoning & Problem Solving",
              orderIndex: 2,
              timed: true,
              durationSeconds: 660,
              questionCount: 24,
              instructions:
                "24 reasoning questions in 11 minutes. Work quickly but carefully — unanswered questions are recorded as unanswered when time expires. You may move back and forth within the section.",
            },
            {
              key: "BUSINESS_TERMS",
              title: "Business Terms & Concepts",
              orderIndex: 3,
              timed: true,
              durationSeconds: 420,
              questionCount: 19,
              instructions:
                "19 questions about common business concepts in 7 minutes. Choose the best answer for each.",
            },
            {
              key: "AWARENESS_MEMORY",
              title: "Business Awareness & Memory",
              orderIndex: 4,
              timed: true,
              durationSeconds: 480,
              questionCount: 17,
              instructions:
                "This section begins with short briefings to study — read them carefully; they will not be shown again. Later questions test recall of those briefings plus general business awareness. 8 minutes total.",
            },
            {
              key: "VOCABULARY",
              title: "Vocabulary & Comprehension",
              orderIndex: 5,
              timed: true,
              durationSeconds: 420,
              questionCount: 19,
              instructions:
                "19 vocabulary and comprehension questions in 7 minutes.",
            },
            {
              key: "NUMERICAL_PERCEPTION",
              title: "Detail Checking",
              orderIndex: 6,
              timed: true,
              durationSeconds: 360,
              questionCount: 40,
              instructions:
                "Compare part numbers, prices, and codes quickly and accurately. 40 items in 6 minutes — this section is intentionally fast-paced. Accuracy matters more than finishing.",
            },
          ],
        },
      },
    });

    // Map every seeded, approved question version into the form pool.
    const formRows: Prisma.AssessmentFormQuestionCreateManyInput[] = [];
    for (const [sectionKey, entries] of seedVersionIds.entries()) {
      for (const e of entries) {
        formRows.push({
          assessmentVersionId: version.id,
          sectionKey,
          questionVersionId: e.id,
          difficultyBucket: e.bucket,
          orderHint: e.orderHint,
        });
      }
    }
    await prisma.assessmentFormQuestion.createMany({
      data: formRows,
      skipDuplicates: true,
    });
    console.log(`Assessment form v1 created with ${formRows.length} pooled questions.`);
  }

  // ---- Composite definitions ---------------------------------------------------
  const composites: {
    key: string;
    name: string;
    category: "SALES" | "LEADERSHIP";
    components: { construct: string; weight: number }[];
    description: string;
  }[] = [
    { key: "sales_persistence", name: "Persistence and consistency", category: "SALES", components: comp(["MENTAL_TOUGHNESS", "ENERGY", "FLEXIBILITY"]), description: "Staying power across long sales cycles and setbacks." },
    { key: "sales_meeting_people", name: "Meeting and communicating with people", category: "SALES", components: comp(["COMMUNICATION", "VOCABULARY", "EMOTIONAL_DEVELOPMENT"]), description: "Comfort and effectiveness engaging new people." },
    { key: "sales_command_respect", name: "Ability to command respect", category: "SALES", components: comp(["ASSERTIVENESS", "EMOTIONAL_DEVELOPMENT", "COMMUNICATION"]), description: "Presence and credibility with customers." },
    { key: "sales_goal_orientation", name: "Setting goals to win, excel and achieve", category: "SALES", components: comp(["COMPETITIVENESS", "MOTIVATION", "ENERGY"]), description: "Drive toward targets and measurable results." },
    { key: "sales_rapport", name: "Developing rapport", category: "SALES", components: comp(["COMMUNICATION", "FLEXIBILITY", "EMOTIONAL_DEVELOPMENT"]), description: "Building comfortable working relationships." },
    { key: "sales_identifying_needs", name: "Identifying need or desire", category: "SALES", components: comp(["QUESTIONING_PROBING", "MENTAL_ACUITY", "COMMUNICATION"]), description: "Uncovering what the customer actually needs." },
    { key: "sales_presenting", name: "Presenting a product or service", category: "SALES", components: comp(["VOCABULARY", "BUSINESS_TERMS", "COMMUNICATION", "MENTAL_ACUITY"]), description: "Explaining solutions in the customer's terms." },
    { key: "sales_objections", name: "Dealing with objections", category: "SALES", components: comp(["MENTAL_TOUGHNESS", "ASSERTIVENESS", "QUESTIONING_PROBING"]), description: "Working through resistance constructively." },
    { key: "sales_closing", name: "Closing the sale", category: "SALES", components: comp(["ASSERTIVENESS", "MOTIVATION", "COMPETITIVENESS"]), description: "Asking for the business and finishing." },
    { key: "sales_learning_speed", name: "Learning speed and efficiency", category: "SALES", components: comp(["MENTAL_ACUITY", "AWARENESS_MEMORY"]), description: "Picking up products, systems, and markets quickly." },
    { key: "sales_growth", name: "Changing, growing and learning new concepts", category: "SALES", components: comp(["FLEXIBILITY", "MENTAL_ACUITY", "QUESTIONING_PROBING"]), description: "Adapting to new ideas and approaches." },
    { key: "lead_planning", name: "Planning", category: "LEADERSHIP", components: comp(["ORGANIZATION", "MENTAL_ACUITY", "QUESTIONING_PROBING"]), description: "Thinking ahead and structuring work." },
    { key: "lead_organizing", name: "Organizing", category: "LEADERSHIP", components: comp(["ORGANIZATION", "FLEXIBILITY", "BUSINESS_TERMS"]), description: "Arranging people, resources, and processes." },
    { key: "lead_directing", name: "Directing", category: "LEADERSHIP", components: comp(["ASSERTIVENESS", "COMMUNICATION", "ENERGY"]), description: "Setting direction and keeping momentum." },
    { key: "lead_staffing", name: "Staffing / people judgment", category: "LEADERSHIP", components: comp(["COMMUNICATION", "QUESTIONING_PROBING", "EMOTIONAL_DEVELOPMENT"]), description: "Reading people and matching them to work." },
    { key: "lead_controlling", name: "Controlling / follow-through", category: "LEADERSHIP", components: comp(["ORGANIZATION", "MENTAL_TOUGHNESS", "MOTIVATION"]), description: "Tracking outcomes and closing loops." },
  ];
  let orderIndex = 0;
  for (const c of composites) {
    await prisma.compositeDefinition.upsert({
      where: { key: c.key },
      create: {
        key: c.key,
        name: c.name,
        category: c.category,
        components: c.components,
        description: c.description,
        version: "1.0",
        orderIndex: orderIndex++,
      },
      update: {},
    });
  }

  // ---- Narrative / interview / development templates ---------------------------
  const narrativeSets = [
    ...aptitudeNarratives,
    ...behavioralNarratives1,
    ...behavioralNarratives2,
  ];
  for (const set of narrativeSets) {
    for (let band = 1; band <= 9; band++) {
      await upsertNarrative(set.construct, `BAND_${band}`, set.bandNarratives[band - 1]);
    }
    await upsertNarrative(set.construct, "RANGE_BELOW", set.rangePosition.below);
    await upsertNarrative(set.construct, "RANGE_WITHIN", set.rangePosition.within);
    await upsertNarrative(set.construct, "RANGE_ABOVE", set.rangePosition.above);
  }
  for (const v of validityNarratives) {
    await upsertNarrative(v.construct, "LEVEL_NORMAL", v.levels.normal);
    await upsertNarrative(v.construct, "LEVEL_ELEVATED", v.levels.elevated);
    await upsertNarrative(v.construct, "LEVEL_HIGH", v.levels.high);
  }
  for (const t of interviewTemplates) {
    await prisma.interviewQuestionTemplate.upsert({
      where: {
        construct_focus_version: {
          construct: t.construct as Construct,
          focus: t.focus,
          version: NARRATIVE_VERSION,
        },
      },
      create: {
        construct: t.construct as Construct,
        focus: t.focus,
        measures: t.measures,
        questions: t.questions as unknown as Prisma.InputJsonValue,
        version: NARRATIVE_VERSION,
      },
      update: {},
    });
  }
  for (const t of developmentTemplates) {
    await prisma.developmentTemplate.upsert({
      where: {
        construct_version: {
          construct: t.construct as Construct,
          version: NARRATIVE_VERSION,
        },
      },
      create: {
        construct: t.construct as Construct,
        recommendations: t.recommendations,
        version: NARRATIVE_VERSION,
      },
      update: {},
    });
  }
  console.log("Narrative, interview, and development templates seeded.");

  // ---- Welsford Inside Technical Sales profile -----------------------------------
  let profile = await prisma.jobProfile.findFirst({
    where: { name: "Welsford Inside Technical Sales" },
  });
  if (!profile) {
    profile = await prisma.jobProfile.create({
      data: {
        name: "Welsford Inside Technical Sales",
        description:
          "Inside technical sales for Welsford: quoting, product selection, and customer support for industrial flow-control products.",
        isSalesRole: true,
        benchmarks: {
          create: [
            bm("MENTAL_ACUITY", 5, 7),
            bm("BUSINESS_TERMS", 4, 6),
            bm("AWARENESS_MEMORY", 7, 9),
            bm("VOCABULARY", 5, 7),
            bm("NUMERICAL_PERCEPTION", 6, 9),
            bm("MECHANICAL_INTEREST", 6, 9),
            bm("ENERGY", 5, 7),
            bm("FLEXIBILITY", 5, 7),
            bm("ORGANIZATION", 5, 9),
            bm("COMMUNICATION", 5, 7),
            bm("EMOTIONAL_DEVELOPMENT", 4, 7),
            bm("ASSERTIVENESS", 5, 7),
            bm("COMPETITIVENESS", 3, 7),
            bm("MENTAL_TOUGHNESS", 3, 6),
            bm("QUESTIONING_PROBING", 4, 6),
            bm("MOTIVATION", 5, 9),
          ],
        },
        concernRules: {
          create: ["ENERGY", "FLEXIBILITY", "EMOTIONAL_DEVELOPMENT", "MENTAL_TOUGHNESS"].map(
            (c) => ({
              construct: c as Construct,
              maxBand: 2,
              label: "Additional Interview Attention Recommended",
            }),
          ),
        },
        openings: { create: { title: "Inside Technical Sales Representative" } },
      },
    });
    console.log("Welsford Inside Technical Sales profile seeded.");
  }

  // ---- Alex Sample report fixture ---------------------------------------------------
  await seedAlexSample(version.id, profile.id);

  console.log("Seed complete.");
}

function comp(constructs: string[]): { construct: string; weight: number }[] {
  return constructs.map((c) => ({ construct: c, weight: 1 }));
}

function bm(construct: string, min: number, max: number) {
  return {
    construct: construct as Construct,
    minScore: min,
    maxScore: max,
    required: true,
    enabled: true,
    weight: 1,
  };
}

async function upsertNarrative(
  construct: string,
  slot: string,
  text: string,
): Promise<void> {
  await prisma.narrativeTemplate.upsert({
    where: {
      construct_slot_version: {
        construct: construct as Construct,
        slot,
        version: NARRATIVE_VERSION,
      },
    },
    create: { construct: construct as Construct, slot, text, version: NARRATIVE_VERSION },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// Question bank seeding
// ---------------------------------------------------------------------------

type BankEntry = { id: string; bucket: number; orderHint: number };

async function seedQuestionBank(): Promise<Map<string, BankEntry[]>> {
  const bySection = new Map<string, BankEntry[]>();
  const push = (section: string, entry: BankEntry) => {
    const list = bySection.get(section) ?? [];
    list.push(entry);
    bySection.set(section, list);
  };

  const aptitudeBanks: { section: string; items: AptitudeItem[] }[] = [
    { section: "MENTAL_ACUITY", items: mentalAcuityBank.items },
    { section: "BUSINESS_TERMS", items: businessTermsBank.items },
    { section: "VOCABULARY", items: vocabularyBank.items },
    { section: "AWARENESS_MEMORY", items: awarenessMemoryBank.items },
  ];
  for (const bank of aptitudeBanks) {
    for (const item of bank.items) {
      const id = await createQuestion({
        construct: item.construct,
        subtype: item.subtype,
        kind: "MULTIPLE_CHOICE",
        prompt: item.prompt,
        choices: item.choices,
        correctIndex: item.correctIndex,
        explanation: item.explanation,
        difficulty: item.difficulty,
      });
      push(bank.section, { id, bucket: item.difficulty, orderHint: 1 });
    }
  }

  // Memory exercises: a study card plus recall questions sharing a pairKey.
  for (const ex of awarenessMemoryBank.exercises) {
    const studyId = await createQuestion({
      construct: "AWARENESS_MEMORY",
      subtype: "memory_study",
      kind: "MEMORY_STUDY",
      prompt: ex.stimulus,
      promptData: { studySeconds: ex.studySeconds, title: ex.title },
      difficulty: 2,
      pairKey: ex.key,
    });
    push("AWARENESS_MEMORY", { id: studyId, bucket: 2, orderHint: 0 });
    for (const q of ex.questions) {
      const id = await createQuestion({
        construct: "AWARENESS_MEMORY",
        subtype: "memory_recall",
        kind: "MULTIPLE_CHOICE",
        prompt: q.prompt,
        choices: q.choices,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        difficulty: q.difficulty,
        pairKey: ex.key,
      });
      push("AWARENESS_MEMORY", { id, bucket: q.difficulty, orderHint: 1 });
    }
  }

  // Numerical perception (generated, stored, versioned like everything else).
  for (const item of numericalPerceptionBank.items) {
    const id = await createQuestion({
      construct: "NUMERICAL_PERCEPTION",
      subtype: item.subtype,
      kind: "STRING_COMPARISON",
      prompt: item.prompt,
      choices: item.choices,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
      difficulty: item.difficulty,
    });
    push("NUMERICAL_PERCEPTION", { id, bucket: item.difficulty, orderHint: 1 });
  }

  // Behavioral inventory: bucket by construct so proportional bucket
  // selection guarantees balanced construct coverage on every form.
  for (const item of behavioralBank.items as StatementItem[]) {
    const id = await createQuestion({
      construct: item.construct,
      subtype: item.impressionManagement ? "impression_management" : "behavioral_statement",
      kind: "LIKERT_STATEMENT",
      prompt: item.text,
      difficulty: 2,
      reverseCoded: item.reverseCoded,
      pairKey: item.pairKey,
      impressionManagement: item.impressionManagement ?? false,
    });
    push("BEHAVIORAL", {
      id,
      bucket: BEHAVIORAL_ORDER.indexOf(item.construct),
      orderHint: 1,
    });
  }

  for (const item of mechanicalInterestBank.items as StatementItem[]) {
    const id = await createQuestion({
      construct: "MECHANICAL_INTEREST",
      subtype: "interest_statement",
      kind: "LIKERT_STATEMENT",
      prompt: item.text,
      difficulty: 2,
      reverseCoded: item.reverseCoded,
    });
    push("MECHANICAL_INTEREST", {
      id,
      bucket: item.reverseCoded ? 1 : 0,
      orderHint: 1,
    });
  }

  const total = [...bySection.values()].reduce((n, l) => n + l.length, 0);
  console.log(`Question bank seeded: ${total} question versions.`);
  return bySection;
}

async function createQuestion(params: {
  construct: string;
  subtype: string;
  kind: "MULTIPLE_CHOICE" | "LIKERT_STATEMENT" | "MEMORY_STUDY" | "STRING_COMPARISON";
  prompt: string;
  choices?: string[];
  correctIndex?: number;
  explanation?: string;
  promptData?: Record<string, unknown>;
  difficulty: number;
  reverseCoded?: boolean;
  pairKey?: string;
  impressionManagement?: boolean;
}): Promise<string> {
  const question = await prisma.question.create({
    data: {
      construct: params.construct as Construct,
      subtype: params.subtype,
      kind: params.kind,
      status: "APPROVED",
      source: "fsw_original",
      versions: {
        create: {
          version: 1,
          construct: params.construct as Construct,
          subtype: params.subtype,
          kind: params.kind,
          prompt: params.prompt,
          choices: params.choices,
          correctIndex: params.correctIndex,
          explanation: params.explanation,
          promptData: params.promptData as Prisma.InputJsonValue | undefined,
          difficulty: params.difficulty,
          reverseCoded: params.reverseCoded ?? false,
          pairKey: params.pairKey,
          impressionManagement: params.impressionManagement ?? false,
          approvedAt: new Date(),
        },
      },
    },
    include: { versions: true },
  });
  return question.versions[0].id;
}

async function loadExistingBank(): Promise<Map<string, BankEntry[]>> {
  // Rebuild the section → version map for form creation on re-seed.
  const versions = await prisma.questionVersion.findMany({
    where: { question: { status: "APPROVED" } },
    select: {
      id: true,
      construct: true,
      kind: true,
      difficulty: true,
      reverseCoded: true,
      impressionManagement: true,
    },
  });
  const map = new Map<string, BankEntry[]>();
  for (const v of versions) {
    let section: string = v.construct;
    let bucket = v.difficulty;
    let orderHint = 1;
    if (v.kind === "LIKERT_STATEMENT" && v.construct !== "MECHANICAL_INTEREST") {
      section = "BEHAVIORAL";
      bucket = BEHAVIORAL_ORDER.indexOf(v.construct);
    } else if (v.construct === "MECHANICAL_INTEREST") {
      section = "MECHANICAL_INTEREST";
      bucket = v.reverseCoded ? 1 : 0;
    } else if (v.construct === "DISTORTION") {
      section = "BEHAVIORAL";
      bucket = BEHAVIORAL_ORDER.indexOf("DISTORTION");
    }
    if (v.kind === "MEMORY_STUDY") orderHint = 0;
    const list = map.get(section) ?? [];
    list.push({ id: v.id, bucket, orderHint });
    map.set(section, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Alex Sample fixture (spec section 50) — layout/report testing only.
// ---------------------------------------------------------------------------

const ALEX_BANDS: Record<string, number> = {
  MENTAL_ACUITY: 9,
  BUSINESS_TERMS: 5,
  AWARENESS_MEMORY: 9,
  VOCABULARY: 9,
  NUMERICAL_PERCEPTION: 8,
  MECHANICAL_INTEREST: 7,
  ENERGY: 6,
  FLEXIBILITY: 7,
  ORGANIZATION: 3,
  COMMUNICATION: 6,
  EMOTIONAL_DEVELOPMENT: 6,
  ASSERTIVENESS: 6,
  COMPETITIVENESS: 3,
  MENTAL_TOUGHNESS: 2,
  QUESTIONING_PROBING: 4,
  MOTIVATION: 7,
  DISTORTION: 5,
  EQUIVOCATION: 5,
};

/** Scaled-score midpoints of the provisional bands (see scoring/bands.ts). */
const BAND_MID_SCALED: Record<number, number> = {
  1: 7, 2: 21, 3: 34, 4: 45, 5: 55, 6: 65, 7: 75, 8: 85, 9: 95,
};

async function seedAlexSample(
  assessmentVersionId: string,
  jobProfileId: string,
): Promise<void> {
  const existing = await prisma.candidate.findFirst({
    where: { firstName: "Alex", lastName: "Sample" },
  });
  if (existing) {
    console.log("Alex Sample fixture already present.");
    return;
  }

  const opening = await prisma.jobOpening.findFirstOrThrow({
    where: { jobProfileId },
  });
  const candidate = await prisma.candidate.create({
    data: {
      firstName: "Alex",
      lastName: "Sample",
      email: "alex.sample@example.invalid",
    },
  });
  const { hashToken, generateToken, generateAssessmentCode, generateRecordId } =
    await import("../src/lib/crypto");
  const invitation = await prisma.invitation.create({
    data: {
      candidateId: candidate.id,
      jobOpeningId: opening.id,
      assessmentVersionId,
      tokenHash: hashToken(generateToken()),
      code: generateAssessmentCode(),
      status: "COMPLETED",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  const startedAt = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  const completedAt = new Date(startedAt.getTime() + 58 * 60 * 1000);
  const attempt = await prisma.attempt.create({
    data: {
      invitationId: invitation.id,
      candidateId: candidate.id,
      jobOpeningId: opening.id,
      assessmentVersionId,
      recordId: generateRecordId(),
      resumeTokenHash: hashToken(generateToken()),
      status: "COMPLETED",
      entryStep: "assessment",
      startedAt,
      completedAt,
    },
  });

  // Sections (all completed) — mirrors form v1 layout.
  const sectionKeys = [
    "BEHAVIORAL",
    "MECHANICAL_INTEREST",
    "MENTAL_ACUITY",
    "BUSINESS_TERMS",
    "AWARENESS_MEMORY",
    "VOCABULARY",
    "NUMERICAL_PERCEPTION",
  ];
  let cursor = startedAt.getTime();
  for (let i = 0; i < sectionKeys.length; i++) {
    const durations = [18, 5, 11, 7, 8, 7, 6];
    const start = new Date(cursor);
    cursor += durations[i] * 60 * 1000;
    await prisma.attemptSection.create({
      data: {
        attemptId: attempt.id,
        sectionKey: sectionKeys[i],
        orderIndex: i,
        status: "COMPLETED",
        timed: i >= 2,
        durationSeconds: i >= 2 ? durations[i] * 60 : null,
        startedAt: start,
        completedAt: new Date(cursor),
      },
    });
  }

  // Consent + integrity trail.
  await prisma.consentRecord.createMany({
    data: [
      {
        attemptId: attempt.id,
        consentType: "rules",
        noticeVersion: "1.0",
        consentText: "Fixture: rules acknowledged.",
      },
      {
        attemptId: attempt.id,
        consentType: "recording",
        noticeVersion: "1.0",
        consentText:
          "I have read the recording notice and consent to webcam video recording for the duration of this assessment.",
      },
    ],
  });
  const events: { type: string; offsetMin: number; meta?: object }[] = [
    { type: "ATTEMPT_STARTED", offsetMin: 0 },
    { type: "CAMERA_STARTED", offsetMin: 0 },
    ...sectionKeys.flatMap((k, i) => [
      { type: "SECTION_STARTED", offsetMin: i * 8, meta: { sectionKey: k } },
      { type: "SECTION_COMPLETED", offsetMin: i * 8 + 7, meta: { sectionKey: k } },
    ]),
    { type: "TAB_HIDDEN", offsetMin: 23 },
    { type: "TAB_VISIBLE", offsetMin: 23.2 },
    { type: "CAMERA_ENDED", offsetMin: 58 },
    { type: "ATTEMPT_COMPLETED", offsetMin: 58 },
  ];
  for (const e of events) {
    await prisma.integrityEvent.create({
      data: {
        attemptId: attempt.id,
        type: e.type,
        occurredAt: new Date(startedAt.getTime() + e.offsetMin * 60 * 1000),
        meta: (e.meta ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  // Fixture recording manifest (no actual video objects in the fixture).
  await prisma.recording.create({
    data: {
      attemptId: attempt.id,
      sessionId: randomUUID(),
      status: "FINALIZED",
      startedAt,
      endedAt: completedAt,
      expectedChunks: 0,
    },
  });

  // Scores: exact 1-9 fixture values, stored as provisional bands with
  // synthetic scaled scores at the band midpoints. detail marks the fixture.
  const scoreRows: Prisma.ScoreCreateManyInput[] = Object.entries(ALEX_BANDS).map(
    ([construct, band]) => ({
      attemptId: attempt.id,
      construct: construct as Construct,
      rawScore: BAND_MID_SCALED[band],
      scaledScore: BAND_MID_SCALED[band],
      band,
      bandType: "PROVISIONAL",
      scoringVersion: "1.0",
      detail:
        construct === "DISTORTION"
          ? { fixture: true, level: "NORMAL", imMean: 3.1, middleCount: 0 }
          : construct === "EQUIVOCATION"
            ? {
                fixture: true,
                level: "NORMAL",
                middleCount: 14,
                middleCountThreshold: 30,
                middleCountExceedsThreshold: false,
                pairsEvaluated: 10,
                pairInconsistency: 0.18,
              }
            : { fixture: true },
    }),
  );
  await prisma.score.createMany({ data: scoreRows });

  // Composite scores from the fixture bands via the transparent definitions.
  const { evaluateComposite } = await import("../src/lib/scoring/composites");
  const defs = await prisma.compositeDefinition.findMany({
    where: { active: true, category: "SALES" },
    orderBy: { orderIndex: "asc" },
  });
  for (const def of defs) {
    const result = evaluateComposite(
      {
        key: def.key,
        name: def.name,
        category: def.category,
        version: def.version,
        components: def.components as unknown as { construct: never; weight: number }[],
      },
      ALEX_BANDS as never,
    );
    await prisma.compositeScore.create({
      data: {
        attemptId: attempt.id,
        key: result.key,
        name: result.name,
        category: result.category,
        value: result.value,
        band: result.band,
        formulaVersion: result.formulaVersion,
        detail: result.detail as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // Generate the actual report through the production pipeline.
  const { generateReport } = await import("../src/lib/report/generate");
  const reportId = await generateReport(attempt.id);
  console.log(`Alex Sample fixture seeded (attempt ${attempt.id}, report ${reportId}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
