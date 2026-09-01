import { describe, it, expect } from "vitest";
import {
  canTransition,
  checkReadyToSend,
  renderTemplate,
  unresolvedFields,
  formatMoney,
} from "@/lib/ats/offers";
import {
  buildFunnel,
  medianOf,
  sourcePerformance,
  timeInStages,
  pipelineHealth,
  formatRate,
  MIN_FOR_RATE,
  type StageEventRow,
  type ApplicationRow,
} from "@/lib/ats/analytics";
import { resolveAttribution, trackedApplyUrl, SEED_CHANNELS } from "@/lib/ats/sources";
import { summarizeScorecards, validateSubmission } from "@/lib/ats/scorecards";

describe("offer state machine", () => {
  it("allows the ordinary path through to acceptance", () => {
    expect(canTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "SENT")).toBe(true);
    expect(canTransition("SENT", "ACCEPTED")).toBe(true);
  });

  it("refuses to send an offer that is not approved", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(false);
    expect(canTransition("PENDING_APPROVAL", "SENT")).toBe(false);
  });

  it("treats declined and rescinded as final", () => {
    expect(canTransition("DECLINED", "SENT")).toBe(false);
    expect(canTransition("RESCINDED", "DRAFT")).toBe(false);
  });

  it("allows only rescinding after acceptance", () => {
    expect(canTransition("ACCEPTED", "RESCINDED")).toBe(true);
    expect(canTransition("ACCEPTED", "DECLINED")).toBe(false);
  });

  it("lets an expired offer be re-sent", () => {
    expect(canTransition("EXPIRED", "SENT")).toBe(true);
  });
});

describe("offer letter merge fields", () => {
  const body = "Dear {{candidateFirstName}}, your salary is {{baseSalary}} per {{salaryPeriod}}.";

  it("substitutes values it has", () => {
    expect(
      renderTemplate(body, {
        candidateFirstName: "Maria",
        baseSalary: "₱80,000",
        salaryPeriod: "month",
      }),
    ).toBe("Dear Maria, your salary is ₱80,000 per month.");
  });

  it("leaves an unfilled placeholder visible rather than blanking it", () => {
    // A letter that silently drops the salary would get sent; one that
    // visibly says {{baseSalary}} gets noticed.
    expect(renderTemplate(body, { candidateFirstName: "Maria" })).toContain("{{baseSalary}}");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ candidateFirstName }}", { candidateFirstName: "Ana" })).toBe(
      "Hi Ana",
    );
  });

  it("lists exactly the placeholders that could not be filled", () => {
    expect(unresolvedFields(body, { candidateFirstName: "Maria" })).toEqual([
      "baseSalary",
      "salaryPeriod",
    ]);
  });

  it("treats an empty string as unfilled", () => {
    expect(unresolvedFields("{{signingBonus}}", { signingBonus: "" })).toEqual([
      "signingBonus",
    ]);
  });
});

describe("checkReadyToSend", () => {
  const base = {
    status: "APPROVED" as const,
    approvalsComplete: true,
    hasTemplate: true,
    unresolved: [],
    candidateEmail: "maria@example.com",
    expiresAt: new Date("2030-01-01"),
    now: new Date("2026-01-01"),
  };

  it("passes when everything is in place", () => {
    expect(checkReadyToSend(base).ready).toBe(true);
  });

  it("blocks an unapproved offer", () => {
    const result = checkReadyToSend({ ...base, status: "DRAFT" });
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("approved");
  });

  it("blocks a letter with unfilled placeholders", () => {
    expect(checkReadyToSend({ ...base, unresolved: ["baseSalary"] }).ready).toBe(false);
  });

  it("blocks a deadline already in the past", () => {
    expect(
      checkReadyToSend({ ...base, expiresAt: new Date("2025-01-01") }).ready,
    ).toBe(false);
  });

  it("blocks a candidate with no email", () => {
    expect(checkReadyToSend({ ...base, candidateEmail: null }).ready).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats without stray decimals", () => {
    expect(formatMoney(80000, "PHP")).toMatch(/80,000/);
    expect(formatMoney(null, "PHP")).toBe("");
  });
});

describe("source attribution", () => {
  it("prefers an explicit src over utm and referrer", () => {
    expect(
      resolveAttribution({
        src: "indeed",
        utmSource: "linkedin",
        referrer: "https://www.facebook.com/x",
      }).channelKey,
    ).toBe("indeed");
  });

  it("falls back to utm_source, then the referrer host", () => {
    expect(resolveAttribution({ utmSource: "linkedin" }).channelKey).toBe("linkedin");
    expect(
      resolveAttribution({ referrer: "https://ph.jobstreet.com/job/123" }).channelKey,
    ).toBe("jobstreet_ph");
  });

  it("attributes a direct visit to the careers site", () => {
    expect(resolveAttribution({}).channelKey).toBe("careers_site");
  });

  it("keeps an unrecognized explicit source visible as other", () => {
    // Silently claiming the careers site would overstate its performance.
    expect(resolveAttribution({ src: "some-new-board" }).channelKey).toBe("other");
  });

  it("keeps the raw values for later re-analysis", () => {
    const { detail } = resolveAttribution({
      src: "indeed",
      utmCampaign: "q1-sales",
      referrer: "https://indeed.com",
    });
    expect(detail).toMatchObject({ src: "indeed", utm_campaign: "q1-sales" });
  });

  it("round-trips every channel key it publishes", () => {
    // trackedApplyUrl puts a channel key in ?src=. Any key that fails to
    // resolve back to itself misattributes traffic from our own posting URLs.
    for (const channel of SEED_CHANNELS) {
      const url = new URL(trackedApplyUrl("https://x.test", "REQ-1", channel.key));
      expect(resolveAttribution({ src: url.searchParams.get("src") }).channelKey).toBe(
        channel.key,
      );
    }
  });

  it("builds a tracked apply URL per channel", () => {
    expect(trackedApplyUrl("https://fsw.example", "REQ-1", "indeed")).toBe(
      "https://fsw.example/careers/REQ-1?src=indeed",
    );
  });
});

describe("funnel", () => {
  const stages = [
    { name: "Applied", kind: "APPLIED" as const },
    { name: "Screen", kind: "SCREEN" as const },
    { name: "Interview", kind: "INTERVIEW" as const },
  ];

  function event(applicationId: string, stageName: string, day: number): StageEventRow {
    const stage = stages.find((s) => s.name === stageName)!;
    return {
      applicationId,
      stageName,
      stageKind: stage.kind,
      occurredAt: new Date(2026, 0, day),
    };
  }

  it("counts each application once per stage it reached", () => {
    const events = [
      event("a", "Applied", 1),
      event("a", "Screen", 2),
      event("a", "Applied", 3), // moved back
      event("a", "Screen", 4),
    ];
    const funnel = buildFunnel(stages, events);
    expect(funnel[0].reached).toBe(1);
    expect(funnel[1].reached).toBe(1);
  });

  it("withholds a conversion rate below the reporting floor", () => {
    const events = Array.from({ length: MIN_FOR_RATE - 1 }, (_, i) =>
      event(`a${i}`, "Applied", 1),
    );
    expect(buildFunnel(stages, events)[0].conversionRate).toBeNull();
  });

  it("computes a rate once the sample is large enough", () => {
    const events = [];
    for (let i = 0; i < 20; i++) {
      events.push(event(`a${i}`, "Applied", 1));
      if (i < 5) events.push(event(`a${i}`, "Screen", 2));
    }
    const funnel = buildFunnel(stages, events);
    expect(funnel[0].reached).toBe(20);
    expect(funnel[0].advanced).toBe(5);
    expect(funnel[0].conversionRate).toBeCloseTo(0.25);
  });

  it("does not credit a stage the application skipped past", () => {
    // Straight to interview: the screen's conversion should not count it.
    const events = [event("a", "Applied", 1), event("a", "Interview", 2)];
    const funnel = buildFunnel(stages, events);
    expect(funnel[1].reached).toBe(0);
    expect(funnel[1].advanced).toBe(0);
  });
});

describe("timeInStages", () => {
  it("measures an open stage up to now, so a stalled pipeline looks stalled", () => {
    const events: StageEventRow[] = [
      {
        applicationId: "a",
        stageName: "Screen",
        stageKind: "SCREEN",
        occurredAt: new Date("2026-01-01"),
      },
    ];
    const rows = timeInStages(events, new Date("2026-01-11"));
    expect(rows[0].medianDays).toBeCloseTo(10, 1);
  });

  it("uses the median so one abandoned application does not dominate", () => {
    const events: StageEventRow[] = [];
    for (let i = 0; i < 4; i++) {
      events.push(
        {
          applicationId: `a${i}`,
          stageName: "Screen",
          stageKind: "SCREEN",
          occurredAt: new Date("2026-01-01"),
        },
        {
          applicationId: `a${i}`,
          stageName: "Interview",
          stageKind: "INTERVIEW",
          occurredAt: new Date(i === 3 ? "2026-06-01" : "2026-01-03"),
        },
      );
    }
    const screen = timeInStages(events, new Date("2026-06-02")).find(
      (r) => r.stageName === "Screen",
    );
    expect(screen?.medianDays).toBeCloseTo(2, 1);
  });
});

describe("medianOf", () => {
  it("averages the middle pair on an even count", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([])).toBeNull();
  });
});

describe("sourcePerformance", () => {
  function app(over: Partial<ApplicationRow>): ApplicationRow {
    return {
      id: "a",
      status: "ACTIVE",
      channelKey: "indeed",
      channelName: "Indeed",
      appliedAt: new Date("2026-01-01"),
      hiredAt: null,
      rejectedAt: null,
      ...over,
    };
  }

  it("ranks channels by volume and withholds small-sample rates", () => {
    const rows = sourcePerformance([
      ...Array.from({ length: 12 }, (_, i) => app({ id: `i${i}` })),
      app({ id: "r1", channelKey: "referral", channelName: "Referral", hiredAt: new Date("2026-02-01") }),
    ]);
    expect(rows[0].channelKey).toBe("indeed");
    expect(rows[0].hireRate).toBe(0);
    expect(rows[1].channelKey).toBe("referral");
    expect(rows[1].hireRate).toBeNull();
    expect(rows[1].medianDaysToHire).toBeCloseTo(31, 0);
  });
});

describe("pipelineHealth", () => {
  it("counts applications with no movement for two weeks as stalled", () => {
    const now = new Date("2026-02-01");
    const apps: ApplicationRow[] = [
      {
        id: "fresh",
        status: "ACTIVE",
        channelKey: null,
        channelName: null,
        appliedAt: new Date("2026-01-28"),
        hiredAt: null,
        rejectedAt: null,
      },
      {
        id: "stale",
        status: "ACTIVE",
        channelKey: null,
        channelName: null,
        appliedAt: new Date("2026-01-01"),
        hiredAt: null,
        rejectedAt: null,
      },
    ];
    const activity = new Map([
      ["fresh", new Date("2026-01-28")],
      ["stale", new Date("2026-01-02")],
    ]);
    const health = pipelineHealth(apps, activity, now);
    expect(health.active).toBe(2);
    expect(health.stalled).toBe(1);
  });
});

describe("formatRate", () => {
  it("renders a dash when the rate was withheld", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(0.25)).toBe("25%");
  });
});

describe("scorecards", () => {
  it("flags a split panel rather than averaging it away", () => {
    const summary = summarizeScorecards([
      {
        id: "1",
        authorName: "A",
        status: "SUBMITTED",
        recommendation: "STRONG_YES",
        summary: "s",
        submittedAt: new Date(),
        ratings: [{ competencyName: "Ownership", rating: 4, note: null }],
      },
      {
        id: "2",
        authorName: "B",
        status: "SUBMITTED",
        recommendation: "STRONG_NO",
        summary: "s",
        submittedAt: new Date(),
        ratings: [{ competencyName: "Ownership", rating: 1, note: null }],
      },
    ]);
    expect(summary.panelSplit).toBe(true);
    expect(summary.averageRecommendation).toBe(2.5);
    expect(summary.competencies[0].split).toBe(true);
  });

  it("counts drafts as pending, not as votes", () => {
    const summary = summarizeScorecards([
      {
        id: "1",
        authorName: "A",
        status: "DRAFT",
        recommendation: "YES",
        summary: null,
        submittedAt: null,
        ratings: [],
      },
    ]);
    expect(summary.submittedCount).toBe(0);
    expect(summary.pendingCount).toBe(1);
    expect(summary.averageRecommendation).toBeNull();
  });

  it("requires a recommendation and written evidence to submit", () => {
    const missing = validateSubmission({
      recommendation: null,
      summary: "",
      ratings: [],
      requiredCompetencies: [],
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(" ")).toContain("recommendation");
    expect(missing.errors.join(" ")).toContain("rationale");
  });

  it("requires every competency to be rated or explicitly skipped", () => {
    const result = validateSubmission({
      recommendation: "YES",
      summary: "They gave a specific example of shipping under a deadline.",
      ratings: [{ competencyName: "Ownership", rating: 3 }],
      requiredCompetencies: ["Ownership", "Communication"],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Communication");
  });

  it("accepts a complete scorecard", () => {
    expect(
      validateSubmission({
        recommendation: "YES",
        summary: "They gave a specific example of shipping under a deadline.",
        ratings: [{ competencyName: "Ownership", rating: 3 }],
        requiredCompetencies: ["Ownership"],
      }).ok,
    ).toBe(true);
  });
});
