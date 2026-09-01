/**
 * Recruiting analytics.
 *
 * Computed from the stage-event history rather than from applications' current
 * state, so the numbers survive later edits: someone moved back a stage, or
 * rejected and reopened, still shows the path they actually took.
 *
 * Small-sample honesty carries over from the assessment side of the product.
 * A conversion rate from four applicants is noise dressed as a percentage, so
 * rates below a floor are reported as counts with the rate withheld.
 */

import type { StageKind } from "@prisma/client";

/** Below this, a percentage says more than the data supports. */
export const MIN_FOR_RATE = 10;

export interface StageEventRow {
  applicationId: string;
  stageKind: StageKind;
  stageName: string;
  occurredAt: Date;
}

export interface ApplicationRow {
  id: string;
  status: string;
  channelKey: string | null;
  channelName: string | null;
  appliedAt: Date;
  hiredAt: Date | null;
  rejectedAt: Date | null;
}

export interface FunnelStep {
  stageKind: StageKind;
  stageName: string;
  /** Distinct applications that ever reached this stage. */
  reached: number;
  /** Of those, how many ever reached the next step. */
  advanced: number;
  /** Null when `reached` is below the reporting floor. */
  conversionRate: number | null;
}

/**
 * Build the funnel in pipeline order.
 *
 * "Reached" counts an application once even if it visited a stage twice, and
 * counts it at every stage it passed through — including ones it skipped past
 * later — because the question a funnel answers is "where do people fall out",
 * not "where are they now".
 */
export function buildFunnel(
  orderedStages: { name: string; kind: StageKind }[],
  events: StageEventRow[],
): FunnelStep[] {
  const reachedByStage = new Map<string, Set<string>>();
  for (const stage of orderedStages) {
    reachedByStage.set(stage.name, new Set());
  }
  for (const e of events) {
    const set = reachedByStage.get(e.stageName);
    if (set) set.add(e.applicationId);
  }

  const steps: FunnelStep[] = [];
  for (let i = 0; i < orderedStages.length; i++) {
    const stage = orderedStages[i];
    const reached = reachedByStage.get(stage.name) ?? new Set<string>();
    const next = orderedStages[i + 1];
    const nextReached = next
      ? (reachedByStage.get(next.name) ?? new Set<string>())
      : new Set<string>();
    // Only count an advance for applications that reached this stage too, so
    // a direct-to-interview referral does not inflate the screen conversion.
    let advanced = 0;
    for (const id of reached) if (nextReached.has(id)) advanced += 1;

    steps.push({
      stageKind: stage.kind,
      stageName: stage.name,
      reached: reached.size,
      advanced: next ? advanced : 0,
      conversionRate:
        next && reached.size >= MIN_FOR_RATE ? advanced / reached.size : null,
    });
  }
  return steps;
}

export interface TimeInStage {
  stageName: string;
  stageKind: StageKind;
  /** Median days, which resists the one application that sat for a year. */
  medianDays: number | null;
  sampleSize: number;
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const MS_PER_DAY = 86_400_000;

/**
 * How long applications sit in each stage.
 *
 * An application still sitting in a stage counts, measured to `now` — leaving
 * it out would make a stalled pipeline look fast, which is precisely backwards.
 */
export function timeInStages(
  events: StageEventRow[],
  now: Date = new Date(),
): TimeInStage[] {
  const byApplication = new Map<string, StageEventRow[]>();
  for (const e of events) {
    const list = byApplication.get(e.applicationId) ?? [];
    list.push(e);
    byApplication.set(e.applicationId, list);
  }

  const durations = new Map<string, { kind: StageKind; days: number[] }>();
  for (const list of byApplication.values()) {
    const ordered = [...list].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    for (let i = 0; i < ordered.length; i++) {
      const start = ordered[i];
      const end = ordered[i + 1]?.occurredAt ?? now;
      const days = (end.getTime() - start.occurredAt.getTime()) / MS_PER_DAY;
      if (days < 0) continue;
      const entry = durations.get(start.stageName) ?? {
        kind: start.stageKind,
        days: [],
      };
      entry.days.push(days);
      durations.set(start.stageName, entry);
    }
  }

  return [...durations.entries()].map(([stageName, { kind, days }]) => ({
    stageName,
    stageKind: kind,
    medianDays: medianOf(days),
    sampleSize: days.length,
  }));
}

export interface SourcePerformance {
  channelKey: string;
  channelName: string;
  applications: number;
  hires: number;
  /** Null below the reporting floor. */
  hireRate: number | null;
  medianDaysToHire: number | null;
}

export function sourcePerformance(
  applications: ApplicationRow[],
): SourcePerformance[] {
  const groups = new Map<string, ApplicationRow[]>();
  for (const a of applications) {
    const key = a.channelKey ?? "unknown";
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }

  const rows: SourcePerformance[] = [];
  for (const [channelKey, list] of groups) {
    const hires = list.filter((a) => a.hiredAt != null);
    const daysToHire = hires
      .map((a) => (a.hiredAt!.getTime() - a.appliedAt.getTime()) / MS_PER_DAY)
      .filter((d) => d >= 0);
    rows.push({
      channelKey,
      channelName: list[0].channelName ?? channelKey,
      applications: list.length,
      hires: hires.length,
      hireRate: list.length >= MIN_FOR_RATE ? hires.length / list.length : null,
      medianDaysToHire: medianOf(daysToHire),
    });
  }
  return rows.sort((a, b) => b.applications - a.applications);
}

export interface PipelineHealth {
  active: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  medianDaysToHire: number | null;
  /** Applications with no stage movement in the last 14 days. */
  stalled: number;
}

export function pipelineHealth(
  applications: ApplicationRow[],
  lastActivityByApplication: Map<string, Date>,
  now: Date = new Date(),
): PipelineHealth {
  const hired = applications.filter((a) => a.hiredAt != null);
  const daysToHire = hired
    .map((a) => (a.hiredAt!.getTime() - a.appliedAt.getTime()) / MS_PER_DAY)
    .filter((d) => d >= 0);

  const STALE_DAYS = 14;
  let stalled = 0;
  for (const a of applications) {
    if (a.status !== "ACTIVE") continue;
    const last = lastActivityByApplication.get(a.id) ?? a.appliedAt;
    if ((now.getTime() - last.getTime()) / MS_PER_DAY > STALE_DAYS) stalled += 1;
  }

  return {
    active: applications.filter((a) => a.status === "ACTIVE").length,
    hired: hired.length,
    rejected: applications.filter((a) => a.status === "REJECTED").length,
    withdrawn: applications.filter((a) => a.status === "WITHDRAWN").length,
    medianDaysToHire: medianOf(daysToHire),
    stalled,
  };
}

/** Percentage for display, or a dash when the sample is too small. */
export function formatRate(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}
