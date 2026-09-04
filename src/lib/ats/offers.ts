/**
 * Offer lifecycle and letter rendering.
 *
 * An offer letter is a legally significant document, so this module supplies
 * the mechanism and the organization supplies the words. Templates are
 * authored by the employer and reviewed by their counsel; nothing here
 * invents contractual language, and the rendered letter is frozen onto the
 * offer when it is sent so that what the candidate saw is what the record
 * shows, whatever happens to the template afterwards.
 */

import type { OfferStatus } from "@prisma/client";

/** Which statuses an offer can legally move to from where it is now. */
const TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "RESCINDED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "RESCINDED"],
  APPROVED: ["SENT", "DRAFT", "RESCINDED"],
  SENT: ["ACCEPTED", "DECLINED", "EXPIRED", "RESCINDED"],
  ACCEPTED: ["RESCINDED"],
  DECLINED: [],
  RESCINDED: [],
  EXPIRED: ["SENT", "RESCINDED"],
};

export function canTransition(from: OfferStatus, to: OfferStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionError(from: OfferStatus, to: OfferStatus): string {
  if (from === to) return "The offer is already in that state.";
  if (from === "ACCEPTED") {
    return "This offer was accepted. Rescinding is the only change left, and it should involve HR.";
  }
  if (from === "DECLINED") return "This offer was declined and cannot be reopened. Create a new offer.";
  if (from === "RESCINDED") return "This offer was rescinded. Create a new offer instead.";
  return `An offer cannot move from ${from.toLowerCase().replace(/_/g, " ")} to ${to.toLowerCase().replace(/_/g, " ")}.`;
}

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved, not sent",
  SENT: "Sent to candidate",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  RESCINDED: "Rescinded",
  EXPIRED: "Expired",
};

export interface OfferMergeContext {
  candidateFirstName: string;
  candidateLastName: string;
  candidateFullName: string;
  candidateEmail: string;
  jobTitle: string;
  departmentName: string;
  locationName: string;
  employmentType: string;
  workArrangement: string;
  baseSalary: string;
  salaryCurrency: string;
  salaryPeriod: string;
  signingBonus: string;
  variablePay: string;
  benefitsSummary: string;
  startDate: string;
  offerExpiryDate: string;
  companyName: string;
  hiringManagerName: string;
  offerReference: string;
  todayDate: string;
}

export type MergeField = keyof OfferMergeContext;

/**
 * Replace {{field}} placeholders.
 *
 * An unknown placeholder is left visibly intact rather than blanked. A letter
 * that silently drops a salary figure is worse than one that visibly says
 * {{baseSalary}} — the first gets sent, the second gets noticed.
 */
export function renderTemplate(
  body: string,
  context: Partial<OfferMergeContext>,
): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) => {
    const value = (context as Record<string, unknown>)[key];
    if (value == null || value === "") return whole;
    return String(value);
  });
}

/** Placeholders in the template that the context cannot fill. */
export function unresolvedFields(
  body: string,
  context: Partial<OfferMergeContext>,
): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const key = m[1];
    const value = (context as Record<string, unknown>)[key];
    if (value == null || value === "") found.add(key);
  }
  return [...found].sort();
}

export function formatMoney(
  amount: number | null | undefined,
  currency: string,
): string {
  if (amount == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Where each merge field is filled in, so a blocker tells the recruiter what
 * to go and do rather than just naming a variable at them.
 */
const FIELD_SOURCE: Partial<Record<MergeField, string>> = {
  hiringManagerName:
    "assign a hiring manager on the requisition's Team tab, or remove the field from the template",
  departmentName: "set a department on the requisition",
  locationName: "set a location on the requisition",
  startDate: "set a start date on this offer",
  offerExpiryDate: "set a response deadline on this offer",
  benefitsSummary: "add a benefits summary to this offer or the requisition",
  variablePay: "add variable pay to this offer, or remove the field from the template",
  signingBonus: "add a signing bonus, or remove the field from the template",
};

export function whereToFill(field: string): string {
  return (
    FIELD_SOURCE[field as MergeField] ??
    "fill this in on the offer, or remove the field from the template"
  );
}

export interface OfferReadiness {
  ready: boolean;
  blockers: string[];
}

/** What has to be true before an offer can be sent to a person. */
export function checkReadyToSend(params: {
  status: OfferStatus;
  approvalsComplete: boolean;
  hasTemplate: boolean;
  unresolved: string[];
  candidateEmail: string | null;
  expiresAt: Date | null;
  now?: Date;
}): OfferReadiness {
  const blockers: string[] = [];
  if (params.status !== "APPROVED") {
    blockers.push("The offer needs to be approved before it goes out.");
  }
  if (!params.approvalsComplete) blockers.push("Approvals are not complete.");
  if (!params.hasTemplate) blockers.push("Choose an offer letter template.");
  if (params.unresolved.length > 0) {
    blockers.push(
      `The letter still has unfilled placeholders. ${params.unresolved
        .map((f) => `${f} — ${whereToFill(f)}`)
        .join("; ")}.`,
    );
  }
  if (!params.candidateEmail) blockers.push("The candidate has no email address on file.");
  if (params.expiresAt && params.expiresAt.getTime() <= (params.now ?? new Date()).getTime()) {
    blockers.push("The response deadline is in the past.");
  }
  return { ready: blockers.length === 0, blockers };
}
