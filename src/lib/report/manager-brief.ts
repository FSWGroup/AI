/**
 * One-page hiring-manager brief.
 *
 * A hiring manager gets fifteen minutes with a report, not an hour. This
 * condenses the full report into what a manager actually acts on: where the
 * candidate lines up with the role, where they don't, what to ask about it,
 * and how much confidence the results deserve.
 *
 * It is a *view* over the stored report payload — it reads nothing else,
 * computes no new scores, and reaches no conclusion the full report does not
 * already support. That matters: if the brief and the report could ever
 * disagree, the brief would be a second, unvalidated instrument.
 *
 * Every list is capped at three. That is a layout constraint with a purpose:
 * the brief has to print on one sheet, and a manager who is handed ten things
 * to probe will probe none of them.
 *
 * There is deliberately no overall fit score, no ranking, and no
 * recommendation. Counting how many required dimensions fall inside their
 * range is a fact; turning that count into "hire" or "pass" would be an
 * automated employment decision, which this product does not make.
 */

import type { ReportPayload, ReportDimension } from "./generate";

export interface BriefAlignment {
  /** Required dimensions whose band falls inside the benchmark range. */
  inRange: number;
  /** Required dimensions with a benchmark, i.e. the denominator. */
  requiredTotal: number;
  /** Enabled-but-optional dimensions inside range, for context only. */
  optionalInRange: number;
  optionalTotal: number;
}

export interface BriefPoint {
  name: string;
  band: number;
  bandLabel: string;
  range: string | null;
  /** One sentence — never a verdict. */
  note: string;
}

export interface BriefQuestion {
  dimension: string;
  question: string;
  listenFor: string;
}

export interface ManagerBrief {
  meta: ReportPayload["meta"];
  alignment: BriefAlignment;
  alignsWith: BriefPoint[];
  probe: BriefPoint[];
  questions: BriefQuestion[];
  responseQuality: string;
  responseQualityLevel: "NORMAL" | "ELEVATED" | "HIGH";
  concerns: { name: string; label: string }[];
  integrity: { label: string; level: string; loggedEventCount: number };
  salesOverall: { label: string; classification: string } | null;
  bandTypeNote: string;
  disclaimer: string;
}

function rangeText(d: ReportDimension): string | null {
  return d.benchmark ? `${d.benchmark.min}–${d.benchmark.max}` : null;
}

/** Plain description of where a band sits relative to its target range. */
function positionNote(d: ReportDimension): string {
  if (!d.benchmark) return "No target range is set for this role.";
  switch (d.position) {
    case "WITHIN":
      return `Inside the ${d.benchmark.min}–${d.benchmark.max} range set for this role.`;
    case "BELOW":
      return `Below the ${d.benchmark.min}–${d.benchmark.max} range set for this role — worth exploring rather than assuming.`;
    case "ABOVE":
      return `Above the ${d.benchmark.min}–${d.benchmark.max} range set for this role. Higher is not automatically better; check whether it fits how the job is actually done.`;
    default:
      return "";
  }
}

export function buildManagerBrief(payload: ReportPayload): ManagerBrief {
  const benchmarked = payload.dimensions.filter((d) => d.benchmark !== null);
  const required = benchmarked.filter((d) => d.benchmark?.required);
  const optional = benchmarked.filter((d) => !d.benchmark?.required);

  const alignment: BriefAlignment = {
    inRange: required.filter((d) => d.position === "WITHIN").length,
    requiredTotal: required.length,
    optionalInRange: optional.filter((d) => d.position === "WITHIN").length,
    optionalTotal: optional.length,
  };

  // Aligns with the role: required dimensions inside range, strongest first.
  // Falls back to optional ones when the role sets no required dimensions.
  const withinPool = (required.length > 0 ? required : benchmarked).filter(
    (d) => d.position === "WITHIN",
  );
  const alignsWith: BriefPoint[] = withinPool
    .sort((a, b) => b.band - a.band)
    .slice(0, 3)
    .map((d) => ({
      name: d.name,
      band: d.band,
      bandLabel: d.bandLabel,
      range: rangeText(d),
      note: positionNote(d),
    }));

  // Worth exploring: outside range, furthest from it first. Required
  // dimensions outrank optional ones at equal distance.
  const probe: BriefPoint[] = benchmarked
    .filter((d) => d.position === "BELOW" || d.position === "ABOVE")
    .sort((a, b) => {
      const req = Number(b.benchmark?.required) - Number(a.benchmark?.required);
      if (req !== 0) return req;
      return Math.abs(b.deviation) - Math.abs(a.deviation);
    })
    .slice(0, 3)
    .map((d) => ({
      name: d.name,
      band: d.band,
      bandLabel: d.bandLabel,
      range: rangeText(d),
      note: positionNote(d),
    }));

  // One question per selected dimension, taken verbatim from the full
  // report's interview guide so the two documents never diverge.
  const questions: BriefQuestion[] = payload.interviewGuide
    .slice(0, 3)
    .flatMap((g) =>
      g.questions.length > 0
        ? [
            {
              dimension: g.name,
              question: g.questions[0].question,
              listenFor: g.questions[0].listenFor,
            },
          ]
        : [],
    );

  const level = payload.validity.some((v) => v.level === "HIGH")
    ? "HIGH"
    : payload.validity.some((v) => v.level === "ELEVATED")
      ? "ELEVATED"
      : "NORMAL";

  return {
    meta: payload.meta,
    alignment,
    alignsWith,
    probe,
    questions,
    responseQuality: payload.executiveSummary.responseQuality,
    responseQualityLevel: level,
    concerns: payload.concerns.map((c) => ({ name: c.name, label: c.label })),
    integrity: {
      label: payload.integrity.label,
      level: payload.integrity.level,
      // Events can be logged without reaching a level that warrants review —
      // the count and the level answer different questions.
      loggedEventCount: payload.integrity.notableCounts.reduce(
        (n, c) => n + c.count,
        0,
      ),
    },
    salesOverall: payload.salesTraits
      ? {
          label: payload.salesTraits.overallLabel,
          classification: payload.salesTraits.overall,
        }
      : null,
    bandTypeNote: payload.meta.bandTypeNote,
    disclaimer: payload.executiveSummary.disclaimer,
  };
}
