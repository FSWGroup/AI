/**
 * Source precedence (docs/source-precedence.md). Lower = more authoritative.
 * The answer gate requires authority <= the threshold for the claim's criticality.
 */
export const AUTHORITY_BY_SOURCE_TYPE = {
  human_override: 1,
  mfr_document: 2,
  mfr_structured: 3,
  p21: 4,
  shopify: 5,
  internal_approved: 6,
  mfr_website: 7,
  company_website: 8,
  internal_historical: 9,
  internet: 10,
} as const;

export type SourceType = keyof typeof AUTHORITY_BY_SOURCE_TYPE;

/**
 * Maximum authority level (i.e. least-authoritative source) permitted to support a claim of a given criticality.
 *   criticality 1-2: anything except general internet
 *   criticality 3:   authority <= 7 (manufacturer website acceptable)
 *   criticality 4:   authority <= 6 (manufacturer docs/structured, ERP, Shopify-for-commercial, approved internal)
 *   criticality 5:   authority <= 2 (human override or manufacturer document) AND human approval
 */
export function maxAuthorityForCriticality(criticality: number): number {
  if (criticality >= 5) return 2;
  if (criticality === 4) return 6;
  if (criticality === 3) return 7;
  return 9;
}

/** Predicate-specific overrides: technical specs may never come from merchandising or ERP copy. */
const TECHNICAL_PREDICATES = new Set([
  "pressure_rating_psi", "temp_min_f", "temp_max_f", "cv", "steam_rating_psi", "break_torque_inlb", "torque_output_inlb_80psi",
  "spring_end_torque_inlb", "air_start_torque_inlb_80psi", "supply_pressure_min_psi", "supply_pressure_max_psi", "media",
  "hazardous_area_cert", "certifications", "body_material", "seat_material", "seal_material", "mount_pad_iso5211", "stem_size_mm",
  "actuator_mount_iso5211", "actuator_drive_mm", "lead_free", "vacuum_rating",
]);

/** Source types allowed to support a technical predicate. */
export function sourceTypeAllowedForPredicate(predicate: string, sourceType: SourceType): boolean {
  if (!TECHNICAL_PREDICATES.has(predicate)) return sourceType !== "internet";
  return sourceType === "human_override" || sourceType === "mfr_document" || sourceType === "mfr_structured" || sourceType === "internal_approved" || sourceType === "mfr_website";
}

/** Freshness window per source type (days). Beyond this, evidence is stale and cannot support a claim. */
export function freshnessWindowDays(sourceType: SourceType): number {
  switch (sourceType) {
    case "p21": return 1;          // ERP snapshot must be re-synced daily (inventory/pricing answers also state as_of)
    case "shopify": return 7;
    case "internet": return 0;
    default: return 365 * 3;       // manufacturer documents are versioned; superseded revisions are excluded separately
  }
}
