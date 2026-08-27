/** Plain-data types for the deterministic scoring engine (no DB coupling). */

import type { Construct } from "@/content/types";

export const SCORING_VERSION = "1.0";

/** One scorable cognitive item with the candidate's response. */
export interface CognitiveItemResponse {
  weight: number;
  /** Null when unanswered. */
  answerIndex: number | null;
  correctIndex: number;
  responseTimeMs?: number | null;
}

/** One Likert statement (0..4 choice index) with metadata. */
export interface LikertItemResponse {
  construct: Construct;
  weight: number;
  reverseCoded: boolean;
  impressionManagement: boolean;
  pairKey?: string | null;
  /** 0 = Strongly Disagree … 4 = Strongly Agree. Null when unanswered. */
  answerIndex: number | null;
}

export interface ConstructRawScore {
  construct: Construct;
  /** Construct-native raw value (e.g. weighted correct count, mean Likert). */
  rawScore: number;
  /** 0-100 normalized scale. Raw data is always preserved alongside. */
  scaledScore: number;
  /** Diagnostics stored in Score.detail. */
  detail: Record<string, unknown>;
}

export interface BandResult {
  band: number; // 1..9
  bandType: "PROVISIONAL" | "STANINE";
  percentile?: number;
  normTableId?: string;
}

export interface NormTableData {
  id: string;
  construct: Construct;
  /**
   * Ascending thresholds: raw scores <= maxRaw map to that band; anything
   * above the last threshold maps to band 9.
   */
  thresholds: { band: number; maxRaw: number; percentile?: number }[];
}

export type RangePosition = "BELOW" | "WITHIN" | "ABOVE";

export interface BenchmarkRange {
  construct: Construct;
  minScore: number;
  maxScore: number;
  required: boolean;
  enabled: boolean;
  weight: number;
  note?: string | null;
}

export interface ValidityResult {
  construct: "DISTORTION" | "EQUIVOCATION";
  rawScore: number;
  scaledScore: number; // 0-100
  band: number; // 1..9 provisional presentation
  level: "NORMAL" | "ELEVATED" | "HIGH";
  detail: Record<string, unknown>;
}
