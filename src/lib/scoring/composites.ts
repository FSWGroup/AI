/**
 * Composite scores (sales traits, leadership areas).
 *
 * Composites are transparent weighted means of 1-9 dimension bands. The
 * exact component weights live in DB-backed CompositeDefinition rows that
 * admins can inspect; this module just evaluates them deterministically.
 */

import { clampBand } from "./bands";
import { round2 } from "./cognitive";
import type { Construct } from "@/content/types";

export interface CompositeComponent {
  construct: Construct;
  weight: number;
}

export interface CompositeInput {
  key: string;
  name: string;
  category: "SALES" | "LEADERSHIP";
  version: string;
  components: CompositeComponent[];
}

export interface CompositeResult {
  key: string;
  name: string;
  category: "SALES" | "LEADERSHIP";
  value: number; // weighted mean, 1..9 continuous
  band: number; // rounded 1..9
  formulaVersion: string;
  detail: {
    components: { construct: Construct; weight: number; band: number | null }[];
    missingComponents: Construct[];
  };
}

export function evaluateComposite(
  def: CompositeInput,
  bands: Partial<Record<Construct, number>>,
): CompositeResult {
  let weightedSum = 0;
  let weightTotal = 0;
  const componentsDetail: CompositeResult["detail"]["components"] = [];
  const missing: Construct[] = [];

  for (const c of def.components) {
    const band = bands[c.construct] ?? null;
    componentsDetail.push({ construct: c.construct, weight: c.weight, band });
    if (band === null) {
      missing.push(c.construct);
      continue;
    }
    weightedSum += band * c.weight;
    weightTotal += c.weight;
  }

  const value = weightTotal > 0 ? weightedSum / weightTotal : 0;

  return {
    key: def.key,
    name: def.name,
    category: def.category,
    value: round2(value),
    band: weightTotal > 0 ? clampBand(value) : 1,
    formulaVersion: def.version,
    detail: { components: componentsDetail, missingComponents: missing },
  };
}

export type SalesAlignment =
  | "STRONG_ALIGNMENT"
  | "GENERALLY_ALIGNED"
  | "MIXED_ALIGNMENT"
  | "REQUIRES_INVESTIGATION";

export const SALES_ALIGNMENT_LABELS: Record<SalesAlignment, string> = {
  STRONG_ALIGNMENT: "Strong alignment",
  GENERALLY_ALIGNED: "Generally aligned",
  MIXED_ALIGNMENT: "Mixed alignment",
  REQUIRES_INVESTIGATION: "Requires additional investigation",
};

/** Qualitative classification of one composite band. Never a probability. */
export function classifyCompositeBand(band: number): SalesAlignment {
  if (band >= 7) return "STRONG_ALIGNMENT";
  if (band >= 5) return "GENERALLY_ALIGNED";
  if (band === 4) return "MIXED_ALIGNMENT";
  return "REQUIRES_INVESTIGATION";
}

/**
 * Overall qualitative summary across sales composites. A transparent count
 * rule, deliberately not a predictive "success probability".
 */
export function overallSalesAlignment(bandsList: number[]): SalesAlignment {
  if (bandsList.length === 0) return "MIXED_ALIGNMENT";
  const strong = bandsList.filter((b) => b >= 7).length;
  const low = bandsList.filter((b) => b <= 3).length;
  const atLeastAligned = bandsList.filter((b) => b >= 5).length;
  const share = atLeastAligned / bandsList.length;
  if (low === 0 && share >= 0.8 && strong >= bandsList.length / 2) {
    return "STRONG_ALIGNMENT";
  }
  if (low <= 1 && share >= 0.6) return "GENERALLY_ALIGNED";
  if (low >= bandsList.length / 3) return "REQUIRES_INVESTIGATION";
  return "MIXED_ALIGNMENT";
}
