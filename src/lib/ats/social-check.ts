/**
 * Social media review: rules, copy, and the gates around it.
 *
 * This is a structured human workflow, not a scanner. That is a deliberate
 * choice and worth stating plainly, because the obvious build is the wrong
 * one:
 *
 *  - Scraping the platforms breaches their terms of service.
 *  - Running a language model over someone's posts is the highest-risk
 *    application of one in this whole product. A public profile broadcasts
 *    age, religion, disability, pregnancy, national origin and political
 *    affiliation, and a model trained on the internet will happily infer more.
 *    Research on résumé screening already shows models discriminate on names
 *    alone; a human shown a biased machine judgement tends to adopt it.
 *  - A vendor that returns a "risk score" makes the employer a user of a
 *    consumer report under the FCRA, with the disclosure, authorization and
 *    adverse-action duties that follow.
 *
 * So what this module enforces instead is procedure: consent on the record, a
 * reviewer who is not deciding, findings confined to job-relevant conduct,
 * and the raw browsing kept away from the people making the call.
 */

import type { SocialFindingCategory } from "@prisma/client";

export const CONSENT_STATEMENT_VERSION = "1.0";

/**
 * Shown to the candidate. Written to be understood rather than to be
 * technically sufficient — a consent nobody reads is not consent.
 */
export const CONSENT_STATEMENT = `As part of this hiring process we review publicly visible professional social media for the roles where it is relevant.

Here is exactly how it works:

• It is voluntary. You can decline, and declining is not held against your application.
• You choose which public profiles to share with us. We do not search for accounts you have not given us, and we never ask for passwords or private access.
• A reviewer who is not making the hiring decision looks at what you share.
• They record only specific work-related conduct: threats of violence, harassment or abuse of others, illegal activity, disclosure of an employer's confidential information, statements that contradict your application, or conduct that would create a safety risk in this role.
• They are instructed not to record anything about your age, race, religion, national origin, sex, sexual orientation, gender identity, disability, pregnancy, marital status, political affiliation, or union membership — and none of it may be used in the decision.
• The hiring team sees only the conduct findings, not your profiles.
• If something is recorded, you will be told what it is and given the chance to respond before it counts against you.`;

export interface CategoryDefinition {
  category: SocialFindingCategory;
  label: string;
  /** What qualifies, in conduct terms. */
  definition: string;
  /** The nearest thing that must NOT be recorded under it. */
  notThis: string;
}

/**
 * The only things a reviewer may record. A closed list is the control: an
 * open notes field is where "seemed unprofessional" ends up, and "seemed
 * unprofessional" is where bias lives.
 */
export const FINDING_CATEGORIES: CategoryDefinition[] = [
  {
    category: "VIOLENT_THREATS",
    label: "Threats of violence",
    definition:
      "Credible threats of physical harm toward a person or group.",
    notThis:
      "Strong political opinions, dark humour, or violent content shared as news or commentary.",
  },
  {
    category: "HARASSMENT_OR_ABUSE",
    label: "Harassment or abuse of others",
    definition:
      "Targeting an identifiable person or group with abuse, slurs, or a sustained campaign — behaviour that would breach a workplace harassment policy.",
    notThis:
      "Holding or expressing a belief you disagree with, including religious or political belief. The finding is the conduct toward a person, never the view held.",
  },
  {
    category: "ILLEGAL_ACTIVITY",
    label: "Illegal activity",
    definition:
      "Admission of or evidence of serious criminal conduct relevant to this role.",
    notThis:
      "Arrest without conviction, spent convictions, or lawful activity you disapprove of. Criminal history belongs in a background check with its own legal process, not here.",
  },
  {
    category: "CONFIDENTIALITY_BREACH",
    label: "Breach of confidentiality",
    definition:
      "Publishing an employer's or client's confidential information, customer data, or trade secrets.",
    notThis:
      "Publicly discussing pay, working conditions, or organizing with colleagues — in many jurisdictions that is legally protected activity.",
  },
  {
    category: "MISREPRESENTATION",
    label: "Contradicts the application",
    definition:
      "A public claim that directly conflicts with something material the candidate told us — a role, a date, a credential.",
    notThis:
      "A stale profile, an informal job title, or gaps you have inferred rather than verified.",
  },
  {
    category: "SAFETY_RISK",
    label: "Safety risk for this role",
    definition:
      "Documented conduct that would create a specific safety risk in this particular job.",
    notThis:
      "A general impression of the person. If you cannot name the role-specific risk, it is not this.",
  },
];

/** What a reviewer must not write down, shown on the form itself. */
export const NEVER_RECORD = [
  "Age, or anything suggesting it",
  "Race, ethnicity, or national origin",
  "Religion or religious practice",
  "Sex, sexual orientation, or gender identity",
  "Disability, health, or pregnancy",
  "Marital or family status",
  "Political affiliation or lawful political activity",
  "Union membership or organizing activity",
  "Lawful off-duty conduct with no bearing on the role",
];

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether a social review may even be started.
 *
 * Gated to late stages on purpose. Running one on every applicant means
 * exposing the process to protected characteristics hundreds of times over,
 * for candidates who were never close to an offer — a large risk for no
 * decision-making benefit.
 */
export function canStartCheck(params: {
  applicationStatus: string;
  stageKind: string | null;
  enabled: boolean;
}): GateResult {
  if (!params.enabled) {
    return {
      allowed: false,
      reason:
        "Social media review is switched off for this organization. Turn it on in Settings after reviewing the process with counsel.",
    };
  }
  if (params.applicationStatus !== "ACTIVE") {
    return { allowed: false, reason: "This application is not active." };
  }
  const lateStages = ["OFFER", "REFERENCE", "HIRED"];
  if (!params.stageKind || !lateStages.includes(params.stageKind)) {
    return {
      allowed: false,
      reason:
        "Available from the reference or offer stage onwards. Screening every applicant exposes the process to protected characteristics hundreds of times over for people who were never near an offer.",
    };
  }
  return { allowed: true };
}

/** A reviewer must not also be deciding on the candidate. */
export function canReview(params: {
  reviewerId: string;
  hiringTeamDeciderIds: string[];
}): GateResult {
  if (params.hiringTeamDeciderIds.includes(params.reviewerId)) {
    return {
      allowed: false,
      reason:
        "The reviewer cannot be someone deciding on this candidate. Separating the two is what keeps what they see out of the decision.",
    };
  }
  return { allowed: true };
}

export interface FindingInput {
  category: SocialFindingCategory;
  description: string;
  sourceUrl?: string | null;
}

export interface FindingValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Terms that suggest a finding has drifted into protected territory.
 *
 * A word list cannot police judgement and is not pretending to. It catches
 * the careless case and, more usefully, tells the reviewer at the moment of
 * writing what the boundary is.
 */
const PROTECTED_TERMS =
  /\b(pregnan\w*|disab\w*|wheelchair|muslim|christian|jewish|hindu|buddhist|catholic|church|mosque|synagogue|gay|lesbian|bisexual|transgender|trans\b|queer|lgbt\w*|race|racial|black|white|asian|hispanic|latino|filipino|immigrant|visa status|citizenship|age\b|\d{2} years old|elderly|young|married|divorced|kids|children|maternity|paternity|union|democrat|republican|political party|liberal|conservative)\b/i;

export function validateFinding(input: FindingInput): FindingValidation {
  const errors: string[] = [];
  const text = input.description.trim();

  if (text.length < 20) {
    errors.push(
      "Describe what was actually posted or done, specifically enough that someone else could evaluate it.",
    );
  }
  if (text.length > 2000) {
    errors.push("Keep the description under 2000 characters.");
  }
  const match = PROTECTED_TERMS.exec(text);
  if (match) {
    errors.push(
      `This mentions "${match[0]}", which reads as a protected characteristic. Findings must describe conduct only — rewrite it in terms of what the person did, or discard it.`,
    );
  }
  return { ok: errors.length === 0, errors };
}

export function categoryLabel(category: SocialFindingCategory): string {
  return (
    FINDING_CATEGORIES.find((c) => c.category === category)?.label ?? category
  );
}
