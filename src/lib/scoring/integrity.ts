/**
 * Assessment-integrity summary.
 *
 * Only objective events are counted; the output is a review recommendation
 * for a human, never an accusation and never a "cheating probability".
 * Recording content and camera imagery are NEVER analyzed — see
 * docs/RECORDING-PRIVACY.md.
 */

export type IntegritySummaryLevel =
  | "NO_NOTABLE_EVENTS"
  | "MINOR_REVIEW_RECOMMENDED"
  | "REVIEW_RECOMMENDED";

export const INTEGRITY_LABELS: Record<IntegritySummaryLevel, string> = {
  NO_NOTABLE_EVENTS: "No notable events",
  MINOR_REVIEW_RECOMMENDED: "Minor review recommended",
  REVIEW_RECOMMENDED: "Review recommended",
};

/** Event types the platform records. All objective and human-reviewable. */
export const INTEGRITY_EVENT_TYPES = [
  "ATTEMPT_STARTED",
  "SECTION_STARTED",
  "SECTION_COMPLETED",
  "SECTION_EXPIRED",
  "TAB_HIDDEN",
  "TAB_VISIBLE",
  "WINDOW_BLUR",
  "WINDOW_FOCUS",
  "PAGE_REFRESH",
  "DISCONNECTED",
  "RECONNECTED",
  "CAMERA_STARTED",
  "CAMERA_INTERRUPTED",
  "CAMERA_RESTORED",
  "CAMERA_ENDED",
  "COPY_ATTEMPT",
  "CONTEXT_MENU_BLOCKED",
  "RAPID_ANSWER_CHANGES",
  "ATTEMPT_COMPLETED",
] as const;
export type IntegrityEventType = (typeof INTEGRITY_EVENT_TYPES)[number];

export interface IntegrityEventCount {
  type: string;
  count: number;
}

export const INTEGRITY_THRESHOLDS = {
  version: "1.0",
  /** Events that count toward the review recommendation, with weights. */
  weights: {
    TAB_HIDDEN: 1,
    WINDOW_BLUR: 0.5,
    CAMERA_INTERRUPTED: 2,
    DISCONNECTED: 0.5,
    COPY_ATTEMPT: 2,
    RAPID_ANSWER_CHANGES: 1,
  } as Record<string, number>,
  minorAt: 2,
  reviewAt: 6,
} as const;

export function summarizeIntegrity(counts: IntegrityEventCount[]): {
  level: IntegritySummaryLevel;
  weightedScore: number;
  notableCounts: IntegrityEventCount[];
} {
  let weighted = 0;
  const notable: IntegrityEventCount[] = [];
  for (const c of counts) {
    const w = INTEGRITY_THRESHOLDS.weights[c.type];
    if (w && c.count > 0) {
      weighted += w * c.count;
      notable.push(c);
    }
  }
  let level: IntegritySummaryLevel = "NO_NOTABLE_EVENTS";
  if (weighted >= INTEGRITY_THRESHOLDS.reviewAt) level = "REVIEW_RECOMMENDED";
  else if (weighted >= INTEGRITY_THRESHOLDS.minorAt) {
    level = "MINOR_REVIEW_RECOMMENDED";
  }
  return { level, weightedScore: weighted, notableCounts: notable };
}
