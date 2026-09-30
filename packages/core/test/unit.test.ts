import { describe, expect, it } from "vitest";
import { extractIdentifierCandidates, normalizeIdentifier } from "../src/identifiers.ts";
import { numericTokens, valueSupportedByText } from "../src/gate/textSupport.ts";
import { maxAuthorityForCriticality, sourceTypeAllowedForPredicate } from "../src/knowledge/authority.ts";
import { extractRequirementsDeterministic } from "../src/requirements/extract.ts";
import { parseRfqLines } from "../src/agents/rfqBom.ts";
import { categorize } from "../src/agents/crossReference.ts";
import { restrictedPredicatesFor, PUBLIC_PRINCIPAL, allowedChannels } from "../src/auth/rbac.ts";
import { releaseGate, computeMetrics } from "../src/eval/runner.ts";

describe("identifier normalization", () => {
  it("collapses separators and case", () => {
    for (const v of ["ABC-123", "ABC123", "ABC 123", "abc-123", "abc.123", "ABC_123", "(ABC) 123"]) expect(normalizeIdentifier(v)).toBe("ABC123");
  });
  it("extracts part-number-like tokens but not sizes/units", () => {
    const ids = extractIdentifierCandidates('Need 2" S70-200 NPT and 4 x 70SS-1, 150 psi, 1/2 inch');
    expect(ids).toContain("S70-200");
    expect(ids).toContain("70SS-1");
    expect(ids).not.toContain("150");
    expect(ids).not.toContain("1/2");
  });
});

describe("citation text support", () => {
  it("parses fractions, negatives and mixed numbers", () => {
    expect(numericTokens('1-1/2" NPT -20 F to 400 F 3/4 in')).toEqual(expect.arrayContaining([1.5, -20, 400, 0.75]));
  });
  it("requires numeric values to appear as numbers", () => {
    expect(valueSupportedByText("1000", "Pressure rating: 1000 WOG (psi) all sizes")).toBe(true);
    expect(valueSupportedByText("600", "Pressure rating: 1000 WOG (psi) all sizes")).toBe(false);
    expect(valueSupportedByText("0.5", 'Series 70 1/2" Stainless Steel Ball Valve')).toBe(true);
    expect(valueSupportedByText("1", 'Sizes 1/2 through 3 inch')).toBe(false); // '1' inside '1/2' must not count
  });
  it("requires every significant token of a text value", () => {
    expect(valueSupportedByText("316 stainless steel (ASTM A351 CF8M)", "Body: ASTM A351 CF8M (316 stainless steel)")).toBe(true);
    expect(valueSupportedByText("ball_valve", "Two-Piece Stainless Steel Ball Valve")).toBe(true);
    expect(valueSupportedByText("carbon steel", "Body: ASTM A351 CF8M (316 stainless steel)")).toBe(false);
  });
  it("handles booleans explicitly", () => {
    expect(valueSupportedByText("false", "Lead-free: No")).toBe(true);
    expect(valueSupportedByText("true", "Lead-free: No")).toBe(false);
  });
});

describe("source precedence", () => {
  it("tightens authority with criticality", () => {
    expect(maxAuthorityForCriticality(1)).toBe(9);
    expect(maxAuthorityForCriticality(4)).toBe(6);
    expect(maxAuthorityForCriticality(5)).toBe(2);
  });
  it("never lets Shopify/P21/internet support a technical predicate", () => {
    expect(sourceTypeAllowedForPredicate("pressure_rating_psi", "shopify")).toBe(false);
    expect(sourceTypeAllowedForPredicate("pressure_rating_psi", "p21")).toBe(false);
    expect(sourceTypeAllowedForPredicate("pressure_rating_psi", "internet")).toBe(false);
    expect(sourceTypeAllowedForPredicate("pressure_rating_psi", "mfr_document")).toBe(true);
    expect(sourceTypeAllowedForPredicate("weight_lb", "shopify")).toBe(true);
    expect(sourceTypeAllowedForPredicate("weight_lb", "internet")).toBe(false);
  });
});

describe("requirement extraction", () => {
  it("marks explicit, inferred and unknown fields", () => {
    const r = extractRequirementsDeterministic("I need a 2-inch stainless ball valve for 150 PSI compressed air with NPT ends and a spring-return pneumatic actuator");
    const f = Object.fromEntries(r.fields.map((x) => [x.key, x]));
    expect(f.size_in).toMatchObject({ value: 2, provenance: "EXPLICIT" });
    expect(f.product_type).toMatchObject({ value: "ball_valve", provenance: "EXPLICIT" });
    expect(f.body_material).toMatchObject({ value: "stainless", provenance: "EXPLICIT" });
    expect(f.min_pressure_psi).toMatchObject({ value: 150, provenance: "EXPLICIT" });
    expect(f.media).toMatchObject({ value: "air", provenance: "EXPLICIT" });
    expect(f.end_connection).toMatchObject({ value: "NPT", provenance: "EXPLICIT" });
    expect(f.actuation).toMatchObject({ value: "spring_return", provenance: "EXPLICIT" });
    expect(f.max_temp_f.provenance).toBe("UNKNOWN");
    expect(f.fail_position.provenance).toBe("UNKNOWN");
  });
  it("labels spring-return→pneumatic as an inference only when not stated", () => {
    const r = extractRequirementsDeterministic("1 inch brass ball valve, spring return actuator");
    expect(r.fields.find((x) => x.key === "actuator_power")).toMatchObject({ value: "pneumatic", provenance: "INFERRED" });
  });
});

describe("RFQ line parsing", () => {
  it("parses quantities, manufacturers and part numbers from mixed email text", () => {
    const lines = parseRfqLines("Please quote:\n10 ea Bramwell S70-200\n4 x 70SS-1\n2 pcs 2\" brass ball valve NPT\n1 ea XYZ-999");
    expect(lines.map((l) => [l.quantity, l.manufacturer, l.partNumber])).toEqual([[10, "bramwell", "S70-200"], [4, null, "70SS-1"], [2, null, null], [1, null, "XYZ-999"]]);
  });
  it("parses CSV with header", () => {
    const lines = parseRfqLines("qty,part,description\n3,RA-085-DA,Corvin actuator\n6,CVA-SOL-120,solenoid 120vac");
    expect(lines.map((l) => [l.quantity, l.partNumber])).toEqual([[3, "RA-085-DA"], [6, "CVA-SOL-120"]]);
  });
});

describe("cross-reference categorization", () => {
  it("never upgrades similar or pending relationships to substitutes", () => {
    expect(categorize({ relationshipType: "technically_similar_to", approvalAuthority: "welsford", status: "human_approved" })).toBe("TECHNICALLY_SIMILAR_ALTERNATIVE");
    expect(categorize({ relationshipType: "approved_substitute_for", approvalAuthority: "welsford", status: "pending" })).toBe("POSSIBLE_MATCH_REQUIRING_REVIEW");
    expect(categorize({ relationshipType: "approved_substitute_for", approvalAuthority: "welsford", status: "verified" })).toBe("POSSIBLE_MATCH_REQUIRING_REVIEW"); // welsford substitutes need human approval
    expect(categorize({ relationshipType: "approved_substitute_for", approvalAuthority: "welsford", status: "human_approved" })).toBe("WELSFORD_APPROVED_SUBSTITUTE");
    expect(categorize({ relationshipType: "replaces", approvalAuthority: "manufacturer", status: "verified" })).toBe("MANUFACTURER_APPROVED_SUBSTITUTE");
    expect(categorize({ relationshipType: "approved_substitute_for", approvalAuthority: "none", status: "verified" })).toBe("POSSIBLE_MATCH_REQUIRING_REVIEW"); // no approval authority → review, never a substitute
    expect(categorize({ relationshipType: "approved_substitute_for", approvalAuthority: "welsford", status: "rejected" })).toBeNull();
  });
});

describe("RBAC", () => {
  it("restricts cost, contract pricing, list price and detailed inventory for the public principal", () => {
    const r = restrictedPredicatesFor(PUBLIC_PRINCIPAL);
    for (const p of ["cost", "customer_contract_price", "list_price", "qty_on_hand", "qty_committed"]) expect(r.has(p)).toBe(true);
    expect(r.has("qty_available")).toBe(false);
    expect(allowedChannels(PUBLIC_PRINCIPAL)).toEqual(["valveman"]);
  });
  it("lets an authenticated customer see only their own contract price", () => {
    const cust = { ...PUBLIC_PRINCIPAL, roleId: "customer", permissions: new Set(["view_own_pricing", "view_public_inventory"]), customerId: "c1" };
    expect(restrictedPredicatesFor(cust, { customerId: "c1" }).has("customer_contract_price")).toBe(false);
    expect(restrictedPredicatesFor(cust, { customerId: "c2" }).has("customer_contract_price")).toBe(true);
  });
});

describe("release gate", () => {
  const base = (over: Partial<ReturnType<typeof computeMetrics>>) => ({ ...computeMetrics([], []), ...over });
  it("fails below 99.9% claim precision and on any severity-1 error", () => {
    expect(releaseGate(base({ claimPrecision: 0.998 })).passed).toBe(false);
    expect(releaseGate(base({ severity1Errors: 1 })).passed).toBe(false);
    expect(releaseGate(base({ criticalClaimPrecision: 0.999 })).passed).toBe(false);
    expect(releaseGate(base({ abstentionQuality: 0.99 })).passed).toBe(false);
    expect(releaseGate(base({})).passed).toBe(true);
  });
});
