import type { PrismaClient } from "@prisma/client";
import {
  applyPositionRequirements,
  evaluateRulesForAll,
} from "@/lib/services/assignment";
import { markLessonComplete, recordAcknowledgement } from "@/lib/services/completion";
import { assessSkill } from "@/lib/services/skills";
import { buildActor } from "@/lib/auth/scope";

/**
 * Demonstration state.
 *
 * Seeding content and rules is not enough: with no Assignment rows every
 * learner-facing surface (the dashboard, My Training, the transcript,
 * certificates, manager team status, the compliance matrix, every report)
 * renders its empty state, so a fresh install looks like a scaffold and the
 * end-to-end suite has nothing real to assert against.
 *
 * Everything below is produced by calling the same services the running
 * application calls — the rule engine materialises assignments, and completing
 * the required lessons of a course triggers the real completion path, which
 * writes the immutable CompletionRecord, issues a real certificate and awards
 * the course's skills. Nothing here forges an evidence row directly.
 *
 * All of it is demonstration data. It is deliberately spread across states —
 * completed, in progress, overdue, acknowledged — so that every screen shows
 * something truthful about what it does, and it is deterministic so that tests
 * can rely on it.
 */

/** Backdate a timestamp by whole days, so reports have a time spread. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Complete a course the way a learner does: mark every required lesson
 * complete, which auto-finalises the course once the last one lands.
 */
async function completeCourseAsLearner(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const lessons = await prisma.lesson.findMany({
    where: { section: { courseId }, required: true },
    select: { id: true },
    orderBy: [{ section: { order: "asc" } }, { order: "asc" }],
  });
  if (lessons.length === 0) return false;

  for (const lesson of lessons) {
    await markLessonComplete(userId, lesson.id, courseId);
  }

  const record = await prisma.completionRecord.findFirst({
    where: { userId, courseId },
    select: { id: true },
  });
  return Boolean(record);
}

/** Start a course without finishing it, so "Continue" has something to resume. */
async function partiallyCompleteCourse(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
): Promise<number> {
  const lessons = await prisma.lesson.findMany({
    where: { section: { courseId }, required: true },
    select: { id: true },
    orderBy: [{ section: { order: "asc" } }, { order: "asc" }],
  });
  // Leave at least one required lesson outstanding — otherwise the course
  // auto-completes and this stops being an in-progress example.
  const upTo = Math.floor(lessons.length / 2);
  if (upTo === 0) return 0;

  for (const lesson of lessons.slice(0, upTo)) {
    await markLessonComplete(userId, lesson.id, courseId);
  }

  await prisma.assignment.updateMany({
    where: { userId, targetType: "COURSE", courseId, status: "ASSIGNED" },
    data: { status: "IN_PROGRESS", startedAt: daysAgo(3) },
  });

  return upTo;
}

/** Acknowledge the current published version of an SOP. */
async function acknowledgeSop(
  prisma: PrismaClient,
  userId: string,
  sopId: string,
): Promise<boolean> {
  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    select: { title: true, currentVersionId: true },
  });
  if (!sop?.currentVersionId) return false;

  const actor = await buildActor(userId);
  if (!actor) return false;

  const already = await prisma.acknowledgement.findFirst({
    where: { userId, sopVersionId: sop.currentVersionId },
    select: { id: true },
  });
  if (already) return true;

  await recordAcknowledgement(actor, {
    statement: `I have read and understood ${sop.title} and agree to follow it.`,
    sopVersionId: sop.currentVersionId,
    typedSignature: actor.name ?? undefined,
  });

  await prisma.assignment.updateMany({
    where: { userId, targetType: "SOP", sopId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return true;
}

export async function seedDemonstrationState(
  prisma: PrismaClient,
  userIds: Map<string, string>,
  courseIds: Map<string, string>,
  sopIds: Map<string, string>,
): Promise<void> {
  console.log("→ Materialising assignments from the rule engine");

  // 1. Rule-driven assignments, created by the production rule engine so the
  //    "why do I have this?" reason on each card is the real generated one.
  const ruleResult = await evaluateRulesForAll();
  console.log(
    `   ${ruleResult.created} assignment(s) across ${ruleResult.usersProcessed} person(s) from active rules`,
  );

  // 2. Position-based requirements, the other production assignment source.
  let positionCreated = 0;
  const activeUsers = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const user of activeUsers) {
    const { created } = await applyPositionRequirements(user.id);
    positionCreated += created;
  }
  console.log(`   ${positionCreated} assignment(s) from position requirements`);

  console.log("→ Demonstration progress, completions and certificates");

  const learner = userIds.get("jordan.pace@fswelsford.com");
  const warehouse = userIds.get("dev.singh@fswelsford.com");
  const contractor = userIds.get("ph.contractor@fswelsford.com");
  const manager = userIds.get("sales.manager@fswelsford.com");

  let completions = 0;
  let partials = 0;
  let acknowledgements = 0;

  // A recent hire part-way through onboarding: one required course finished, one
  // in progress, one still outstanding, plus an optional course taken by choice.
  const welcomeId = courseIds.get("welcome");
  const cyberId = courseIds.get("cyber");
  const quoteId = courseIds.get("quote-process");

  /*
   * Cybersecurity first, because it is the one the company-wide rule assigns to
   * everyone. Completing an *assigned* course is what populates the Completed
   * view, the compliance roll-up and the manager's team status — finishing only
   * an unassigned course leaves all three empty.
   */
  if (learner && cyberId && (await completeCourseAsLearner(prisma, learner, cyberId))) {
    completions += 1;
  }
  // The welcome course is optional and unassigned: a completion with no
  // assignment behind it, which the transcript still has to render.
  if (learner && welcomeId && (await completeCourseAsLearner(prisma, learner, welcomeId))) {
    completions += 1;
  }
  if (learner && quoteId) {
    partials += (await partiallyCompleteCourse(prisma, learner, quoteId)) > 0 ? 1 : 0;
  }

  // The manager has finished the company-wide course, so team roll-ups are not
  // uniformly red and the manager's own compliance reads as met.
  if (manager && cyberId && (await completeCourseAsLearner(prisma, manager, cyberId))) {
    completions += 1;
  }

  // Warehouse safety completed by the warehouse operative — this is the course
  // that carries a recertification interval, so it also demonstrates an expiry.
  const warehouseCourseId = courseIds.get("warehouse-safety");
  if (warehouse && warehouseCourseId) {
    if (await completeCourseAsLearner(prisma, warehouse, warehouseCourseId)) completions += 1;
  }

  // Acknowledgements: the evidence trail for policy sign-off.
  for (const [userId, sopKey] of [
    // Acceptable Use of Company Technology, Create a Customer Quote, and
    // Receive an Inbound Shipment respectively.
    [contractor, "POL-001"],
    [learner, "SALES-001"],
    [warehouse, "OPS-014"],
  ] as const) {
    if (!userId) continue;
    const sopId = sopIds.get(sopKey);
    if (!sopId) continue;
    if (await acknowledgeSop(prisma, userId, sopId)) acknowledgements += 1;
  }

  console.log(
    `   ${completions} course completion(s), ${partials} in progress, ${acknowledgements} acknowledgement(s)`,
  );

  console.log("→ Demonstration skill assessments, so knowledge risk has a range to show");

  /*
   * Without assessed skills every required skill reads "nobody covers this",
   * which is technically true of a fresh install and useless as a demonstration.
   * These go through the real assessment service, so they produce the same
   * SkillAssessment evidence and notification a manager's sign-off would.
   *
   * The shape is deliberate: exactly one person cleared to the level the
   * Application Engineer role demands on Control Valves — the single point of
   * failure this feature exists to surface — and a pair on Customer Service, one
   * holiday away from being one.
   */
  const admin = userIds.get("admin@fswelsford.com");
  const engineer = userIds.get("kim.harlow@fswelsford.com");

  if (admin && engineer) {
    const assessor = await buildActor(admin);
    const skillByName = new Map(
      (await prisma.skill.findMany({ select: { id: true, name: true } })).map((s) => [s.name, s.id]),
    );

    const assessments: { userId: string | undefined; skill: string; rating: "COMPETENT" | "HIGHLY_COMPETENT" }[] = [
      // The only person cleared on control valves at the level the work needs.
      { userId: engineer, skill: "Control Valves", rating: "HIGHLY_COMPETENT" },
      { userId: engineer, skill: "Valve Fundamentals", rating: "HIGHLY_COMPETENT" },
      // Two on customer service: thin, not absent.
      { userId: learner, skill: "Customer Service", rating: "COMPETENT" },
      { userId: engineer, skill: "Customer Service", rating: "COMPETENT" },
      { userId: warehouse, skill: "Warehouse Receiving", rating: "COMPETENT" },
    ];

    let assessed = 0;
    if (assessor) {
      for (const entry of assessments) {
        const skillId = entry.userId ? skillByName.get(entry.skill) : undefined;
        if (!entry.userId || !skillId) continue;

        const already = await prisma.skillAssessment.findFirst({
          where: { userId: entry.userId, skillId, rating: entry.rating },
          select: { id: true },
        });
        if (already) {
          assessed += 1;
          continue;
        }

        await assessSkill(assessor, {
          userId: entry.userId,
          skillId,
          rating: entry.rating,
          comments: "Demonstration assessment recorded by the seed, not a real sign-off.",
        });
        assessed += 1;
      }
    }
    console.log(`   ${assessed} skill assessment(s) recorded`);
  }

  console.log("→ Spreading due dates so urgency grouping is demonstrable");

  /*
   * 3. A realistic spread of due dates. Without this every assignment shares one
   *    due date, so the overdue / due-soon / later grouping, the compliance
   *    matrix and the reminder job all look identical.
   *
   *    Bucketed per person, not across the whole table: a global index leaves
   *    some people with nothing overdue and others with nothing but, so a
   *    manager's roll-up and any given learner's My Training could each show a
   *    single flat state. Cycling within each person's own list gives everyone
   *    at least one overdue and one due-soon item once they have two or more.
   */
  const outstanding = await prisma.assignment.findMany({
    // OVERDUE is included so a second seed run re-buckets the same rows instead
    // of skipping them, which would let overdue counts grow on every run.
    where: { status: { in: ["ASSIGNED", "IN_PROGRESS", "OVERDUE"] } },
    select: { id: true, userId: true, status: true },
    orderBy: [{ userId: "asc" }, { id: "asc" }],
  });

  const byUser = new Map<string, { id: string; status: string }[]>();
  for (const assignment of outstanding) {
    const list = byUser.get(assignment.userId) ?? [];
    list.push({ id: assignment.id, status: assignment.status });
    byUser.set(assignment.userId, list);
  }

  let overdue = 0;
  let dueSoon = 0;
  for (const assignments of byUser.values()) {
    for (const [index, assignment] of assignments.entries()) {
      const bucket = index % 3;
      if (bucket === 0) {
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: {
            assignedAt: daysAgo(45),
            dueAt: daysAgo(9),
            // Only promote an untouched assignment to OVERDUE. Someone who has
            // started and run late is still IN_PROGRESS — overwriting that
            // would erase the in-progress example from every screen.
            ...(assignment.status === "ASSIGNED" ? { status: "OVERDUE" as const } : {}),
          },
        });
        overdue += 1;
      } else if (bucket === 1) {
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: { assignedAt: daysAgo(20), dueAt: daysFromNow(4) },
        });
        dueSoon += 1;
      } else {
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: { assignedAt: daysAgo(6), dueAt: daysFromNow(21) },
        });
      }
    }
  }

  console.log(`   ${overdue} overdue, ${dueSoon} due within the week`);

  const totals = await prisma.assignment.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log(
    `   assignment totals: ${totals.map((t) => `${t.status}=${t._count._all}`).join(", ")}`,
  );
}
