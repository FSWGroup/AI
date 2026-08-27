/**
 * Response-quality (validity) indicators.
 *
 * These are indicators, not proof of anything. They never modify substantive
 * trait scores — they add interpretation cautions to the report. Reports must
 * never call a candidate dishonest; see the narrative templates.
 *
 * DISTORTION / impression management combines:
 *   - endorsement of improbably-perfect-behavior items
 *   - an unusually uniform highly-desirable response pattern
 *   - contradictions between impression-management and substantive items
 *
 * EQUIVOCATION combines:
 *   - heavy use of the middle/neutral option
 *   - low differentiation (little variance across items)
 *   - inconsistent answers to semantically paired items
 *
 * All raw measurements are preserved in `detail`, and the thresholds are
 * exported so admins can see exactly why an indicator was triggered.
 */

import { likertItemScore } from "./behavioral";
import { provisionalBand } from "./bands";
import { round2 } from "./cognitive";
import type { LikertItemResponse, ValidityResult } from "./types";

export const VALIDITY_CONFIG = {
  version: "1.0",
  distortion: {
    /** Weight of impression-management item endorsement (0-1 scale). */
    imWeight: 0.6,
    /** Weight of uniformly desirable extreme responding. */
    extremeDesirableWeight: 0.4,
    /** Scaled score (0-100) at which the indicator reads ELEVATED. */
    elevatedAt: 65,
    /** Scaled score at which it reads HIGH. */
    highAt: 80,
  },
  equivocation: {
    middleWeight: 0.5,
    inconsistencyWeight: 0.3,
    lowDifferentiationWeight: 0.2,
    /** Middle-choice count threshold (configurable) used in reporting. */
    middleCountThreshold: 30,
    elevatedAt: 45,
    highAt: 60,
  },
} as const;

function level(
  scaled: number,
  cfg: { elevatedAt: number; highAt: number },
): "NORMAL" | "ELEVATED" | "HIGH" {
  if (scaled >= cfg.highAt) return "HIGH";
  if (scaled >= cfg.elevatedAt) return "ELEVATED";
  return "NORMAL";
}

export function scoreDistortion(items: LikertItemResponse[]): ValidityResult {
  const cfg = VALIDITY_CONFIG.distortion;
  const imItems = items.filter((i) => i.impressionManagement);
  const substantive = items.filter((i) => !i.impressionManagement);

  // 1. Impression-management endorsement: mean directional score (1..5) of
  //    answered IM items, normalized to 0..1.
  let imSum = 0;
  let imAnswered = 0;
  for (const item of imItems) {
    const s = likertItemScore(item);
    if (s !== null) {
      imSum += s;
      imAnswered++;
    }
  }
  const imMean = imAnswered > 0 ? imSum / imAnswered : 3;
  const imComponent = (imMean - 1) / 4;

  // 2. Uniform desirability: share of answered substantive items at the
  //    maximally desirable extreme (5 after reverse-coding).
  let extremeDesirable = 0;
  let answeredSubstantive = 0;
  for (const item of substantive) {
    const s = likertItemScore(item);
    if (s === null) continue;
    answeredSubstantive++;
    if (s === 5) extremeDesirable++;
  }
  const extremeFraction =
    answeredSubstantive > 0 ? extremeDesirable / answeredSubstantive : 0;

  const combined =
    imComponent * cfg.imWeight + extremeFraction * cfg.extremeDesirableWeight;
  const scaled = round2(combined * 100);

  return {
    construct: "DISTORTION",
    rawScore: round2(imMean),
    scaledScore: scaled,
    band: provisionalBand(scaled).band,
    level: level(scaled, cfg),
    detail: {
      imItemsPresented: imItems.length,
      imItemsAnswered: imAnswered,
      imMean: round2(imMean),
      extremeDesirableCount: extremeDesirable,
      substantiveAnswered: answeredSubstantive,
      extremeDesirableFraction: round2(extremeFraction),
      weights: { im: cfg.imWeight, extremeDesirable: cfg.extremeDesirableWeight },
      thresholds: { elevatedAt: cfg.elevatedAt, highAt: cfg.highAt },
      configVersion: VALIDITY_CONFIG.version,
    },
  };
}

export function scoreEquivocation(items: LikertItemResponse[]): ValidityResult {
  const cfg = VALIDITY_CONFIG.equivocation;
  const answered = items.filter((i) => i.answerIndex !== null);

  // 1. Middle-choice usage.
  const middleCount = answered.filter((i) => i.answerIndex === 2).length;
  const middleFraction = answered.length > 0 ? middleCount / answered.length : 0;

  // 2. Pair inconsistency: mean absolute difference between directional
  //    scores of paired items (0..4), normalized to 0..1.
  const byPair = new Map<string, number[]>();
  for (const item of answered) {
    if (!item.pairKey) continue;
    const s = likertItemScore(item);
    if (s === null) continue;
    const list = byPair.get(item.pairKey) ?? [];
    list.push(s);
    byPair.set(item.pairKey, list);
  }
  let pairDiffs = 0;
  let pairCount = 0;
  for (const scores of byPair.values()) {
    if (scores.length === 2) {
      pairDiffs += Math.abs(scores[0] - scores[1]) / 4;
      pairCount++;
    }
  }
  const inconsistency = pairCount > 0 ? pairDiffs / pairCount : 0;

  // 3. Low differentiation: 1 - (stddev of directional scores / max stddev 2).
  let lowDifferentiation = 0;
  let stddev: number | null = null;
  if (answered.length >= 5) {
    const scores = answered
      .map((i) => likertItemScore(i))
      .filter((s): s is number => s !== null);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
    stddev = Math.sqrt(variance);
    lowDifferentiation = Math.max(0, 1 - stddev / 2);
  }

  const combined =
    middleFraction * cfg.middleWeight +
    inconsistency * cfg.inconsistencyWeight +
    lowDifferentiation * cfg.lowDifferentiationWeight;
  const scaled = round2(combined * 100);

  return {
    construct: "EQUIVOCATION",
    rawScore: middleCount,
    scaledScore: scaled,
    band: provisionalBand(scaled).band,
    level: level(scaled, cfg),
    detail: {
      itemsAnswered: answered.length,
      middleCount,
      middleFraction: round2(middleFraction),
      middleCountThreshold: cfg.middleCountThreshold,
      middleCountExceedsThreshold: middleCount > cfg.middleCountThreshold,
      pairsEvaluated: pairCount,
      pairInconsistency: round2(inconsistency),
      responseStdDev: stddev !== null ? round2(stddev) : null,
      lowDifferentiation: round2(lowDifferentiation),
      weights: {
        middle: cfg.middleWeight,
        inconsistency: cfg.inconsistencyWeight,
        lowDifferentiation: cfg.lowDifferentiationWeight,
      },
      thresholds: { elevatedAt: cfg.elevatedAt, highAt: cfg.highAt },
      configVersion: VALIDITY_CONFIG.version,
    },
  };
}
