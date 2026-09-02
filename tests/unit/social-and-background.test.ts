import { describe, it, expect } from "vitest";
import {
  canStartCheck,
  canReview,
  validateFinding,
  FINDING_CATEGORIES,
  NEVER_RECORD,
  CONSENT_STATEMENT,
} from "@/lib/ats/social-check";
import {
  addBusinessDays,
  businessDaysBetween,
  canSendPreAdverse,
  canSendAdverseAction,
  MIN_WAIT_BUSINESS_DAYS,
  type AdverseActionState,
} from "@/lib/checkr/adverse-action";
import { verifySignature, readSignature } from "@/lib/checkr/webhook";
import { createHmac } from "node:crypto";

describe("social media review gating", () => {
  const base = { applicationStatus: "ACTIVE", stageKind: "OFFER", enabled: true };

  it("is off unless the organization switched it on", () => {
    const result = canStartCheck({ ...base, enabled: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("counsel");
  });

  it("is unavailable at early stages", () => {
    for (const stageKind of ["APPLIED", "SCREEN", "ASSESSMENT", "INTERVIEW"]) {
      const result = canStartCheck({ ...base, stageKind });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("protected characteristics");
    }
  });

  it("is available from reference and offer stages onward", () => {
    for (const stageKind of ["REFERENCE", "OFFER", "HIRED"]) {
      expect(canStartCheck({ ...base, stageKind }).allowed).toBe(true);
    }
  });

  it("refuses on an application that is not active", () => {
    expect(canStartCheck({ ...base, applicationStatus: "REJECTED" }).allowed).toBe(false);
  });

  it("will not let a decision-maker be the reviewer", () => {
    const result = canReview({
      reviewerId: "hm1",
      hiringTeamDeciderIds: ["hm1", "rec1"],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("out of the decision");
  });

  it("allows someone outside the deciding team to review", () => {
    expect(
      canReview({ reviewerId: "hr9", hiringTeamDeciderIds: ["hm1"] }).allowed,
    ).toBe(true);
  });
});

describe("social media finding validation", () => {
  it("requires a specific description", () => {
    const result = validateFinding({ category: "SAFETY_RISK", description: "bad" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("specifically");
  });

  it("blocks a finding that names a protected characteristic", () => {
    const result = validateFinding({
      category: "HARASSMENT_OR_ABUSE",
      description:
        "Posted repeatedly about being a devout Christian and about his church group.",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("protected characteristic");
  });

  it("blocks age, disability, pregnancy and political references", () => {
    for (const text of [
      "Profile shows he is 58 years old and slowing down considerably in his posts.",
      "Mentions being on maternity leave for most of the last year of work.",
      "Very active in Republican party organizing across several long threads.",
      "Posts frequently about union organizing at their current employer here.",
    ]) {
      expect(
        validateFinding({ category: "MISREPRESENTATION", description: text }).ok,
      ).toBe(false);
    }
  });

  it("accepts a finding written purely as conduct", () => {
    const result = validateFinding({
      category: "CONFIDENTIALITY_BREACH",
      description:
        "Posted a screenshot of an internal pricing sheet naming three named clients and their negotiated rates.",
    });
    expect(result.ok).toBe(true);
  });

  it("offers only closed, conduct-based categories", () => {
    expect(FINDING_CATEGORIES).toHaveLength(6);
    for (const c of FINDING_CATEGORIES) {
      expect(c.definition.length).toBeGreaterThan(20);
      // Every category states what must NOT be recorded under it.
      expect(c.notThis.length).toBeGreaterThan(20);
    }
  });

  it("tells the candidate what will and will not be recorded", () => {
    expect(CONSENT_STATEMENT).toContain("voluntary");
    expect(CONSENT_STATEMENT).toContain("not making the hiring decision");
    expect(CONSENT_STATEMENT).toContain("passwords");
    expect(NEVER_RECORD.length).toBeGreaterThan(5);
  });
});

describe("business day arithmetic", () => {
  it("skips weekends when adding", () => {
    // Friday 2026-01-02 + 5 business days = Friday 2026-01-09.
    const friday = new Date("2026-01-02T12:00:00Z");
    expect(addBusinessDays(friday, 5).toISOString().slice(0, 10)).toBe("2026-01-09");
  });

  it("counts only business days between two dates", () => {
    const friday = new Date("2026-01-02T12:00:00Z");
    const monday = new Date("2026-01-05T12:00:00Z");
    expect(businessDaysBetween(friday, monday)).toBe(1);
    expect(businessDaysBetween(monday, friday)).toBe(0);
  });
});

describe("FCRA pre-adverse gate", () => {
  const state: AdverseActionState = {
    stage: "NONE",
    preAdverseSentAt: null,
    disputeReceivedAt: null,
    adverseActionSentAt: null,
  };

  it("refuses while the report is still running", () => {
    expect(
      canSendPreAdverse({ state, reportResult: "CONSIDER", reportComplete: false })
        .allowed,
    ).toBe(false);
  });

  it("refuses on a clear report", () => {
    const result = canSendPreAdverse({
      state,
      reportResult: "CLEAR",
      reportComplete: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("clear report is not grounds");
  });

  it("allows it on a consider result", () => {
    expect(
      canSendPreAdverse({ state, reportResult: "CONSIDER", reportComplete: true })
        .allowed,
    ).toBe(true);
  });

  it("refuses a second pre-adverse notice", () => {
    expect(
      canSendPreAdverse({
        state: { ...state, stage: "PRE_ADVERSE_SENT" },
        reportResult: "CONSIDER",
        reportComplete: true,
      }).allowed,
    ).toBe(false);
  });
});

describe("FCRA adverse action gate", () => {
  const sentAt = new Date("2026-01-05T10:00:00Z"); // Monday
  const state: AdverseActionState = {
    stage: "PRE_ADVERSE_SENT",
    preAdverseSentAt: sentAt,
    disputeReceivedAt: null,
    adverseActionSentAt: null,
  };

  it("refuses before any pre-adverse notice", () => {
    const result = canSendAdverseAction({
      state: { stage: "NONE", preAdverseSentAt: null, disputeReceivedAt: null, adverseActionSentAt: null },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("pre-adverse notice first");
  });

  it("refuses inside the waiting period and says how far through it is", () => {
    const result = canSendAdverseAction({
      state,
      now: new Date("2026-01-07T10:00:00Z"),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(`of ${MIN_WAIT_BUSINESS_DAYS} business days`);
    expect(result.eligibleAt).toBeInstanceOf(Date);
  });

  it("does not let a weekend shorten the wait", () => {
    // Five calendar days later is Saturday; not yet five business days.
    expect(
      canSendAdverseAction({ state, now: new Date("2026-01-10T10:00:00Z") }).allowed,
    ).toBe(false);
  });

  it("allows it once five business days have passed", () => {
    expect(
      canSendAdverseAction({ state, now: new Date("2026-01-13T10:00:00Z") }).allowed,
    ).toBe(true);
  });

  it("still warns when the candidate disputed", () => {
    const result = canSendAdverseAction({
      state: { ...state, stage: "DISPUTED", disputeReceivedAt: new Date("2026-01-06") },
      now: new Date("2026-01-13T10:00:00Z"),
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("dispute");
  });

  it("refuses to act twice", () => {
    expect(
      canSendAdverseAction({
        state: { ...state, stage: "ADVERSE_ACTION_SENT" },
        now: new Date("2026-02-01"),
      }).allowed,
    ).toBe(false);
  });
});

describe("Checkr webhook signature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ type: "report.completed", data: { object: { id: "r1" } } });

  function sign(payload: string, key = secret): string {
    return createHmac("sha256", key).update(payload, "utf8").digest("hex");
  }

  it("accepts a correctly signed body", () => {
    process.env.CHECKR_WEBHOOK_SECRET = secret;
    expect(verifySignature(body, sign(body))).toBe(true);
  });

  it("rejects a body that was tampered with after signing", () => {
    process.env.CHECKR_WEBHOOK_SECRET = secret;
    const signature = sign(body);
    expect(verifySignature(body.replace("r1", "r2"), signature)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    process.env.CHECKR_WEBHOOK_SECRET = secret;
    expect(verifySignature(body, sign(body, "wrong-secret"))).toBe(false);
  });

  it("rejects a missing signature, and refuses everything with no secret set", () => {
    process.env.CHECKR_WEBHOOK_SECRET = secret;
    expect(verifySignature(body, null)).toBe(false);
    delete process.env.CHECKR_WEBHOOK_SECRET;
    expect(verifySignature(body, sign(body))).toBe(false);
  });

  it("tolerates an algorithm-prefixed signature", () => {
    process.env.CHECKR_WEBHOOK_SECRET = secret;
    expect(verifySignature(body, `sha256=${sign(body)}`)).toBe(true);
  });

  it("reads either documented header spelling", () => {
    expect(
      readSignature(new Headers({ "X-Checkr-Signature": "abc" })),
    ).toBe("abc");
    expect(readSignature(new Headers({ "Checkr-Signature": "def" }))).toBe("def");
    expect(readSignature(new Headers({}))).toBeNull();
  });
});
