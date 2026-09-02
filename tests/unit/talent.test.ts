import { describe, expect, it } from "vitest";
import {
  askState,
  canAppearInSearch,
  canContact,
  CONSENT_LAPSE_DAYS,
  CONSENT_REMINDER_DAYS,
  MIN_DAYS_BETWEEN_OUTREACH,
  poolExpiryFrom,
  type ProfileLike,
} from "@/lib/talent/consent";
import {
  findMatches,
  stageRank,
  type MatchCandidate,
  type OpeningLike,
} from "@/lib/talent/matching";

const NOW = new Date("2026-09-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function profile(over: Partial<ProfileLike> = {}): ProfileLike {
  return {
    consentStatus: "OPTED_IN",
    consentAskedAt: new Date(NOW.getTime() - 60 * DAY),
    expiresAt: new Date(NOW.getTime() + 300 * DAY),
    lastContactedAt: null,
    contactCount: 0,
    ...over,
  };
}

describe("canContact", () => {
  it("allows a fresh opt-in", () => {
    expect(canContact(profile(), false, NOW).ok).toBe(true);
  });

  it("refuses someone who was never asked", () => {
    const gate = canContact(profile({ consentStatus: "NOT_ASKED" }), false, NOW);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("not agreement to be kept on file");
  });

  it("treats silence as a refusal, not as agreement", () => {
    const gate = canContact(profile({ consentStatus: "INVITED" }), false, NOW);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("Silence is not agreement");
  });

  it("refuses an opt-out and says it cannot be reversed internally", () => {
    const gate = canContact(profile({ consentStatus: "OPTED_OUT" }), false, NOW);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("only they can");
  });

  it("refuses a suppressed address even when the profile says opted in", () => {
    // The suppression list is the backstop: it outlives the profile, so a
    // re-import cannot quietly undo someone's opt-out.
    const gate = canContact(profile({ consentStatus: "OPTED_IN" }), true, NOW);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("do-not-contact list");
  });

  it("refuses once the agreement has lapsed", () => {
    const gate = canContact(
      profile({ expiresAt: new Date(NOW.getTime() - DAY) }),
      false,
      NOW,
    );
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("lapsed");
  });

  it("limits how often one person is approached", () => {
    const recent = canContact(
      profile({ lastContactedAt: new Date(NOW.getTime() - 5 * DAY) }),
      false,
      NOW,
    );
    expect(recent.ok).toBe(false);
    expect(recent.ok === false && recent.reason).toContain("mailing list");

    const older = canContact(
      profile({
        lastContactedAt: new Date(NOW.getTime() - (MIN_DAYS_BETWEEN_OUTREACH + 1) * DAY),
      }),
      false,
      NOW,
    );
    expect(older.ok).toBe(true);
  });
});

describe("canAppearInSearch", () => {
  it("hides an opt-out and a suppressed address from search entirely", () => {
    expect(canAppearInSearch(profile({ consentStatus: "OPTED_OUT" }), false)).toBe(false);
    expect(canAppearInSearch(profile(), true)).toBe(false);
  });

  it("shows someone who has been asked but not answered", () => {
    // They are visible so a recruiter can see the ask is outstanding. Being
    // visible is not permission to contact them — canContact decides that.
    expect(canAppearInSearch(profile({ consentStatus: "INVITED" }), false)).toBe(true);
  });
});

describe("askState", () => {
  it("is null unless an ask is outstanding", () => {
    expect(askState(profile({ consentStatus: "OPTED_IN" }), NOW)).toBeNull();
  });

  it("moves from fresh to reminder to lapsed", () => {
    const at = (days: number) =>
      askState(
        profile({
          consentStatus: "INVITED",
          consentAskedAt: new Date(NOW.getTime() - days * DAY),
        }),
        NOW,
      );
    expect(at(1)).toBe("FRESH");
    expect(at(CONSENT_REMINDER_DAYS)).toBe("REMIND");
    expect(at(CONSENT_LAPSE_DAYS)).toBe("LAPSED");
  });
});

describe("poolExpiryFrom", () => {
  it("uses the retention policy when there is one", () => {
    expect(poolExpiryFrom(NOW, 90).getTime()).toBe(NOW.getTime() + 90 * DAY);
  });
  it("falls back to a default rather than keeping someone forever", () => {
    expect(poolExpiryFrom(NOW, null).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

// ---------------------------------------------------------------------------

const OPENING: OpeningLike = {
  requisitionId: "req-new",
  title: "Inside Sales Rep",
  jobProfileId: "profile-sales",
  departmentId: "dept-commercial",
  tags: ["outbound", "SaaS"],
};

function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    profileId: "p1",
    candidateId: "c1",
    name: "Ana Cruz",
    tags: [],
    assessed: false,
    applications: [],
    ...over,
  };
}

const application = (over: Partial<MatchCandidate["applications"][0]> = {}) => ({
  requisitionId: "req-old",
  requisitionTitle: "Inside Sales Rep (2025)",
  jobProfileId: "profile-sales",
  departmentId: "dept-commercial",
  furthestStageKind: "INTERVIEW",
  status: "REJECTED",
  rejectionCategory: "PROCESS",
  appliedAt: new Date("2025-06-01T00:00:00Z"),
  ...over,
});

describe("findMatches", () => {
  it("surfaces a near miss on the same role with reasons, not a score", () => {
    const [match] = findMatches(OPENING, [candidate({ applications: [application()] })]);
    expect(match).toBeDefined();
    expect(Object.keys(match)).not.toContain("score");
    const kinds = match.reasons.map((r) => r.kind);
    expect(kinds).toContain("SAME_ROLE_TYPE");
    expect(kinds).toContain("REACHED_LATE_STAGE");
    expect(kinds).toContain("PASSED_OVER_FOR_ANOTHER");
  });

  it("does not surface someone whose only connection is having applied once", () => {
    // "Applied here before" is not a reason to contact anybody.
    const matches = findMatches(OPENING, [
      candidate({
        applications: [
          application({
            jobProfileId: "profile-warehouse",
            furthestStageKind: "SCREEN",
            rejectionCategory: "QUALIFICATIONS",
          }),
        ],
      }),
    ]);
    expect(matches).toHaveLength(0);
  });

  it("surfaces on shared tags alone", () => {
    const matches = findMatches(OPENING, [
      candidate({
        tags: ["SaaS", "night shift"],
        applications: [
          application({ jobProfileId: "profile-warehouse", furthestStageKind: "SCREEN" }),
        ],
      }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedTags).toEqual(["SaaS"]);
  });

  it("matches tags case-insensitively", () => {
    const matches = findMatches(OPENING, [
      candidate({
        tags: ["saas"],
        applications: [
          application({ jobProfileId: "profile-warehouse", furthestStageKind: "APPLIED" }),
        ],
      }),
    ]);
    expect(matches[0].matchedTags).toEqual(["saas"]);
  });

  it("never resurfaces someone for the requisition they are already in", () => {
    const matches = findMatches(OPENING, [
      candidate({ applications: [application({ requisitionId: "req-new" })] }),
    ]);
    expect(matches).toHaveLength(0);
  });

  it("orders by how far a real process took them, not by tag count", () => {
    const finalist = candidate({
      profileId: "finalist",
      candidateId: "finalist",
      name: "Finalist",
      applications: [application({ furthestStageKind: "OFFER" })],
    });
    const tagged = candidate({
      profileId: "tagged",
      candidateId: "tagged",
      name: "Tagged",
      tags: ["outbound", "SaaS"],
      applications: [application({ furthestStageKind: "SCREEN" })],
    });
    const matches = findMatches(OPENING, [tagged, finalist]);
    expect(matches.map((m) => m.name)).toEqual(["Finalist", "Tagged"]);
  });

  it("breaks ties on recency", () => {
    const older = candidate({
      profileId: "older",
      name: "Older",
      applications: [application({ appliedAt: new Date("2024-01-01") })],
    });
    const newer = candidate({
      profileId: "newer",
      name: "Newer",
      applications: [application({ appliedAt: new Date("2026-01-01") })],
    });
    expect(findMatches(OPENING, [older, newer]).map((m) => m.name)).toEqual([
      "Newer",
      "Older",
    ]);
  });

  it("does not call a qualification rejection a near miss", () => {
    const matches = findMatches(OPENING, [
      candidate({
        applications: [application({ rejectionCategory: "QUALIFICATIONS" })],
      }),
    ]);
    expect(matches[0].reasons.map((r) => r.kind)).not.toContain(
      "PASSED_OVER_FOR_ANOTHER",
    );
  });

  it("ranks work samples between the assessment and the interview", () => {
    expect(stageRank("ASSESSMENT")).toBeLessThan(stageRank("WORK_SAMPLE"));
    expect(stageRank("WORK_SAMPLE")).toBeLessThan(stageRank("INTERVIEW"));
    expect(stageRank("nonsense")).toBe(0);
  });
});
