/**
 * Cognitive (aptitude) scoring.
 *
 * Primary score is accuracy under standardized timing: the weighted share
 * of presented items answered correctly. Unanswered items count against
 * the score (they were presented under the section's standard timing).
 * Response speed is recorded for research/calibration but does NOT affect
 * the primary score — rapid random guessing earns nothing for speed.
 */

import type { CognitiveItemResponse, ConstructRawScore } from "./types";
import type { Construct } from "@/content/types";

export function scoreCognitiveSection(
  construct: Construct,
  items: CognitiveItemResponse[],
): ConstructRawScore {
  let weightedCorrect = 0;
  let totalWeight = 0;
  let answered = 0;
  let correct = 0;
  let totalTimeMs = 0;
  let timedCount = 0;

  for (const item of items) {
    totalWeight += item.weight;
    if (item.answerIndex !== null) {
      answered++;
      if (item.answerIndex === item.correctIndex) {
        correct++;
        weightedCorrect += item.weight;
      }
    }
    if (item.responseTimeMs != null) {
      totalTimeMs += item.responseTimeMs;
      timedCount++;
    }
  }

  const scaled = totalWeight > 0 ? (weightedCorrect / totalWeight) * 100 : 0;

  return {
    construct,
    rawScore: weightedCorrect,
    scaledScore: round2(scaled),
    detail: {
      itemsPresented: items.length,
      answered,
      unanswered: items.length - answered,
      correct,
      accuracyOfAnswered: answered > 0 ? round2((correct / answered) * 100) : null,
      avgResponseMs: timedCount > 0 ? Math.round(totalTimeMs / timedCount) : null,
      maxRaw: totalWeight,
    },
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
