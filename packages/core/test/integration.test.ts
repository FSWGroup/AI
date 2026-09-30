/**
 * Integration tests against the seeded development database (run `npm run db:reset` first).
 * Tests that mutate knowledge (conflict resolution, corrections) restore the database at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql, closeSql } from "../src/db/client.ts";
import { makeContext } from "../src/agents/context.ts";
import { loadPrincipalByEmail, PUBLIC_PRINCIPAL } from "../src/auth/rbac.ts";
import { partLookupAgent } from "../src/agents/partLookup.ts";
import { productSpecsAgent } from "../src/agents/productSpecs.ts";
import { crossReferenceAgent } from "../src/agents/crossReference.ts";
import { eligibilityAgent } from "../src/agents/eligibility.ts";
import { pricingAgent, inventoryAgent } from "../src/agents/commercial.ts";
import { assemblyAgent } from "../src/agents/assembly.ts";
import { productFinderAgent } from "../src/agents/productFinder.ts";
import { runAnswerGate } from "../src/gate/answerGate.ts";
import { decideEligibility } from "../src/rules/channelEngine.ts";
import { resolveConflict } from "../src/knowledge/conflicts.ts";
import { correctAssertion, reportIncorrectAnswer } from "../src/review/reviews.ts";
import { runEvaluation } from "../src/eval/runner.ts";
import { reconcileShopifyP21 } from "../src/ingest/reconcile.ts";
import { resetDatabase } from "../src/db/reset.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedAll } from "../src/db/seed.ts";

const sql = getSql();
let engineer: NonNullable<Awaited<ReturnType<typeof loadPrincipalByEmail>>>;
let sales: NonNullable<Awaited<ReturnType<typeof loadPrincipalByEmail>>>;
let mutated = false;

beforeAll(async () => {
  const n = await sql`SELECT count(*)::int AS n FROM manufacturers`;
  if (!n[0].n) { await migrate(); await seedAll(); }
  engineer = (await loadPrincipalByEmail(sql, "engineer@welsford.example"))!;
  sales = (await loadPrincipalByEmail(sql, "sales@welsford.example"))!;
});
afterAll(async () => {
  if (mutated) { await resetDatabase(); await migrate(); await seedAll(); }
  await closeSql();
});

const ctx = () => makeContext(sql, { principal: engineer, channelId: "welsford", state: "PA", mode: "evaluation" });

describe("part lookup", () => {
  it("resolves normalized / historical identifiers exactly and refuses partial numbers", async () => {
    const a = await partLookupAgent(ctx(), "s70 200");
    expect(a.outcome).toBe("answered");
    expect((a.data as any).resolved[0]).toMatchObject({ sku: "BVW-S70-200", matchType: "normalized" });
    const h = await partLookupAgent(ctx(), "70SS-2");
    expect((h.data as any).matchType).toBe("historical");
    const p = await partLookupAgent(ctx(), "S70-2");
    expect(p.outcome).toBe("abstained");
    expect((p.data as any).candidates.length).toBeGreaterThan(0);
  });
});

describe("answer gate", () => {
  it("removes claims on conflicting, pending, internet-sourced and superseded evidence", async () => {
    const conflict = await productSpecsAgent(ctx(), { partNumber: "BVW-S40-100", predicates: ["pressure_rating_psi"] });
    expect(conflict.outcome).toBe("abstained");
    expect(conflict.claims.filter((c) => c.predicate === "pressure_rating_psi").every((c) => c.status !== "verified")).toBe(true);
    const pending = await productSpecsAgent(ctx(), { partNumber: "HLD-2000-2SS", predicates: ["pressure_rating_psi"] });
    expect(pending.outcome).toBe("abstained");
    const internet = await productSpecsAgent(ctx(), { partNumber: "BVW-S40-200", predicates: ["cv"] });
    expect(internet.outcome).toBe("abstained");
    const superseded = await productSpecsAgent(ctx(), { partNumber: "BVW-S70-300", predicates: ["temp_max_f"] });
    expect(superseded.claims.find((c) => c.predicate === "temp_max_f")?.value).toBe("400");
  });
  it("rejects a claim whose supporting text does not contain the value (citation validity)", async () => {
    const [rec] = await sql`SELECT r.id FROM source_records r JOIN sources s ON s.id = r.source_id JOIN document_versions dv ON dv.id = r.document_version_id WHERE s.source_type = 'mfr_document' AND dv.is_current AND r.extracted_text LIKE 'Pressure rating: 1000 WOG%' LIMIT 1`;
    const [asrt] = await sql`SELECT a.id FROM knowledge_assertions a JOIN product_variants v ON v.id = a.subject_id WHERE v.canonical_sku = 'BVW-S70-200' AND a.predicate = 'pressure_rating_psi' AND a.status = 'verified'`;
    const res = await runAnswerGate([
      { subjectRef: "BVW-S70-200", predicate: "pressure_rating_psi", value: "1000", criticality: 4, kind: "attribute", support: { assertionId: asrt.id, sourceRecordIds: [rec.id] } },
      { subjectRef: "BVW-S70-200", predicate: "pressure_rating_psi", value: "1500", criticality: 4, kind: "attribute", support: { assertionId: asrt.id, sourceRecordIds: [rec.id] } },
    ], { sql });
    expect(res.claims[0].status).toBe("verified");
    expect(res.claims[1].status).toBe("removed_unsupported");
  });
  it("ignores prompt-injection text inside a document page", async () => {
    const a = await productSpecsAgent(ctx(), { partNumber: "BVW-S90-300", predicates: ["pressure_rating_psi"] });
    expect(a.claims.find((c) => c.predicate === "pressure_rating_psi" && c.status === "verified")?.value).toBe("200");
    expect(a.claims.some((c) => c.value === "500")).toBe(false);
  });
});

describe("rule engine", () => {
  it("applies priority carve-outs, territory scoping and customer-class approvals", async () => {
    const id = async (sku: string) => (await sql`SELECT id FROM product_variants WHERE canonical_sku = ${sku}`)[0].id as string;
    expect((await decideEligibility(sql, { variantId: await id("CVA-RA-052-DA"), channelId: "valveman", state: "CA" })).authorized).toBe(false);
    expect((await decideEligibility(sql, { variantId: await id("CVA-RA-052-DA"), channelId: "valveman", state: "OH" })).authorized).toBe(true);
    expect((await decideEligibility(sql, { variantId: await id("BVW-S70-200"), channelId: "welsford", state: null })).authorized).toBeNull();
    expect((await decideEligibility(sql, { variantId: await id("BVW-S70-200"), channelId: "welsford", state: "NY" })).authorized).toBe(false);
    const oem = await decideEligibility(sql, { variantId: await id("STR-TD52-075"), channelId: "welsford", state: "PA", customerClass: "OEM" });
    expect(oem).toMatchObject({ authorized: true, rfqOnly: true, requiresApproval: true });
  });
  it("denies channels the principal cannot act in", async () => {
    const a = await eligibilityAgent(makeContext(sql, { principal: PUBLIC_PRINCIPAL, channelId: "valveman", mode: "evaluation" }), { partNumber: "BVW-S70-200", channel: "welsford", state: "PA" });
    expect(a.outcome).toBe("abstained");
    expect(a.claims.length).toBe(0);
  });
});

describe("commercial RBAC", () => {
  it("never exposes cost or another customer's contract price to a public principal", async () => {
    const pub = makeContext(sql, { principal: PUBLIC_PRINCIPAL, channelId: "valveman", mode: "evaluation" });
    const a = await pricingAgent(pub, { partNumber: "BVW-S70-200", channel: "valveman", customerP21Id: "C-10021" });
    expect(a.claims.filter((c) => c.status === "verified").map((c) => c.predicate)).toEqual(expect.not.arrayContaining(["cost", "customer_contract_price", "list_price"]));
    const inv = await inventoryAgent(pub, { partNumber: "BVW-S70-200" });
    expect(inv.claims.filter((c) => c.status === "verified").map((c) => c.predicate)).not.toContain("qty_on_hand");
  });
  it("gives sales the P21 contract price and cost with as-of citations", async () => {
    const a = await pricingAgent(makeContext(sql, { principal: sales, channelId: "welsford", mode: "evaluation" }), { partNumber: "BVW-S70-200", customerP21Id: "C-10021" });
    const byPred = Object.fromEntries(a.claims.filter((c) => c.status === "verified").map((c) => [c.predicate, c]));
    expect(byPred.customer_contract_price.value).toBe("212.40");
    expect(byPred.cost.value).toBe("148.20");
    expect(byPred.cost.citations[0].sourceType).toBe("p21");
  });
});

describe("cross reference and product finder", () => {
  it("separates approved substitutes from technically similar alternatives", async () => {
    const sub = await crossReferenceAgent(ctx(), { partNumber: "HLD-2000-2SS" });
    expect((sub.data as any).categories.WELSFORD_APPROVED_SUBSTITUTE[0].sku).toBe("BVW-S70-200");
    const sim = await crossReferenceAgent(ctx(), { partNumber: "HLD-2000-1SS" });
    expect((sim.data as any).categories.WELSFORD_APPROVED_SUBSTITUTE).toEqual([]);
    expect((sim.data as any).categories.TECHNICALLY_SIMILAR_ALTERNATIVE[0].sku).toBe("BVW-S70-100");
  });
  it("never recommends a product whose explicit requirement is unverifiable", async () => {
    const a = await productFinderAgent(ctx(), { text: "1 inch brass ball valve NPT 300 psi" });
    expect(a.outcome).toBe("abstained");
    expect((a.data as any).unverifiable.map((u: any) => u.sku)).toContain("BVW-S40-100");
  });
});

describe("assembly sizing", () => {
  it("computes torque deterministically and refuses when no verified actuator passes", async () => {
    const ok = await assemblyAgent(ctx(), { valvePartNumber: "BVW-S90-300", actuation: "double_acting", supplyPressurePsi: 80, safetyFactor: 1.25 });
    expect((ok.data as any).requiredTorqueInLb).toBe(437.5);
    expect((ok.data as any).bom.map((b: any) => b.sku)).toEqual(["BVW-S90-300", "CVA-RA-085-DA", "CVA-BK-F07-S90"]);
    const no = await assemblyAgent(ctx(), { valvePartNumber: "BVW-S70-200", actuation: "spring_return", supplyPressurePsi: 80, safetyFactor: 1.5 });
    expect(no.outcome).toBe("abstained");
    const nodata = await assemblyAgent(ctx(), { valvePartNumber: "BVW-S70-200", actuation: "double_acting", supplyPressurePsi: 60, safetyFactor: 1.25 });
    expect(nodata.outcome).toBe("abstained");
  });
});

describe("reconciliation", () => {
  it("reports Shopify↔P21 discrepancies", async () => {
    const r = await reconcileShopifyP21(sql);
    expect(r.unmappedShopifySkus.map((x) => x.sku)).toContain("CVA-FR-14");
    expect(r.duplicateSkus.map((x) => x.p21ItemId)).toContain("BVW-S70-200");
    expect(r.priceDiscrepancies).toContainEqual({ sku: "BVW-S70-100", shopifyPrice: 199, p21EcommercePrice: 189 });
    expect(r.uomConflicts.map((x) => x.sku)).toContain("CVA-LS-2");
  });
});

describe("human review → regression loop", () => {
  it("resolving a conflict makes the attribute answerable; corrections become human overrides; reports become regression cases", async () => {
    mutated = true;
    const admin = (await loadPrincipalByEmail(sql, "admin@welsford.example"))!;
    const [conflict] = await sql`SELECT c.id, c.assertion_ids FROM knowledge_conflicts c JOIN product_variants v ON v.id = c.subject_id WHERE v.canonical_sku = 'BVW-S40-100' AND c.status = 'open'`;
    const [winner] = await sql`SELECT id FROM knowledge_assertions WHERE id = ANY(${conflict.assertionIds}) AND value_number = 600`;
    await resolveConflict(sql, conflict.id, winner.id, admin.userId!, "Datasheet Rev B confirmed by factory");
    const { rebuildAttributeProjection } = await import("../src/knowledge/projection.ts");
    await rebuildAttributeProjection(sql);
    const a = await productSpecsAgent(ctx(), { partNumber: "BVW-S40-100", predicates: ["pressure_rating_psi"] });
    expect(a.outcome).toBe("answered");
    expect(a.claims.find((c) => c.predicate === "pressure_rating_psi" && c.status === "verified")?.value).toBe("600");

    // Correction: engineer overrides S70-050 Cv (previously unknown) → new human_approved assertion with override source
    const [v] = await sql`SELECT id FROM product_variants WHERE canonical_sku = 'BVW-S70-050'`;
    const [tmp] = await sql`INSERT INTO knowledge_assertions (subject_type, subject_id, predicate, value_number, status, criticality) VALUES ('variant', ${v.id}, 'cv', 14, 'pending', 4) RETURNING id`;
    const newId = await correctAssertion(sql, { assertionId: tmp.id, userId: admin.userId!, valueNumber: 15, justification: "Factory Cv table 2026" });
    const fixed = await productSpecsAgent(ctx(), { partNumber: "BVW-S70-050", predicates: ["cv"] });
    expect(fixed.claims.find((c) => c.predicate === "cv" && c.status === "verified")?.support.assertionId).toBe(newId);
    expect(fixed.claims.find((c) => c.predicate === "cv")?.citations[0].sourceType).toBe("human_override");

    // Report an incorrect answer → regression case that the evaluation runner executes
    const run = await productSpecsAgent(ctx(), { partNumber: "BVW-S70-200", predicates: ["cv"] });
    const { caseId } = await reportIncorrectAnswer(sql, { runId: run.runId!, userId: admin.userId!, incorrectOutput: run.summary, correctedAnswer: { outcome: "answered", claims: [{ subject: "BVW-S70-200", predicate: "cv", value: "260", severity: 1 }] }, rootCause: "test: exercising the regression loop" });
    const [ec] = await sql`SELECT * FROM evaluation_cases WHERE id = ${caseId}`;
    expect(ec.isRegression).toBe(true);
    const evalRes = await runEvaluation(sql, { onlyIds: [caseId] });
    expect(evalRes.metrics.regressionCases).toBe(1);
    expect(evalRes.metrics.regressionPassed).toBe(1);
  });
});
