/**
 * Synthetic validation fixture — for demonstration and testing ONLY.
 *
 * Creates fabricated hires, performance reviews and assessment scores so the
 * validation study engine can be seen working before an organization has
 * accumulated real post-hire data. Every row it writes is marked "DEMO" and
 * the study it creates says in its own name and description that its numbers
 * are not evidence of anything.
 *
 * This exists because the alternative — a feature nobody can see working
 * until two years of hiring have gone by — is worse. But fabricated validity
 * data presented as real is exactly the failure mode this whole subsystem is
 * built to prevent, so:
 *
 *   - it refuses to run against NODE_ENV=production
 *   - it requires --confirm-synthetic on the command line
 *   - everything it creates is named so nobody mistakes it for real
 *
 * Remove the demo data with --purge before using this instance for real work.
 *
 * Usage:
 *   npx tsx scripts/seed-validation-demo.ts --confirm-synthetic
 *   npx tsx scripts/seed-validation-demo.ts --purge
 */

import { PrismaClient, type Construct } from "@prisma/client";
import { resolveDatabaseUrl } from "../src/lib/database-url";
import {
  APTITUDE_CONSTRUCTS,
  BEHAVIORAL_CONSTRUCTS,
} from "../src/content/types";

resolveDatabaseUrl();
const prisma = new PrismaClient();

const DEMO_PREFIX = "DEMO";
const DEMO_EMAIL_DOMAIN = "demo.invalid";
const STUDY_NAME = "DEMO — synthetic data, not evidence";
const CYCLE_NAME = "DEMO 90-day review";

const CRITERIA = [
  "WORK_QUALITY",
  "OUTPUT_VOLUME",
  "RELIABILITY",
  "LEARNING_SPEED",
  "PROBLEM_SOLVING",
  "COMMUNICATION_EFFECTIVENESS",
  "TEAMWORK",
  "INITIATIVE",
  "COMPOSURE",
];

/**
 * Deterministic pseudo-random in [0,1). A fixed seed means running this twice
 * produces the same fixture, so a coefficient that changes between runs is a
 * code change rather than noise.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Box-Muller, for scores that look like scores rather than a uniform slab. */
function normal(rand: () => number, mean: number, sd: number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const CONSTRUCTS: Construct[] = [
  ...APTITUDE_CONSTRUCTS,
  ...BEHAVIORAL_CONSTRUCTS,
];

/**
 * Two dimensions genuinely relate to the fabricated criterion; the rest are
 * noise. That is the realistic shape — and it is the shape that proves the
 * multiple-comparison adjustment is doing its job, because without it several
 * of the fourteen null dimensions would come out "significant".
 */
const TRUE_PREDICTORS: Partial<Record<Construct, number>> = {
  MENTAL_ACUITY: 0.45,
  RELIABILITY_PLACEHOLDER: 0,
  ORGANIZATION: 0.3,
} as Partial<Record<Construct, number>>;

async function purge(): Promise<void> {
  const candidates = await prisma.candidate.findMany({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const ids = candidates.map((c) => c.id);
  await prisma.validationStudy.deleteMany({ where: { name: STUDY_NAME } });
  await prisma.performanceCycle.deleteMany({ where: { name: CYCLE_NAME } });

  // Explicit order. Attempt and Invitation deliberately do not cascade from
  // Candidate — assessment records are not something a stray candidate delete
  // should be able to take with it — so they are removed here by hand.
  // Scores, reviews and ratings do cascade, from Attempt and Hire.
  await prisma.hire.deleteMany({ where: { candidateId: { in: ids } } });
  await prisma.attempt.deleteMany({ where: { candidateId: { in: ids } } });
  // Scorecards and interviews cascade from the application.
  await prisma.application.deleteMany({ where: { candidateId: { in: ids } } });
  await prisma.invitation.deleteMany({ where: { candidateId: { in: ids } } });
  await prisma.candidate.deleteMany({ where: { id: { in: ids } } });
  // Norm tables built while the fixture was loaded, by whatever population
  // label the product happened to give them.
  //
  // Matching on `population: startsWith("DEMO")` never removed a single one:
  // generateNormTables always writes "All assessed applicants" or
  // "Applicants assessed for this job profile", so every table generated
  // through the product survived the purge — still ACTIVE, still banding real
  // candidates against a reference group that had just been deleted as
  // fabricated.
  const fabricated = await prisma.normTable.deleteMany({
    where: {
      OR: [
        { syntheticSampleSize: { gt: 0 } },
        { population: { startsWith: DEMO_PREFIX } },
      ],
    },
  });
  console.log(
    `Purged ${ids.length} demo candidates and their attached records, and ${fabricated.count} norm tables built from them.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refusing to run against a production environment. This script fabricates performance data.",
    );
    process.exit(1);
  }

  if (args.includes("--purge")) {
    await purge();
    return;
  }

  if (!args.includes("--confirm-synthetic")) {
    console.error(
      [
        "This script writes FABRICATED hires, scores and performance ratings.",
        "The validity coefficients it produces are not evidence of anything.",
        "",
        "Re-run with --confirm-synthetic if that is what you want, or --purge to remove it.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const count = Number(args.find((a) => a.startsWith("--n="))?.slice(4) ?? 220);
  const rand = makeRandom(20260902);

  const [jobOpening, version, manager, secondRater, requisition, interviewers] =
    await Promise.all([
      prisma.jobOpening.findFirst({ include: { jobProfile: true } }),
      prisma.assessmentVersion.findFirst({ where: { status: "ACTIVE" } }),
      prisma.user.findFirst({ where: { role: { in: ["HIRING_MANAGER", "SUPER_ADMIN"] } } }),
      prisma.user.findFirst({ where: { role: "HR_ADMIN" } }),
      prisma.requisition.findFirst({
        where: { status: "OPEN" },
        include: { stages: { orderBy: { orderIndex: "asc" } } },
      }),
      prisma.user.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { email: "asc" },
      }),
    ]);
  if (!jobOpening || !version || !manager) {
    console.error("Seed the database first (npm run db:seed): a job opening, an active form and a user are needed.");
    process.exit(1);
  }

  await purge();

  const cycle = await prisma.performanceCycle.create({
    data: {
      name: CYCLE_NAME,
      kind: "DAY_90",
      dueAfterDays: 90,
      criterionKeys: CRITERIA,
      status: "OPEN",
      instructions: "Synthetic demo cycle. These ratings were generated, not observed.",
    },
  });

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const scores = new Map<Construct, number>();
    for (const c of CONSTRUCTS) scores.set(c, Math.max(0, Math.min(100, normal(rand, 50, 15))));

    // The criterion is built from the two true predictors plus a lot of noise,
    // then squashed onto the 1-5 rating scale.
    let latent = 0;
    for (const [construct, weight] of Object.entries(TRUE_PREDICTORS)) {
      const v = scores.get(construct as Construct);
      if (v !== undefined && weight) latent += ((v - 50) / 15) * weight;
    }
    latent += normal(rand, 0, 1);
    const trueRating = Math.max(1, Math.min(5, Math.round(3 + latent)));

    const candidate = await prisma.candidate.create({
      data: {
        firstName: `${DEMO_PREFIX}`,
        lastName: `Employee ${String(i + 1).padStart(3, "0")}`,
        email: `demo.employee.${i + 1}@${DEMO_EMAIL_DOMAIN}`,
        // The flag, not just the domain. Anything computed from these rows —
        // a norm table above all — has to be able to say it was built from
        // people who do not exist, long after the fixture is gone.
        synthetic: true,
      },
    });

    const invitation = await prisma.invitation.create({
      data: {
        candidateId: candidate.id,
        jobOpeningId: jobOpening.id,
        assessmentVersionId: version.id,
        status: "COMPLETED",
        tokenHash: `demo-invite-${candidate.id}`,
        code: `DEMO${String(i + 1).padStart(5, "0")}`,
        expiresAt: new Date(now),
      },
    });

    const attempt = await prisma.attempt.create({
      data: {
        invitationId: invitation.id,
        candidateId: candidate.id,
        jobOpeningId: jobOpening.id,
        assessmentVersionId: version.id,
        recordId: `DEMO-${String(i + 1).padStart(4, "0")}`,
        resumeTokenHash: `demo-resume-${candidate.id}`,
        status: "COMPLETED",
        completedAt: new Date(now - (400 - i) * DAY),
      },
    });

    await prisma.score.createMany({
      data: CONSTRUCTS.map((construct) => {
        const scaled = scores.get(construct) as number;
        return {
          attemptId: attempt.id,
          construct,
          rawScore: Math.round(scaled * 0.4),
          scaledScore: scaled,
          band: Math.max(1, Math.min(9, Math.round(scaled / 11.2))),
          bandType: "PROVISIONAL" as const,
          scoringVersion: "demo",
        };
      }),
    });

    // An application and an interview panel, so the calibration analytics have
    // something to measure. Three interviewers see every candidate: one rates
    // the panel's view, one is deliberately a point more generous, and one is
    // deliberately erratic. A calibration report that cannot find those three
    // is not working.
    let applicationId: string | null = null;
    if (requisition && requisition.stages.length > 0 && interviewers.length >= 3) {
      const hiredStage =
        requisition.stages.find((st) => st.kind === "HIRED") ??
        requisition.stages[requisition.stages.length - 1];
      const interviewAt = new Date(now - (395 - i) * DAY);

      const application = await prisma.application.create({
        data: {
          candidateId: candidate.id,
          requisitionId: requisition.id,
          reference: `DEMO-APP-${String(i + 1).padStart(4, "0")}`,
          stageId: hiredStage.id,
          status: "HIRED",
          hiredAt: new Date(now - (390 - i) * DAY),
          appliedAt: new Date(now - (400 - i) * DAY),
        },
      });
      applicationId = application.id;

      const interview = await prisma.interview.create({
        data: {
          applicationId: application.id,
          stageId: hiredStage.id,
          title: "DEMO panel interview",
          status: "COMPLETED",
          scheduledAt: interviewAt,
        },
      });

      // The panel's honest read of this candidate, on the 1-4 scale.
      const panelCall = Math.max(1, Math.min(4, Math.round(2.5 + latent)));
      const calls: [string, number, number][] = [
        // [userId, recommendation, hours taken to file]
        [interviewers[0].id, panelCall, 1],
        [interviewers[1].id, Math.min(4, panelCall + 1), 2],
        [interviewers[2].id, i % 2 === 0 ? Math.min(4, panelCall + 2) : Math.max(1, panelCall - 2), 90],
      ];
      const NAMES = ["STRONG_NO", "NO", "YES", "STRONG_YES"] as const;
      for (const [userId, value, hours] of calls) {
        await prisma.scorecard.create({
          data: {
            applicationId: application.id,
            interviewId: interview.id,
            authorId: userId,
            status: "SUBMITTED",
            recommendation: NAMES[value - 1],
            summary: "Synthetic demo scorecard.",
            submittedAt: new Date(interviewAt.getTime() + hours * 60 * 60 * 1000),
          },
        });
      }
    }

    const hire = await prisma.hire.create({
      data: {
        candidateId: candidate.id,
        attemptId: attempt.id,
        applicationId,
        jobProfileId: jobOpening.jobProfileId,
        jobTitle: jobOpening.title,
        managerId: manager.id,
        hiredAt: new Date(now - (390 - i) * DAY),
      },
    });

    // Two raters on most people, so criterion reliability is estimable — which
    // is the whole reason the attenuation correction can be offered honestly.
    const raters = [manager.id, ...(secondRater && rand() < 0.7 ? [secondRater.id] : [])];
    for (const raterId of raters) {
      const jitter = Math.round(normal(rand, 0, 0.6));
      const rating = Math.max(1, Math.min(5, trueRating + jitter));
      const review = await prisma.performanceReview.create({
        data: {
          hireId: hire.id,
          cycleId: cycle.id,
          raterId,
          status: "SUBMITTED",
          overallRating: rating,
          wouldRehire: rating >= 3,
          submittedAt: new Date(now - (300 - i) * DAY),
        },
      });
      await prisma.performanceRating.createMany({
        data: CRITERIA.map((criterionKey) => ({
          reviewId: review.id,
          criterionKey,
          value: Math.max(1, Math.min(5, rating + Math.round(normal(rand, 0, 0.5)))),
        })),
      });
    }
  }

  const study = await prisma.validationStudy.create({
    data: {
      name: STUDY_NAME,
      description:
        "Every hire, score and rating behind this study was generated by scripts/seed-validation-demo.ts. It demonstrates the mechanics. It is not evidence about this assessment or any other.",
      jobProfileId: jobOpening.jobProfileId,
      criterionKind: "OVERALL_RATING",
      criterionKeys: [],
      cycleKinds: ["DAY_90"],
    },
  });

  console.log(`Created ${count} demo hires, reviews and scores.`);
  console.log(`Study: ${study.id} — "${STUDY_NAME}"`);
  console.log("Run it from Validation, or purge with --purge.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
