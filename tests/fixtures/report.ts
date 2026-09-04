/**
 * Report fixtures shared by the three suites that build something from a
 * ReportPayload: the candidate feedback sheet, the manager brief, and the full
 * PDF.
 *
 * A ReportPayload has around a dozen top-level sections, and a test for one of
 * them still has to supply all of the others. Written out per file, the three
 * copies had already drifted — different record ids, different default bands —
 * for no reason any assertion depended on.
 *
 * The defaults here are deliberately the EMPTY report: no benchmark, no
 * position, no narrative, nothing notable. Each suite layers its own defaults
 * on top and each test overrides from there, so what a test actually depends
 * on is the part you can see at the call site.
 */

import type { ReportPayload, ReportDimension } from "@/lib/report/generate";

export const REPORT_META: ReportPayload["meta"] = {
  candidateName: "Alex Sample",
  position: "Inside Sales",
  company: "FSW Group",
  completedAt: "2026-01-01T00:00:00.000Z",
  assessmentVersionName: "Talent Scout v1",
  scoringVersion: "1.0",
  narrativeVersion: "1.0",
  reportVersion: 1,
  attemptNumber: 1,
  recordId: "FSW-1",
  bandTypeNote: "Provisional bands.",
};

export const EMPTY_SUMMARY: ReportPayload["executiveSummary"] = {
  strongestAlignment: [],
  investigate: [],
  responseQuality: "Typical range.",
  disclaimer: "Decision support only.",
};

/** One scored dimension: unbenchmarked and mid-band unless a test says so. */
export function reportDimension(
  over: Partial<ReportDimension> = {},
): ReportDimension {
  return {
    construct: "MENTAL_ACUITY",
    name: "Mental Acuity",
    category: "APTITUDE",
    shortDefinition: "",
    lowDescriptor: "Deliberate",
    highDescriptor: "Quick",
    band: 5,
    bandType: "PROVISIONAL",
    bandLabel: "Mid",
    benchmark: null,
    position: null,
    deviation: 0,
    narrative: "",
    rangeNarrative: null,
    ...over,
  } as ReportDimension;
}

/** A complete but empty report. */
export function reportPayload(over: Partial<ReportPayload> = {}): ReportPayload {
  return {
    meta: REPORT_META,
    executiveSummary: EMPTY_SUMMARY,
    dimensions: [],
    validity: [],
    concerns: [],
    salesTraits: null,
    leadership: null,
    interviewGuide: [],
    development: [],
    integrity: {
      level: "NONE",
      label: "No notable events",
      weightedScore: 0,
      notableCounts: [],
      reviewReminder: "",
    },
    ...over,
  } as ReportPayload;
}
