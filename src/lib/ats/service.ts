/**
 * Recruiting service layer: the transactional operations behind the routes.
 *
 * Anything that changes an application's fate lives here rather than in a
 * route handler, because these operations have to be atomic and have to leave
 * a trail. A stage move that writes the application but not the history event
 * silently corrupts every funnel report afterwards.
 */

import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_PIPELINE, checkMove, type StageLike } from "./stages";
import { evaluateKnockouts, summarizeKnockout, type ScreeningQuestionRule, type SubmittedAnswer } from "./screening";
import { findDuplicates } from "./dedupe";
import { resolveAttribution, type AttributionInput } from "./sources";
import { reference } from "@/lib/crypto";

export function requisitionReference(): string {
  return reference("REQ");
}

export function applicationReference(): string {
  return reference("APP");
}

export function offerReference(): string {
  return reference("OFF");
}

/** Create the default pipeline for a new requisition. */
export async function seedPipeline(
  tx: Prisma.TransactionClient,
  requisitionId: string,
): Promise<void> {
  await tx.pipelineStage.createMany({
    data: DEFAULT_PIPELINE.map((s, i) => ({
      requisitionId,
      name: s.name,
      kind: s.kind,
      orderIndex: i,
    })),
  });
}

export async function logRequisitionEvent(
  tx: Prisma.TransactionClient,
  params: {
    requisitionId: string;
    type: string;
    summary: string;
    actorId?: string | null;
    meta?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.requisitionEvent.create({
    data: {
      requisitionId: params.requisitionId,
      type: params.type,
      summary: params.summary,
      actorId: params.actorId ?? null,
      meta: params.meta,
    },
  });
}

export interface CreateApplicationInput {
  requisitionId: string;
  candidate: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
  };
  answers?: SubmittedAnswer[];
  attribution?: AttributionInput;
  /** Set when the application arrived through an authenticated channel. */
  channelKeyOverride?: string | null;
  referredById?: string | null;
  /** Raw inbound row this came from, for traceability. */
  inboundId?: string | null;
}

export interface CreateApplicationResult {
  applicationId: string;
  candidateId: string;
  reference: string;
  /** True when the person already had an application to this requisition. */
  duplicateApplication: boolean;
  knockedOut: boolean;
  /** Other candidate records that may be the same person. */
  possibleDuplicates: { candidateId: string; strength: string; reasons: string[] }[];
}

/**
 * Create (or recognize) a candidate and their application.
 *
 * Re-applying to the same requisition does not create a second application
 * and does not reset anyone's progress; it refreshes the activity timestamp
 * and returns the existing one. A candidate who clicks apply twice should not
 * end up as two rows in a recruiter's queue.
 */
export async function createApplication(
  input: CreateApplicationInput,
): Promise<CreateApplicationResult> {
  const email = input.candidate.email.trim().toLowerCase();

  const [requisition, channels, questions] = await Promise.all([
    prisma.requisition.findUniqueOrThrow({
      where: { id: input.requisitionId },
      include: { stages: { orderBy: { orderIndex: "asc" } } },
    }),
    prisma.sourceChannel.findMany({ where: { active: true } }),
    prisma.screeningQuestion.findMany({
      where: { requisitionId: input.requisitionId },
      orderBy: { orderIndex: "asc" },
    }),
  ]);

  const attribution = resolveAttribution(input.attribution ?? {});
  const channelKey = input.channelKeyOverride ?? attribution.channelKey;
  const channel =
    channels.find((c) => c.key === channelKey) ??
    channels.find((c) => c.key === "other") ??
    null;

  const rules: ScreeningQuestionRule[] = questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    kind: q.kind,
    required: q.required,
    choices: q.choices,
    knockout: q.knockout,
    knockoutOperator: q.knockoutOperator,
    knockoutValue: q.knockoutValue,
  }));
  const knockout = evaluateKnockouts(rules, input.answers ?? []);

  // Duplicate suggestions are computed against everyone, not just applicants
  // to this role — the same person may be in the system from another opening.
  const pool = await prisma.candidate.findMany({
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });
  const duplicates = findDuplicates(
    { ...input.candidate, email, phone: input.candidate.phone ?? null },
    pool,
  );
  const exact = duplicates.find((d) => d.strength === "EXACT");

  const entryStage =
    requisition.stages.find((s) => s.kind === "APPLIED") ?? requisition.stages[0] ?? null;

  return prisma.$transaction(async (tx) => {
    let candidate;
    if (exact) {
      candidate = await tx.candidate.findUniqueOrThrow({
        where: { id: exact.candidateId },
      });
      // Fill a blank from the new application, but never overwrite a value a
      // recruiter may have corrected by hand.
      const phone = input.candidate.phone?.trim();
      if (phone && !candidate.phone) {
        candidate = await tx.candidate.update({
          where: { id: candidate.id },
          data: { phone },
        });
      }
    } else {
      candidate = await tx.candidate.create({
        data: {
          firstName: input.candidate.firstName.trim(),
          lastName: input.candidate.lastName.trim(),
          email,
          phone: input.candidate.phone?.trim() || null,
        },
      });
    }

    const existing = await tx.application.findUnique({
      where: {
        candidateId_requisitionId: {
          candidateId: candidate.id,
          requisitionId: input.requisitionId,
        },
      },
    });
    if (existing) {
      await tx.application.update({
        where: { id: existing.id },
        data: { lastActivityAt: new Date() },
      });
      return {
        applicationId: existing.id,
        candidateId: candidate.id,
        reference: existing.reference,
        duplicateApplication: true,
        knockedOut: existing.knockedOut,
        possibleDuplicates: [],
      };
    }

    const application = await tx.application.create({
      data: {
        reference: applicationReference(),
        candidateId: candidate.id,
        requisitionId: input.requisitionId,
        stageId: entryStage?.id ?? null,
        channelId: channel?.id ?? null,
        sourceDetail: attribution.detail as Prisma.InputJsonValue,
        referredById: input.referredById ?? null,
        knockedOut: knockout.knockedOut,
        knockoutReason: summarizeKnockout(knockout),
      },
    });

    if (input.answers && input.answers.length > 0) {
      const byId = new Map(questions.map((q) => [q.id, q]));
      const rows = input.answers
        .filter((a) => byId.has(a.questionId))
        .map((a) => ({
          applicationId: application.id,
          questionId: a.questionId,
          promptSnapshot: byId.get(a.questionId)!.prompt,
          valueText: a.text ?? null,
          valueNumber: a.number ?? null,
          valueList: a.list ?? [],
        }));
      if (rows.length > 0) await tx.screeningAnswer.createMany({ data: rows });
    }

    if (entryStage) {
      await tx.applicationStageEvent.create({
        data: {
          applicationId: application.id,
          stageId: entryStage.id,
          stageName: entryStage.name,
          stageKind: entryStage.kind,
          actorLabel: "SYSTEM",
          note: "Application received",
        },
      });
    }

    await logRequisitionEvent(tx, {
      requisitionId: input.requisitionId,
      type: "APPLICATION_RECEIVED",
      summary: `${input.candidate.firstName} ${input.candidate.lastName} applied via ${channel?.name ?? "an unknown source"}.`,
      meta: { applicationId: application.id, knockedOut: knockout.knockedOut },
    });

    if (input.inboundId) {
      await tx.inboundApplication.update({
        where: { id: input.inboundId },
        data: {
          status: "PROCESSED",
          applicationId: application.id,
          candidateId: candidate.id,
          processedAt: new Date(),
        },
      });
    }

    return {
      applicationId: application.id,
      candidateId: candidate.id,
      reference: application.reference,
      duplicateApplication: false,
      knockedOut: knockout.knockedOut,
      possibleDuplicates: duplicates
        .filter((d) => d.strength !== "EXACT" && d.candidateId !== candidate.id)
        .slice(0, 5)
        .map((d) => ({
          candidateId: d.candidateId,
          strength: d.strength,
          reasons: d.reasons,
        })),
    };
  });
}

export interface MoveStageResult {
  ok: boolean;
  error?: string;
  effects: string[];
}

/** Move an application to a stage, recording history and any consequences. */
export async function moveApplicationStage(params: {
  applicationId: string;
  toStageId: string;
  actorId: string;
  note?: string | null;
}): Promise<MoveStageResult> {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: params.applicationId },
    include: {
      stage: true,
      offers: { select: { status: true } },
      requisition: { select: { id: true } },
    },
  });
  const to = await prisma.pipelineStage.findUniqueOrThrow({
    where: { id: params.toStageId },
  });
  if (to.requisitionId !== application.requisitionId) {
    return { ok: false, error: "That stage belongs to a different requisition.", effects: [] };
  }

  const from: StageLike | null = application.stage
    ? {
        id: application.stage.id,
        name: application.stage.name,
        kind: application.stage.kind,
        orderIndex: application.stage.orderIndex,
      }
    : null;

  const check = checkMove({
    from,
    to: { id: to.id, name: to.name, kind: to.kind, orderIndex: to.orderIndex },
    applicationStatus: application.status,
    hasAcceptedOffer: application.offers.some((o) => o.status === "ACCEPTED"),
  });
  if (!check.allowed) return { ok: false, error: check.reason, effects: [] };

  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: application.id },
      data: {
        stageId: to.id,
        lastActivityAt: new Date(),
        ...(check.effects.some((e) => e.kind === "MARK_HIRED")
          ? { status: "HIRED" as const, hiredAt: new Date() }
          : {}),
      },
    });
    await tx.applicationStageEvent.create({
      data: {
        applicationId: application.id,
        stageId: to.id,
        stageName: to.name,
        stageKind: to.kind,
        fromStageName: from?.name ?? null,
        actorId: params.actorId,
        note: params.note ?? null,
      },
    });
    await logRequisitionEvent(tx, {
      requisitionId: application.requisitionId,
      type: "STAGE_MOVED",
      summary: `Application ${application.reference} moved to ${to.name}.`,
      actorId: params.actorId,
      meta: { applicationId: application.id, stage: to.name },
    });
  });

  return { ok: true, effects: check.effects.map((e) => e.kind) };
}

/** Reject an application. Always a human decision, always with a reason. */
export async function rejectApplication(params: {
  applicationId: string;
  reasonId: string | null;
  note: string | null;
  actorId: string;
}): Promise<void> {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: params.applicationId },
    select: { id: true, reference: true, requisitionId: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: params.applicationId },
      data: {
        status: "REJECTED",
        rejectionReasonId: params.reasonId,
        rejectionNote: params.note,
        rejectedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    await logRequisitionEvent(tx, {
      requisitionId: application.requisitionId,
      type: "APPLICATION_REJECTED",
      summary: `Application ${application.reference} was rejected.`,
      actorId: params.actorId,
      meta: { applicationId: params.applicationId },
    });
  });
}

/** Put a rejected or withdrawn application back into the pipeline. */
export async function reopenApplication(params: {
  applicationId: string;
  actorId: string;
}): Promise<void> {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: params.applicationId },
    select: { id: true, reference: true, requisitionId: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: params.applicationId },
      data: {
        status: "ACTIVE",
        rejectionReasonId: null,
        rejectionNote: null,
        rejectedAt: null,
        withdrawnAt: null,
        lastActivityAt: new Date(),
      },
    });
    await logRequisitionEvent(tx, {
      requisitionId: application.requisitionId,
      type: "APPLICATION_REOPENED",
      summary: `Application ${application.reference} was reopened.`,
      actorId: params.actorId,
    });
  });
}
