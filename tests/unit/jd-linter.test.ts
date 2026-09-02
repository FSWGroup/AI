import { describe, it, expect } from "vitest";
import { lintJobDescription, readingGrade, type LintInput } from "@/lib/ats/jd-linter";

function jd(over: Partial<LintInput> = {}): LintInput {
  return {
    title: "Inside Sales Representative",
    summary: "Sell technical products to business customers.",
    description:
      "You will own a book of inbound and outbound opportunities. You work with customers who know their problem but not yet the solution, and you help them get there.",
    responsibilities:
      "Qualify inbound enquiries.\nFollow up on outbound campaigns.\nKeep opportunity records current.\nWork with the technical team on quotes.",
    requirements:
      "Comfortable holding a technical conversation.\nOrganized enough to keep a pipeline straight.",
    benefits: "HMO from day one, thirteenth month, hybrid after onboarding.",
    salaryMin: 35000,
    salaryMax: 55000,
    salaryPublish: true,
    locationRegion: "NCR",
    locationCountry: "PH",
    ...over,
  };
}

const kinds = (r: ReturnType<typeof lintJobDescription>) =>
  r.findings.map((f) => f.kind);

describe("clean postings", () => {
  it("passes a well-written posting with few findings", () => {
    const result = lintJobDescription(jd());
    expect(result.counts.HIGH).toBe(0);
    expect(result.score).toBeGreaterThan(80);
  });
});

describe("exclusionary phrasing", () => {
  it("flags gendered pronouns for the role holder", () => {
    const result = lintJobDescription(
      jd({ description: "The successful candidate will manage his own territory and set his own targets each quarter." }),
    );
    expect(kinds(result)).toContain("EXCLUSIONARY_PHRASING");
    expect(result.counts.HIGH).toBeGreaterThan(0);
  });

  it("flags native-speaker requirements as a national-origin proxy", () => {
    const result = lintJobDescription(jd({ requirements: "Native English speaker required for this role." }));
    const finding = result.findings.find((f) => f.match?.toLowerCase().includes("native"));
    expect(finding?.message).toContain("national-origin");
  });

  it("flags culture fit", () => {
    const result = lintJobDescription(jd({ requirements: "Strong culture fit with our close-knit team." }));
    expect(
      result.findings.some((f) => f.message.includes("similarity preference")),
    ).toBe(true);
  });

  it("flags a bare physical requirement", () => {
    const result = lintJobDescription(
      jd({ requirements: "Must be able to lift heavy boxes throughout the shift." }),
    );
    expect(kinds(result)).toContain("EXCLUSIONARY_PHRASING");
  });
});

describe("age signals", () => {
  it("flags recent-graduate and digital-native phrasing", () => {
    for (const text of [
      "Looking for a recent graduate to join a young and vibrant team.",
      "You should be a digital native with high-energy.",
    ]) {
      expect(kinds(lintJobDescription(jd({ description: text })))).toContain("AGE_SIGNAL");
    }
  });

  it("reports an age signal only once per field rather than per word", () => {
    const result = lintJobDescription(
      jd({ description: "A young, energetic, youthful, vibrant, high-energy team." }),
    );
    expect(kinds(result).filter((k) => k === "AGE_SIGNAL")).toHaveLength(1);
  });
});

describe("inflated requirements", () => {
  it("flags a hard degree requirement", () => {
    const result = lintJobDescription(
      jd({ requirements: "Bachelor's degree in business or a related field." }),
    );
    expect(kinds(result)).toContain("INFLATED_REQUIREMENT");
  });

  it("does not flag a degree offered with an equivalence", () => {
    const result = lintJobDescription(
      jd({ requirements: "Bachelor's degree or equivalent practical experience." }),
    );
    expect(kinds(result)).not.toContain("INFLATED_REQUIREMENT");
  });

  it("does not flag a degree marked preferred", () => {
    const result = lintJobDescription(
      jd({ requirements: "Bachelor's degree preferred but not essential." }),
    );
    expect(kinds(result)).not.toContain("INFLATED_REQUIREMENT");
  });

  it("flags long tenure minimums but not short ones", () => {
    expect(
      kinds(lintJobDescription(jd({ requirements: "10+ years of sales experience." }))),
    ).toContain("INFLATED_REQUIREMENT");
    expect(
      kinds(lintJobDescription(jd({ requirements: "2 years of sales experience." }))),
    ).not.toContain("INFLATED_REQUIREMENT");
  });

  it("flags an overlong requirements list", () => {
    const result = lintJobDescription(
      jd({ requirements: Array.from({ length: 14 }, (_, i) => `Requirement number ${i}`).join("\n") }),
    );
    expect(
      result.findings.some((f) => f.message.includes("separate requirements")),
    ).toBe(true);
  });
});

describe("coded language", () => {
  it("flags a heavy masculine skew", () => {
    const result = lintJobDescription(
      jd({
        description:
          "We want an aggressive, competitive, dominant self-starter who is fearless, decisive and determined to crush it. A true rockstar who will battle for every deal.",
      }),
    );
    expect(kinds(result)).toContain("CODED_LANGUAGE");
  });

  it("does not flag balanced wording", () => {
    const result = lintJobDescription(
      jd({
        description:
          "You are ambitious and competitive, and you collaborate well, support your colleagues and communicate honestly with customers. We value people who connect with others and commit to the work.",
      }),
    );
    expect(kinds(result)).not.toContain("CODED_LANGUAGE");
  });
});

describe("pay transparency", () => {
  it("is a high-severity finding in a mandated US state", () => {
    const result = lintJobDescription(
      jd({ salaryPublish: false, locationCountry: "US", locationRegion: "CA" }),
    );
    const finding = result.findings.find((f) => f.kind === "PAY_TRANSPARENCY")!;
    expect(finding.severity).toBe("HIGH");
    expect(finding.message).toContain("CA requires");
  });

  it("is advisory elsewhere rather than silent", () => {
    const result = lintJobDescription(jd({ salaryPublish: false }));
    const finding = result.findings.find((f) => f.kind === "PAY_TRANSPARENCY")!;
    expect(finding.severity).toBe("MEDIUM");
  });

  it("flags a range so wide it reads as evasive", () => {
    const result = lintJobDescription(jd({ salaryMin: 20000, salaryMax: 90000 }));
    expect(
      result.findings.some((f) => f.message.includes("more than double")),
    ).toBe(true);
  });

  it("accepts a sensible published range", () => {
    expect(kinds(lintJobDescription(jd()))).not.toContain("PAY_TRANSPARENCY");
  });
});

describe("structure, length and readability", () => {
  it("flags a missing responsibilities section", () => {
    expect(kinds(lintJobDescription(jd({ responsibilities: null })))).toContain(
      "MISSING_SECTION",
    );
  });

  it("flags a posting that runs long", () => {
    const result = lintJobDescription(
      jd({ description: "word ".repeat(800) }),
    );
    expect(kinds(result)).toContain("LENGTH");
  });

  it("flags dense prose", () => {
    const dense =
      "Notwithstanding the aforementioned considerations regarding organizational infrastructure, the successful candidate shall demonstrate comprehensive familiarity with multifaceted operational methodologies encompassing substantial interdepartmental coordination responsibilities and administrative accountabilities.";
    const result = lintJobDescription(jd({ description: dense }));
    expect(kinds(result)).toContain("READING_LEVEL");
  });

  it("returns no reading grade for text too short to measure", () => {
    expect(readingGrade("Short.")).toBeNull();
  });
});

describe("scoring", () => {
  it("drops the score as findings accumulate", () => {
    const clean = lintJobDescription(jd()).score;
    const bad = lintJobDescription(
      jd({
        description: "The candidate will manage his own young, energetic territory.",
        requirements: "Native English speaker. Bachelor's degree. 10+ years. Expert-level.",
        salaryPublish: false,
        benefits: null,
      }),
    ).score;
    expect(bad).toBeLessThan(clean);
    expect(bad).toBeGreaterThanOrEqual(0);
  });

  it("never returns a score outside 0-100", () => {
    const result = lintJobDescription(
      jd({
        title: "Rockstar ninja guru",
        description: "he she his her native english culture fit work hard play hard ".repeat(20),
        requirements: Array.from({ length: 30 }, () => "Expert-level bachelor's degree 15+ years").join("\n"),
        responsibilities: null,
        benefits: null,
        salaryPublish: false,
      }),
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
