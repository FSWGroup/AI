/**
 * The FCRA adverse-action sequence.
 *
 * A background check that comes back "consider" is not a decision and not a
 * failure — it means a human has to look. If the employer then decides not to
 * hire *because of* the report, federal law requires a specific sequence:
 *
 *   1. Pre-adverse action notice, with a copy of the report and the CFPB's
 *      "A Summary of Your Rights Under the Fair Credit Reporting Act".
 *   2. A reasonable waiting period for the candidate to see it and dispute or
 *      correct it. Five business days is the widely used floor; some
 *      jurisdictions require more.
 *   3. Only then, the adverse action notice.
 *
 * Encoding the sequence as a state machine rather than a checklist is the
 * point: the defence against an FCRA claim is the record of having followed
 * it, and a checklist is something a busy recruiter clicks through.
 *
 * Several jurisdictions add their own rules on top — ban-the-box, individual
 * assessment requirements, longer waits. Those vary too much to hardcode, so
 * the floor is enforced here and the local overlay is a configuration
 * question for counsel.
 */

import type { AdverseActionStage } from "@prisma/client";

/** Business days a candidate gets to respond before adverse action. */
export const MIN_WAIT_BUSINESS_DAYS = 5;

export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export function businessDaysBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let count = 0;
  const cursor = new Date(from.getTime());
  while (cursor.getTime() < to.getTime()) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6 && cursor.getTime() <= to.getTime()) count += 1;
  }
  return count;
}

export interface AdverseActionState {
  stage: AdverseActionStage;
  preAdverseSentAt: Date | null;
  disputeReceivedAt: Date | null;
  adverseActionSentAt: Date | null;
}

export interface AdverseActionGate {
  allowed: boolean;
  reason?: string;
  /** When the wait ends, for a "not before" message. */
  eligibleAt?: Date;
}

/** May a pre-adverse notice be sent right now? */
export function canSendPreAdverse(params: {
  state: AdverseActionState;
  reportResult: string | null;
  reportComplete: boolean;
}): AdverseActionGate {
  if (!params.reportComplete) {
    return { allowed: false, reason: "The report is not complete yet." };
  }
  if (params.reportResult !== "CONSIDER") {
    return {
      allowed: false,
      reason:
        "A pre-adverse notice applies only where the report needs consideration. A clear report is not grounds for one.",
    };
  }
  if (params.state.stage !== "NONE") {
    return {
      allowed: false,
      reason: "A pre-adverse notice has already been sent for this check.",
    };
  }
  return { allowed: true };
}

/**
 * May the final adverse action notice go out?
 *
 * The wait is measured from the pre-adverse notice. A dispute does not stop
 * the clock automatically — but it does mean a person should be looking at
 * the dispute rather than the calendar, which is why it is surfaced.
 */
export function canSendAdverseAction(params: {
  state: AdverseActionState;
  now?: Date;
}): AdverseActionGate {
  const now = params.now ?? new Date();
  const { stage, preAdverseSentAt } = params.state;

  if (stage === "NONE" || !preAdverseSentAt) {
    return {
      allowed: false,
      reason:
        "Send the pre-adverse notice first, with a copy of the report and the summary of rights.",
    };
  }
  if (stage === "ADVERSE_ACTION_SENT") {
    return { allowed: false, reason: "Adverse action has already been taken." };
  }
  if (stage === "CANCELLED") {
    return { allowed: false, reason: "This adverse action process was cancelled." };
  }

  const eligibleAt = addBusinessDays(preAdverseSentAt, MIN_WAIT_BUSINESS_DAYS);
  if (now.getTime() < eligibleAt.getTime()) {
    const elapsed = businessDaysBetween(preAdverseSentAt, now);
    return {
      allowed: false,
      eligibleAt,
      reason: `The candidate has to be given a reasonable chance to dispute. ${elapsed} of ${MIN_WAIT_BUSINESS_DAYS} business days have passed since the pre-adverse notice.`,
    };
  }
  if (stage === "DISPUTED") {
    return {
      allowed: true,
      reason:
        "The candidate disputed this report. The waiting period has passed, but resolve the dispute with Checkr before proceeding.",
      eligibleAt,
    };
  }
  return { allowed: true, eligibleAt };
}

export const STAGE_LABEL: Record<AdverseActionStage, string> = {
  NONE: "No adverse action",
  PRE_ADVERSE_SENT: "Pre-adverse notice sent",
  DISPUTED: "Candidate disputed",
  ADVERSE_ACTION_SENT: "Adverse action taken",
  CANCELLED: "Adverse action cancelled",
};

/**
 * Copy for the two notices. Written to be usable, but the employer's counsel
 * owns the final wording — the required enclosures in particular vary by
 * jurisdiction and are the employer's to attach.
 */
export const PRE_ADVERSE_TEMPLATE = `Dear {{candidateFirstName}},

We are writing about the background check completed for your application for {{jobTitle}} at {{companyName}}.

We are considering not moving forward with your application, based in whole or in part on information in a consumer report prepared by Checkr, Inc.

No decision has been made yet. Enclosed with this notice are:
  • a copy of the report we received, and
  • "A Summary of Your Rights Under the Fair Credit Reporting Act".

If anything in the report is inaccurate or incomplete, you have the right to dispute it directly with Checkr, and to do so free of charge. Their contact details are in the enclosed summary.

Please tell us within {{waitDays}} business days of this notice if you wish to dispute the report or give us further context. We will not make a final decision before then.

{{companyName}}`;

export const ADVERSE_ACTION_TEMPLATE = `Dear {{candidateFirstName}},

Further to our notice of {{preAdverseDate}} regarding your application for {{jobTitle}} at {{companyName}}, we are writing to let you know that we will not be moving forward with your application. This decision was based in whole or in part on information contained in a consumer report.

The report was prepared by:
  Checkr, Inc.
  One Montgomery Street, Suite 2000, San Francisco, CA 94104
  {{checkrPhone}}

Checkr did not make this decision and cannot explain why it was made.

You have the right to obtain a free copy of your report from Checkr within 60 days, and the right to dispute directly with Checkr the accuracy or completeness of any information in it.

{{companyName}}`;
