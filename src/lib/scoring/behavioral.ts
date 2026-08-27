/**
 * Behavioral / statement-inventory scoring.
 *
 * Each Likert response (0..4) becomes an item score of 1..5; reverse-coded
 * items are flipped (6 - score). A construct's raw score is the weighted
 * mean of its answered items (1..5), normalized to 0-100. Using the mean
 * keeps any single answer from dramatically moving a trait score.
 *
 * Impression-management (DISTORTION) items never contribute to trait scores.
 */

import { round2 } from "./cognitive";
import type { ConstructRawScore, LikertItemResponse } from "./types";
import type { Construct } from "@/content/types";

/** Minimum share of a construct's items that must be answered to score it. */
export const MIN_ANSWERED_FRACTION = 0.5;

export function likertItemScore(item: LikertItemResponse): number | null {
  if (item.answerIndex === null) return null;
  const base = item.answerIndex + 1; // 1..5
  return item.reverseCoded ? 6 - base : base;
}

export function scoreBehavioralConstruct(
  construct: Construct,
  items: LikertItemResponse[],
): ConstructRawScore {
  const substantive = items.filter(
    (i) => i.construct === construct && !i.impressionManagement,
  );
  let weightedSum = 0;
  let weightTotal = 0;
  let answered = 0;

  for (const item of substantive) {
    const score = likertItemScore(item);
    if (score === null) continue;
    answered++;
    weightedSum += score * item.weight;
    weightTotal += item.weight;
  }

  const answeredFraction =
    substantive.length > 0 ? answered / substantive.length : 0;
  const mean = weightTotal > 0 ? weightedSum / weightTotal : 3; // neutral fallback
  const scaled = ((mean - 1) / 4) * 100;

  return {
    construct,
    rawScore: round2(mean),
    scaledScore: round2(scaled),
    detail: {
      itemsPresented: substantive.length,
      answered,
      answeredFraction: round2(answeredFraction),
      scorable: answeredFraction >= MIN_ANSWERED_FRACTION,
    },
  };
}
