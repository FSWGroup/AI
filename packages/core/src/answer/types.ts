/**
 * Answer model. Every answer is a set of CLAIMS. A claim is a single factual statement
 * (subject, predicate, value) with the evidence that supports it. The gate decides which claims survive.
 */
export type Confidence = "VERIFIED" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE";
export type Outcome = "answered" | "partial" | "abstained" | "escalated" | "error";

export type ClaimKind =
  | "identity"      // part number resolves to this variant / manufacturer
  | "attribute"     // technical attribute backed by a knowledge assertion
  | "relationship"  // explicit product relationship (substitute, compatible, mounted_with ...)
  | "commercial"    // price, inventory, lead time from ERP/ecommerce records
  | "rule"          // channel/territory decision from the rule engine
  | "calculation"   // deterministic computation over verified claims
  | "document"      // a document/section exists and is current
  | "assumption";   // explicitly labeled assumption; never presented as fact

export interface ProposedClaim {
  subjectRef: string;          // canonical SKU, or 'rule:<channel>:<sku>', 'calc:<name>'
  predicate: string;
  value: string;               // canonical string form; numbers as plain decimal strings
  unit?: string;
  criticality: number;         // 1..5, from attribute_definitions or agent policy
  kind: ClaimKind;
  critical?: boolean;          // if this claim cannot be verified the whole answer abstains
  support: {
    assertionId?: string;
    relationshipId?: string;
    sourceRecordIds: string[];
    supportingText?: string;
    dependsOn?: number[];      // indices of other proposed claims (calculations)
    formula?: string;
  };
  label?: string;              // human-readable statement
}

export interface Citation {
  sourceRecordId: string;
  label: string;               // "Bramwell Series 70 Datasheet BVW-70-DS Rev C, p.2"
  sourceType: string;
  authorityLevel: number;
  isFixture: boolean;
  supportingText: string | null;
  documentTitle?: string | null;
  documentNumber?: string | null;
  revision?: string | null;
  pageNumber?: number | null;
  recordLocator?: string | null;
  asOf?: string | null;
}

export type ClaimStatus = "verified" | "removed_unsupported" | "removed_conflict" | "removed_stale" | "removed_channel" | "removed_unapproved" | "assumption";

export interface GatedClaim extends ProposedClaim {
  status: ClaimStatus;
  reason?: string;
  citations: Citation[];
}

export interface GateReport {
  proposed: number;
  verified: number;
  removed: number;
  removedCritical: number;
  checks: { claim: number; check: string; passed: boolean; detail?: string }[];
}

export interface Answer {
  agent: string;
  question: string;
  /** the structured input the agent received (stored with the run; used to replay as a regression case) */
  input?: Record<string, unknown>;
  outcome: Outcome;
  confidence: Confidence;
  criticality: number;
  claims: GatedClaim[];
  /** Prose summary assembled from verified claims only (never from model knowledge). */
  summary: string;
  known: string[];
  unknown: string[];
  resolvingSources: string[];
  humanReviewRecommended: boolean;
  gate: GateReport;
  data?: Record<string, unknown>;   // agent-specific structured payload (tables, matrices) built from verified claims
  runId?: string;
  llmUsed: boolean;
}

export const ABSTAIN_TEXT = "I don't have enough verified information to answer that confidently.";
