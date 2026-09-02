import { describe, it, expect } from "vitest";
import { getDocumentProxy, extractText } from "unpdf";
import { buildFullReportPdf, type FullReportInput } from "@/lib/report/full-report-pdf";
import type { ReportPayload, ReportDimension } from "@/lib/report/generate";

function dim(over: Partial<ReportDimension>): ReportDimension {
  return {
    construct: "MENTAL_ACUITY",
    name: "Mental Acuity",
    category: "APTITUDE",
    shortDefinition: "What this measures.",
    lowDescriptor: "Deliberate",
    highDescriptor: "Quick",
    band: 6,
    bandType: "PROVISIONAL",
    bandLabel: "High average",
    benchmark: { min: 5, max: 7, required: true },
    position: "WITHIN",
    deviation: 0,
    narrative: "Narrative for this dimension.",
    rangeNarrative: "Range narrative.",
    ...over,
  } as ReportDimension;
}

function payload(over: Partial<ReportPayload> = {}): ReportPayload {
  return {
    meta: {
      candidateName: "Alex Sample",
      position: "Inside Sales",
      company: "FSW Group",
      completedAt: "2026-01-05T10:00:00.000Z",
      assessmentVersionName: "Talent Scout v1",
      scoringVersion: "1.0",
      narrativeVersion: "1.0",
      reportVersion: 1,
      attemptNumber: 1,
      recordId: "FW-1234-AB",
      bandTypeNote: "All scores are provisional internal bands.",
    },
    executiveSummary: {
      strongestAlignment: [
        { construct: "MENTAL_ACUITY", name: "Mental Acuity", band: 6 },
      ],
      investigate: [
        { construct: "ORGANIZATION", name: "Organization", reason: "Below range." },
      ],
      responseQuality: "Indicators fall in the typical range.",
      disclaimer: "FSW Talent Scout is decision-support software.",
    },
    dimensions: [
      dim({}),
      dim({
        construct: "ORGANIZATION",
        name: "Organization",
        category: "BEHAVIORAL",
        band: 3,
        position: "BELOW",
      }),
    ],
    validity: [
      {
        construct: "DISTORTION",
        name: "Distortion",
        band: 5,
        level: "NORMAL",
        narrative: "Typical impression management.",
        detail: {},
      },
    ],
    concerns: [
      { construct: "ORGANIZATION", name: "Organization", band: 3, label: "Attention" },
    ],
    salesTraits: {
      composites: [
        {
          key: "drive",
          name: "Drive",
          band: 6,
          value: 62,
          classification: "ALIGNED",
          classificationLabel: "Aligned",
          components: [{ construct: "ENERGY", weight: 1, band: 6 }],
        },
      ],
      overall: "ALIGNED",
      overallLabel: "Generally aligned",
      strengths: ["Sustained activity."],
      exploration: ["Follow-through."],
    },
    leadership: null,
    interviewGuide: [
      {
        construct: "ORGANIZATION",
        name: "Organization",
        focus: "Structure",
        reason: "Below range.",
        measures: "Planning.",
        questions: [
          {
            question: "Tell me about tracking several commitments.",
            altWording: "Describe juggling obligations.",
            listenFor: "A real system.",
          },
        ],
      },
    ],
    development: [
      {
        construct: "ORGANIZATION",
        name: "Organization",
        recommendations: ["Keep one task list."],
      },
    ],
    integrity: {
      level: "NO_NOTABLE_EVENTS",
      label: "No notable events",
      weightedScore: 0,
      notableCounts: [],
      reviewReminder: "Review only for assessment-integrity concerns.",
    },
    ...over,
  } as ReportPayload;
}

function input(over: Partial<FullReportInput> = {}): FullReportInput {
  return {
    payload: payload(),
    candidate: { email: "alex@example.invalid", phone: null },
    invitedAt: "2026-01-01T10:00:00.000Z",
    startedAt: "2026-01-05T09:00:00.000Z",
    sections: [
      {
        sectionKey: "MENTAL_ACUITY",
        status: "COMPLETED",
        startedAt: "2026-01-05T09:00:00.000Z",
        completedAt: "2026-01-05T09:11:00.000Z",
        timed: true,
        durationSeconds: 660,
      },
    ],
    accommodations: [],
    consents: [
      {
        consentType: "rules",
        noticeVersion: "1.0",
        consentedAt: "2026-01-05T09:00:00.000Z",
      },
    ],
    integrityEvents: [
      {
        type: "SECTION_STARTED",
        occurredAt: "2026-01-05T09:00:00.000Z",
        meta: { sectionKey: "MENTAL_ACUITY" },
      },
      { type: "CAMERA_STARTED", occurredAt: "2026-01-05T09:00:00.000Z", meta: {} },
    ],
    integrityLevel: "NO_NOTABLE_EVENTS",
    integrityLabel: "No notable events",
    aiBrief: null,
    exportedBy: "Harper Reyes",
    exportedAt: new Date("2026-01-06T12:00:00.000Z"),
    ...over,
  };
}

async function textOf(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return { pages: doc.numPages, text };
}

describe("buildFullReportPdf", () => {
  it("produces a multi-page PDF that opens", async () => {
    const bytes = await buildFullReportPdf(input());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const { pages } = await textOf(bytes);
    expect(pages).toBeGreaterThan(5);
  });

  it("leads with the summary and the results, before the detail", async () => {
    const { text } = await textOf(await buildFullReportPdf(input()));
    const summary = text.indexOf("Executive summary");
    const results = text.indexOf("Results at a glance");
    const detail = text.indexOf("Mental aptitudes in detail");
    const integrity = text.indexOf("Session integrity log");
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(results);
    expect(results).toBeLessThan(detail);
    expect(detail).toBeLessThan(integrity);
  });

  it("includes every part of the record", async () => {
    const { text } = await textOf(await buildFullReportPdf(input()));
    for (const expected of [
      "Alex Sample",
      "Inside Sales",
      "FW-1234-AB",
      "Narrative for this dimension.",
      "Typical impression management.",
      "Generally aligned",
      "Tell me about tracking several commitments.",
      "Keep one task list.",
      "alex@example.invalid",
      "No notable events",
      "How to read this report",
      "Harper Reyes",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("numbers the contents against the pages sections actually start on", async () => {
    const bytes = await buildFullReportPdf(input());
    const doc = await getDocumentProxy(bytes);
    const { text: pageTexts } = await extractText(doc);
    const contents = pageTexts[1];
    expect(contents).toContain("Contents");
    // Every entry's page number must land on a page that carries its title.
    const entries = [...contents.matchAll(/(\d+)\.\s(.+?)\s(\d+)\s/g)];
    expect(entries.length).toBeGreaterThan(5);
    for (const [, , title, pageStr] of entries) {
      const target = pageTexts[Number(pageStr) - 1] ?? "";
      expect(target).toContain(title.trim());
    }
  });

  it("carries a confidentiality notice and the exporter's identity", async () => {
    const { text } = await textOf(await buildFullReportPdf(input()));
    expect(text).toContain("Confidential");
    // The cover stamps it in caps; the closing section repeats it in prose.
    expect(text.toLowerCase()).toContain("exported by");
    expect(text).toContain("Harper Reyes");
    expect(text.toLowerCase()).toContain("do not distribute externally");
  });

  it("never recommends an employment outcome", async () => {
    const { text } = await textOf(await buildFullReportPdf(input()));
    for (const banned of [
      "recommend hiring",
      "do not hire",
      "recommended for hire",
      "not recommended",
      "overall fit score",
      "pass/fail",
    ]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
    expect(text).toContain("should never be the sole basis");
  });

  it("omits optional sections cleanly when the data is absent", async () => {
    const { text } = await textOf(
      await buildFullReportPdf(
        input({
          payload: payload({
            salesTraits: null,
            leadership: null,
            concerns: [],
            development: [],
            interviewGuide: [],
          }),
        }),
      ),
    );
    expect(text).not.toContain("Sales traits analysis");
    expect(text).not.toContain("Development suggestions");
    expect(text).not.toContain("Targeted interview guide");
    // The mandatory spine is still there.
    expect(text).toContain("Executive summary");
    expect(text).toContain("Results at a glance");
    expect(text).toContain("Session integrity log");
  });

  it("labels the AI brief as machine-generated when one is included", async () => {
    const { text } = await textOf(
      await buildFullReportPdf(
        input({
          aiBrief: {
            model: "claude-test",
            generatedAt: "2026-01-06T09:00:00.000Z",
            hadResume: true,
            analysis: {
              roleContext: "The role demands follow-through.",
              assessmentHighlights: [
                {
                  dimension: "Organization",
                  observation: "Below the range for this role.",
                  relevance: "watch_area",
                },
              ],
              resumeCorroboration: [],
              experienceGaps: [],
              interviewQuestions: [
                {
                  theme: "Structure",
                  question: "How do you track commitments?",
                  whyThisQuestion: "Organization is below range.",
                  listenFor: "A durable system.",
                  followUp: "What happens when it slips?",
                },
              ],
              referenceCheckPrompts: [],
              onboardingConsiderations: [],
              cautions: [],
            },
          },
        }),
      ),
    );
    expect(text).toContain("AI interview brief");
    expect(text).toContain("Generated by a language model");
    expect(text).toContain("How do you track commitments?");
    expect(text).toContain("identifying details were removed");
  });

  it("renders long unbroken content without throwing", async () => {
    const bytes = await buildFullReportPdf(
      input({
        payload: payload({
          dimensions: [
            dim({ narrative: "x".repeat(3000), shortDefinition: "y".repeat(900) }),
          ],
        }),
      }),
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("survives content containing characters outside the font", async () => {
    const bytes = await buildFullReportPdf(
      input({
        payload: payload({
          meta: {
            ...payload().meta,
            candidateName: "Zoë 中文 \u{1F600} O'Brien",
          },
        }),
        exportedBy: "Ünïcode Tester ✓",
      }),
    );
    const { text } = await textOf(bytes);
    expect(text).toContain("O'Brien");
  });
});
