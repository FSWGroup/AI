/**
 * Approval chains for requisitions and offers.
 *
 * Both use the same shape: an ordered list of named approvers, each of whom
 * approves or rejects, with only the current step able to act. Sequential
 * rather than parallel, because "everyone approved but nobody read it" is the
 * failure mode approval chains exist to prevent, and because a rejection
 * partway through should stop the ones after it from being asked at all.
 */

import type { ApprovalDecision } from "@prisma/client";

export interface ApprovalStep {
  stepIndex: number;
  approverId: string;
  approverName: string;
  decision: ApprovalDecision;
  comment: string | null;
  decidedAt: Date | string | null;
}

export type ChainState = "NOT_STARTED" | "IN_PROGRESS" | "APPROVED" | "REJECTED";

export interface ChainStatus {
  state: ChainState;
  /** The step waiting on a decision, if any. */
  currentStep: ApprovalStep | null;
  approvedCount: number;
  totalSteps: number;
  rejectedBy: ApprovalStep | null;
}

export function chainStatus(steps: ApprovalStep[]): ChainStatus {
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const rejected = ordered.find((s) => s.decision === "REJECTED") ?? null;
  const approvedCount = ordered.filter((s) => s.decision === "APPROVED").length;

  if (ordered.length === 0) {
    return {
      state: "NOT_STARTED",
      currentStep: null,
      approvedCount: 0,
      totalSteps: 0,
      rejectedBy: null,
    };
  }
  if (rejected) {
    return {
      state: "REJECTED",
      currentStep: null,
      approvedCount,
      totalSteps: ordered.length,
      rejectedBy: rejected,
    };
  }
  const pending = ordered.find(
    (s) => s.decision === "PENDING" || s.decision === "SKIPPED",
  );
  // SKIPPED steps do not block, so find the first genuinely pending one.
  const current = ordered.find((s) => s.decision === "PENDING") ?? null;
  if (!pending || !current) {
    return {
      state: "APPROVED",
      currentStep: null,
      approvedCount,
      totalSteps: ordered.length,
      rejectedBy: null,
    };
  }
  return {
    state: "IN_PROGRESS",
    currentStep: current,
    approvedCount,
    totalSteps: ordered.length,
    rejectedBy: null,
  };
}

export interface DecisionCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether a given user may decide right now. Only the current step's named
 * approver can act — an approver later in the chain cannot pre-approve, and
 * one who already decided cannot decide twice.
 */
export function canDecide(steps: ApprovalStep[], userId: string): DecisionCheck {
  const status = chainStatus(steps);
  if (status.state === "APPROVED") {
    return { allowed: false, reason: "This has already been fully approved." };
  }
  if (status.state === "REJECTED") {
    return {
      allowed: false,
      reason: `Already rejected by ${status.rejectedBy?.approverName ?? "an approver"}.`,
    };
  }
  if (!status.currentStep) {
    return { allowed: false, reason: "There is no approval step waiting." };
  }
  if (status.currentStep.approverId !== userId) {
    return {
      allowed: false,
      reason: `Waiting on ${status.currentStep.approverName}.`,
    };
  }
  return { allowed: true };
}

/** A one-line description of where an approval chain has got to. */
export function describeChain(steps: ApprovalStep[]): string {
  const status = chainStatus(steps);
  switch (status.state) {
    case "NOT_STARTED":
      return "No approvers assigned.";
    case "APPROVED":
      return `Approved by all ${status.totalSteps} approver${status.totalSteps === 1 ? "" : "s"}.`;
    case "REJECTED":
      return `Rejected by ${status.rejectedBy?.approverName ?? "an approver"}.`;
    default:
      return `Step ${(status.currentStep?.stepIndex ?? 0) + 1} of ${status.totalSteps} — waiting on ${status.currentStep?.approverName}.`;
  }
}
