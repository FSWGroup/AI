/**
 * Pipeline stages and the rules for moving an application between them.
 *
 * Two decisions worth stating, because they shape everything downstream:
 *
 * 1. Stages are per-requisition rows, not a global enum. Every role recruits
 *    differently, and a fixed pipeline forces teams to lie about their
 *    process — which then makes the funnel report meaningless.
 *
 * 2. A stage's *kind* is the contract, its *name* is cosmetic. "Phone screen",
 *    "Recruiter chat" and "Intro call" are all SCREEN, so conversion reporting
 *    can compare them across roles even when teams name them differently.
 *
 * Nothing here rejects anybody. Knockouts flag, stages advance, and a human
 * makes every decision that ends a candidacy.
 */

import type { StageKind } from "@prisma/client";

export interface StageTemplate {
  name: string;
  kind: StageKind;
}

/**
 * The default pipeline for a new requisition. Deliberately short: teams add
 * stages they need, and a pipeline that starts long trains everyone to skip
 * stages, which corrupts the data more than a missing stage does.
 */
export const DEFAULT_PIPELINE: StageTemplate[] = [
  { name: "Applied", kind: "APPLIED" },
  { name: "Recruiter screen", kind: "SCREEN" },
  { name: "Assessment", kind: "ASSESSMENT" },
  { name: "Work sample", kind: "WORK_SAMPLE" },
  { name: "Hiring manager interview", kind: "INTERVIEW" },
  { name: "Final interview", kind: "INTERVIEW" },
  { name: "Reference check", kind: "REFERENCE" },
  { name: "Offer", kind: "OFFER" },
  { name: "Hired", kind: "HIRED" },
];

/** Stage kinds that must appear exactly once, at a fixed end of the pipeline. */
export const TERMINAL_KIND: StageKind = "HIRED";
export const ENTRY_KIND: StageKind = "APPLIED";

export interface StageLike {
  id: string;
  name: string;
  kind: StageKind;
  orderIndex: number;
}

export interface StageValidationError {
  message: string;
}

/**
 * A pipeline must start at APPLIED and end at HIRED, with exactly one of
 * each. Without those anchors, "applied" and "hired" counts differ per role
 * and no cross-role funnel can be computed.
 */
export function validatePipeline(stages: StageTemplate[]): StageValidationError[] {
  const errors: StageValidationError[] = [];
  if (stages.length < 2) {
    errors.push({ message: "A pipeline needs at least an entry and a hired stage." });
    return errors;
  }
  const applied = stages.filter((s) => s.kind === ENTRY_KIND);
  const hired = stages.filter((s) => s.kind === TERMINAL_KIND);
  if (applied.length !== 1) {
    errors.push({ message: "A pipeline needs exactly one Applied stage." });
  } else if (stages[0].kind !== ENTRY_KIND) {
    errors.push({ message: "The Applied stage must be first." });
  }
  if (hired.length !== 1) {
    errors.push({ message: "A pipeline needs exactly one Hired stage." });
  } else if (stages[stages.length - 1].kind !== TERMINAL_KIND) {
    errors.push({ message: "The Hired stage must be last." });
  }
  if (stages.some((s) => s.name.trim() === "")) {
    errors.push({ message: "Every stage needs a name." });
  }
  const names = stages.map((s) => s.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    errors.push({ message: "Stage names must be unique within a pipeline." });
  }
  return errors;
}

export type MoveDirection = "FORWARD" | "BACKWARD" | "SAME";

export function moveDirection(from: StageLike | null, to: StageLike): MoveDirection {
  if (!from) return "FORWARD";
  if (to.orderIndex > from.orderIndex) return "FORWARD";
  if (to.orderIndex < from.orderIndex) return "BACKWARD";
  return "SAME";
}

export interface MoveCheck {
  allowed: boolean;
  reason?: string;
  /** Things the caller should do as a consequence of the move. */
  effects: MoveEffect[];
}

export type MoveEffect =
  | { kind: "ISSUE_ASSESSMENT" }
  | { kind: "MARK_HIRED" }
  | { kind: "REQUIRE_OFFER" };

/**
 * Whether an application may move to a stage, and what that move implies.
 *
 * Skipping stages is allowed on purpose: a referral who has already met the
 * hiring manager should not be walked through a screen for the sake of the
 * software. The move is recorded either way, so the funnel shows what really
 * happened rather than what the tool insisted on.
 */
export function checkMove(params: {
  from: StageLike | null;
  to: StageLike;
  applicationStatus: string;
  hasAcceptedOffer: boolean;
}): MoveCheck {
  const { from, to, applicationStatus, hasAcceptedOffer } = params;
  const effects: MoveEffect[] = [];

  if (applicationStatus === "HIRED") {
    return { allowed: false, reason: "This application is already marked hired.", effects };
  }
  if (applicationStatus === "WITHDRAWN") {
    return {
      allowed: false,
      reason: "The candidate withdrew. Reopen the application before moving it.",
      effects,
    };
  }
  if (applicationStatus === "REJECTED") {
    return {
      allowed: false,
      reason: "This application was rejected. Reopen it before moving it.",
      effects,
    };
  }
  if (from && from.id === to.id) {
    return { allowed: false, reason: "The application is already in that stage.", effects };
  }

  // Hired is the one stage the software will not let a human reach by
  // accident: it changes the candidate's status and closes out the offer.
  if (to.kind === "HIRED") {
    if (!hasAcceptedOffer) {
      return {
        allowed: false,
        reason: "Mark someone hired only once they have accepted an offer.",
        effects,
      };
    }
    effects.push({ kind: "MARK_HIRED" });
  }
  if (to.kind === "ASSESSMENT") effects.push({ kind: "ISSUE_ASSESSMENT" });
  if (to.kind === "OFFER") effects.push({ kind: "REQUIRE_OFFER" });

  return { allowed: true, effects };
}

/** Human-readable label for a stage kind, used in reporting headers. */
export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  APPLIED: "Applied",
  SCREEN: "Screen",
  ASSESSMENT: "Assessment",
  WORK_SAMPLE: "Work sample",
  INTERVIEW: "Interview",
  REFERENCE: "Reference",
  OFFER: "Offer",
  HIRED: "Hired",
};
