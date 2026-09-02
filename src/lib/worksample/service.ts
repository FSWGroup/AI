/**
 * Work-sample service: assignment, delivery, grading.
 *
 * The candidate's side works exactly like an assessment section — a
 * single-use token, a server-authoritative clock, autosave — because the
 * fairness properties that matter there matter here for the same reasons.
 * The browser countdown is display only; refreshes and clock changes never
 * add time.
 */

import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/crypto";
import { getStorage } from "@/lib/storage";
import {
  canStart,
  canSubmit,
  fileTypeAllowed,
  validateCandidateSubmission,
  type CriterionLike,
  type GradeLike,
} from "./rubric";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * The label graders see instead of a name.
 *
 * Deliberately carries no initials, no date and no requisition — anything
 * that lets a grader work out who they are looking at is the blind leaking.
 */
export function workSampleReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `WS-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

export function workSampleObjectKey(assignmentId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);
  return `work-samples/${assignmentId}/${Date.now()}-${safe}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export interface AssignResult {
  assignmentId: string;
  reference: string;
  /** The raw token. Exists only in the returned link — never stored. */
  token: string;
  url: string;
}

export async function assignWorkSample(args: {
  workSampleId: string;
  applicationId: string;
  actorId: string;
  baseUrl: string;
}): Promise<AssignResult | { error: string }> {
  const [workSample, application, existing] = await Promise.all([
    prisma.workSample.findUnique({
      where: { id: args.workSampleId },
      include: { criteria: true },
    }),
    prisma.application.findUnique({ where: { id: args.applicationId } }),
    prisma.workSampleAssignment.findUnique({
      where: {
        workSampleId_applicationId: {
          workSampleId: args.workSampleId,
          applicationId: args.applicationId,
        },
      },
    }),
  ]);

  if (!workSample) return { error: "That work sample does not exist." };
  if (!application) return { error: "That application does not exist." };
  if (workSample.status !== "ACTIVE") {
    return {
      error: "That work sample is not active. Activate it before sending it to anyone.",
    };
  }
  if (workSample.criteria.length === 0) {
    return {
      error:
        "That work sample has no rubric. Write the rubric before anyone does the task — a rubric written afterwards is written knowing what the answer looked like.",
    };
  }
  if (existing) {
    return { error: "This candidate already has this work sample." };
  }

  const token = generateToken();
  const reference = workSampleReference();
  const assignment = await prisma.workSampleAssignment.create({
    data: {
      workSampleId: workSample.id,
      applicationId: application.id,
      reference,
      tokenHash: hashToken(token),
      dueAt: new Date(Date.now() + workSample.dueInDays * DAY_MS),
      assignedById: args.actorId,
    },
  });

  await audit({
    userId: args.actorId,
    action: "work_sample.assigned",
    entityType: "WorkSampleAssignment",
    entityId: assignment.id,
    newValue: {
      workSampleId: workSample.id,
      applicationId: application.id,
      reference,
      dueAt: assignment.dueAt,
    },
  });

  return {
    assignmentId: assignment.id,
    reference,
    token,
    url: `${args.baseUrl.replace(/\/$/, "")}/work-sample/${token}`,
  };
}

// ---------------------------------------------------------------------------
// The candidate's side
// ---------------------------------------------------------------------------

export async function loadAssignmentByToken(token: string) {
  return prisma.workSampleAssignment.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      workSample: true,
      application: {
        include: {
          candidate: { select: { firstName: true } },
          requisition: { select: { title: true } },
        },
      },
    },
  });
}

/**
 * Start the clock. Idempotent: a candidate who refreshes gets the deadline
 * that was set the first time, not a fresh one.
 */
export async function startAssignment(
  assignmentId: string,
): Promise<{ ok: true; expiresAt: Date | null } | { ok: false; reason: string }> {
  const assignment = await prisma.workSampleAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { workSample: true },
  });

  if (assignment.startedAt) {
    return { ok: true, expiresAt: assignment.expiresAt };
  }
  const gate = canStart(assignment);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const now = new Date();
  const expiresAt = assignment.workSample.timeLimitMinutes
    ? new Date(now.getTime() + assignment.workSample.timeLimitMinutes * 60_000)
    : null;

  await prisma.workSampleAssignment.update({
    where: { id: assignmentId },
    data: { status: "STARTED", startedAt: now, expiresAt },
  });

  await audit({
    actorLabel: "candidate",
    action: "work_sample.started",
    entityType: "WorkSampleAssignment",
    entityId: assignmentId,
    newValue: { expiresAt },
  });

  return { ok: true, expiresAt };
}

/** Autosave. Never changes status, never touches the clock. */
export async function saveDraft(assignmentId: string, text: string): Promise<void> {
  await prisma.workSampleAssignment.updateMany({
    where: { id: assignmentId, status: "STARTED" },
    data: { draftText: text.slice(0, 200_000) },
  });
}

export async function submitAssignment(args: {
  assignmentId: string;
  text: string | null;
  file: { name: string; mimeType: string; bytes: Buffer } | null;
}): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const assignment = await prisma.workSampleAssignment.findUniqueOrThrow({
    where: { id: args.assignmentId },
    include: { workSample: true },
  });

  const gate = canSubmit(assignment);
  if (!gate.ok) return { ok: false, errors: [gate.reason] };

  const hasFile = args.file !== null || assignment.objectKey !== null;
  const errors = validateCandidateSubmission(
    { text: args.text, hasFile },
    assignment.workSample.submissionKind,
  );
  if (args.file && !fileTypeAllowed(args.file.name, assignment.workSample.allowedFileTypes)) {
    errors.push(
      `That file type is not accepted. This task takes: ${assignment.workSample.allowedFileTypes.join(", ")}.`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  let objectKey = assignment.objectKey;
  if (args.file) {
    objectKey = workSampleObjectKey(assignment.id, args.file.name);
    await getStorage().putObject(objectKey, args.file.bytes, args.file.mimeType);
  }

  await prisma.workSampleAssignment.update({
    where: { id: assignment.id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      submittedText: args.text,
      ...(args.file
        ? {
            objectKey,
            fileName: args.file.name,
            fileMimeType: args.file.mimeType,
            fileSizeBytes: args.file.bytes.length,
          }
        : {}),
    },
  });

  await audit({
    actorLabel: "candidate",
    action: "work_sample.submitted",
    entityType: "WorkSampleAssignment",
    entityId: assignment.id,
    newValue: {
      reference: assignment.reference,
      characters: args.text?.length ?? 0,
      hasFile: objectKey !== null,
    },
  });

  return { ok: true };
}

/**
 * Close assignments whose start window has passed.
 *
 * Nobody is rejected by this. The assignment stops accepting a start; the
 * application stays exactly where it is, and a recruiter decides what that
 * means.
 */
export async function expireOverdueAssignments(): Promise<number> {
  const result = await prisma.workSampleAssignment.updateMany({
    where: { status: "ASSIGNED", dueAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export function toCriterionLike(rows: {
  id: string;
  name: string;
  description: string | null;
  anchors: Prisma.JsonValue;
  weight: number;
  orderIndex: number;
}[]): CriterionLike[] {
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    anchors: (c.anchors as unknown as { level: number; text: string }[]) ?? [],
    weight: c.weight,
    orderIndex: c.orderIndex,
  }));
}

export async function loadGrades(assignmentId: string): Promise<GradeLike[]> {
  const grades = await prisma.workSampleGrade.findMany({
    where: { assignmentId },
    include: { grader: { select: { name: true } }, ratings: true },
  });
  return grades.map((g) => ({
    id: g.id,
    graderId: g.graderId,
    graderName: g.grader.name,
    status: g.status,
    comment: g.comment,
    submittedAt: g.submittedAt,
    reconciled: g.reconciled,
    ratings: g.ratings.map((r) => ({
      criterionId: r.criterionId,
      criterionName: r.criterionName,
      level: r.level,
      note: r.note,
    })),
  }));
}

/**
 * Mark an assignment graded once enough independent grades are in.
 *
 * "Graded" is a state of the submission, not a decision about the person:
 * nothing moves an application, and no score crosses a threshold anywhere.
 */
export async function refreshGradedStatus(assignmentId: string): Promise<void> {
  const assignment = await prisma.workSampleAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { workSample: { select: { requiredGraders: true } } },
  });
  const submitted = await prisma.workSampleGrade.count({
    where: { assignmentId, status: "SUBMITTED" },
  });
  const shouldBeGraded = submitted >= assignment.workSample.requiredGraders;
  const next = shouldBeGraded
    ? "GRADED"
    : assignment.status === "GRADED"
      ? "SUBMITTED"
      : assignment.status;
  if (next !== assignment.status) {
    await prisma.workSampleAssignment.update({
      where: { id: assignmentId },
      data: { status: next },
    });
  }
}
