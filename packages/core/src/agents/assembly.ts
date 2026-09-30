/**
 * Actuated assembly builder. All sizing math is deterministic code over VERIFIED torque assertions.
 *   required torque = valve break torque × safety factor
 *   double acting:  actuator output @ supply ≥ required
 *   spring return:  min(spring end torque, air start torque) @ supply ≥ required
 * Mounting compatibility comes only from explicit `mounted_with` relationships (with accessory conditions).
 * Torque data currently exists only at 80 psi supply; any other supply pressure → abstain (no interpolation).
 */
import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun, trace } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { attributeClaims, identityClaims, resolveVariant } from "./partLookup.ts";

export interface AssemblyParams { valvePartNumber: string; actuation: "spring_return" | "double_acting"; supplyPressurePsi?: number | null; safetyFactor?: number | null; solenoidVoltage?: string | null; includeLimitSwitch?: boolean }

export async function assemblyAgent(ctx: AgentContext, p: AssemblyParams): Promise<Answer> {
  const t0 = Date.now();
  const question = `Build a ${p.actuation.replace("_", " ")} actuated assembly for ${p.valvePartNumber}${p.supplyPressurePsi ? ` at ${p.supplyPressurePsi} psi supply` : ""}${p.safetyFactor ? ` with safety factor ${p.safetyFactor}` : ""}`;
  const unknown: string[] = [];
  if (p.supplyPressurePsi == null) unknown.push("Air supply pressure was not provided (required for actuator torque)");
  if (p.safetyFactor == null) unknown.push("Safety factor was not provided (required; depends on media/service — not assumed)");
  const valve = await resolveVariant(ctx, p.valvePartNumber);
  if (!valve) unknown.push(`"${p.valvePartNumber}" does not resolve to exactly one verified catalog item`);
  if (unknown.length) {
    const g = await gate(ctx, []); g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
    const answer = buildAnswer({ agent: "assembly", question, input: { ...p }, criticality: 4, gate: g, unknown, resolvingSources: ["Requester: supply pressure and safety factor (or media/service so engineering can assign one)"], humanReview: true });
    await recordRun(ctx, answer, Date.now() - t0); return answer;
  }
  const claims: ProposedClaim[] = [...identityClaims(valve!)];
  const torqueClaims = await attributeClaims(ctx, valve!.variantId, valve!.canonicalSku, ["break_torque_inlb", "mount_pad_iso5211", "stem_size_mm"]);
  const breakIdx = claims.length + torqueClaims.findIndex((c) => c.predicate === "break_torque_inlb");
  claims.push(...torqueClaims);
  if (breakIdx < claims.length - torqueClaims.length) {
    const g = await gate(ctx, claims); g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
    const answer = buildAnswer({ agent: "assembly", question, input: { ...p }, criticality: 4, gate: g, unknown: [`No verified break torque exists for ${valve!.canonicalSku}`], resolvingSources: ["Manufacturer torque bulletin for this valve"], humanReview: true });
    await recordRun(ctx, answer, Date.now() - t0); return answer;
  }
  claims[breakIdx].critical = true;
  const breakTorque = Number(claims[breakIdx].value);
  const required = Math.round(breakTorque * p.safetyFactor! * 100) / 100;
  const requiredIdx = claims.length;
  claims.push({ subjectRef: `calc:${valve!.canonicalSku}`, predicate: "required_torque_inlb", value: String(required), unit: "in-lb", criticality: 4, kind: "calculation", critical: true,
    support: { sourceRecordIds: [], dependsOn: [breakIdx], formula: `${breakTorque} in-lb × SF ${p.safetyFactor}` }, label: `Required actuator torque for ${valve!.canonicalSku}: ${breakTorque} × ${p.safetyFactor} = ${required} in-lb` });

  // Candidate actuators: explicit mounted_with relationships (actuator → valve)
  const mounts = await trace(ctx, "relationship_traversal", { sku: valve!.canonicalSku, type: "mounted_with" }, () => ctx.sql`
    SELECT r.id, r.conditions, r.status, v.id AS actuator_id, v.canonical_sku, v.name, m.name AS manufacturer,
           coalesce(json_agg(json_build_object('sourceRecordId', e.source_record_id, 'text', e.supporting_text)) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
    FROM product_relationships r JOIN product_variants v ON v.id = r.from_variant_id JOIN products pr ON pr.id = v.product_id JOIN manufacturers m ON m.id = pr.manufacturer_id
    LEFT JOIN relationship_evidence e ON e.relationship_id = r.id
    WHERE r.to_variant_id = ${valve!.variantId} AND r.relationship_type = 'mounted_with' AND pr.category = 'pneumatic_actuator'
    GROUP BY r.id, v.id, m.id ORDER BY v.canonical_sku`, (r) => r.length);
  const supply = p.supplyPressurePsi!;
  const candidates: { sku: string; name: string; manufacturer: string; actuation: string | null; deliverable: number | null; passes: boolean | null; reason: string; claimIdx: number[]; accessory: string | null; mountClaimIdx: number }[] = [];
  for (const m of mounts) {
    const ev = m.evidence as { sourceRecordId: string; text: string | null }[];
    const mountIdx = claims.length;
    claims.push({ subjectRef: m.canonicalSku, predicate: "mounted_with", value: `${m.canonicalSku.replace(/^CVA-/, "")} ${valve!.canonicalSku.replace(/^BVW-/, "")}`, criticality: 4, kind: "relationship", support: { relationshipId: m.id, sourceRecordIds: ev.map((e) => e.sourceRecordId), supportingText: ev[0]?.text ?? undefined }, label: `${m.canonicalSku} mounts to ${valve!.canonicalSku}${m.conditions?.requires_accessory ? ` with ${m.conditions.requires_accessory}` : " (direct mount)"}` });
    const aclaims = await attributeClaims(ctx, m.actuatorId, m.canonicalSku, ["actuation", "torque_output_inlb_80psi", "spring_end_torque_inlb", "air_start_torque_inlb_80psi", "supply_pressure_min_psi", "supply_pressure_max_psi"]);
    const base = claims.length; claims.push(...aclaims);
    const idx = (pred: string) => { const i = aclaims.findIndex((c) => c.predicate === pred); return i < 0 ? -1 : base + i; };
    const actuation = aclaims.find((c) => c.predicate === "actuation")?.value ?? null;
    const cand = { sku: m.canonicalSku, name: m.name, manufacturer: m.manufacturer, actuation, deliverable: null as number | null, passes: null as boolean | null, reason: "", claimIdx: [] as number[], accessory: (m.conditions?.requires_accessory as string) ?? null, mountClaimIdx: mountIdx };
    if (actuation !== p.actuation) { cand.reason = `actuation is ${actuation ?? "unknown"}, requested ${p.actuation}`; candidates.push(cand); continue; }
    if (supply !== 80) { cand.reason = `verified torque data exists only at 80 psi supply; ${supply} psi requested — no interpolation performed`; candidates.push(cand); continue; }
    const smin = idx("supply_pressure_min_psi"), smax = idx("supply_pressure_max_psi");
    if (smin >= 0 && smax >= 0 && (supply < Number(claims[smin].value) || supply > Number(claims[smax].value))) { cand.reason = `supply ${supply} psi outside actuator range`; candidates.push(cand); continue; }
    let deliverable: number; let deps: number[]; let formula: string;
    if (p.actuation === "double_acting") { const i = idx("torque_output_inlb_80psi"); if (i < 0) { cand.reason = "no verified output torque"; candidates.push(cand); continue; } deliverable = Number(claims[i].value); deps = [i]; formula = `DA output @80 psi = ${deliverable}`; }
    else { const a = idx("air_start_torque_inlb_80psi"), s = idx("spring_end_torque_inlb"); if (a < 0 || s < 0) { cand.reason = "no verified spring/air torque"; candidates.push(cand); continue; } deliverable = Math.min(Number(claims[a].value), Number(claims[s].value)); deps = [a, s]; formula = `min(air start ${claims[a].value}, spring end ${claims[s].value}) = ${deliverable}`; }
    const passes = deliverable >= required;
    cand.deliverable = deliverable; cand.passes = passes; cand.reason = passes ? `${deliverable} in-lb ≥ ${required} in-lb required` : `${deliverable} in-lb < ${required} in-lb required`;
    cand.claimIdx.push(claims.length);
    claims.push({ subjectRef: `calc:${m.canonicalSku}`, predicate: "torque_check", value: passes ? "pass" : "fail", criticality: 4, kind: "calculation", support: { sourceRecordIds: [], dependsOn: [requiredIdx, ...deps], formula: `${formula} ${passes ? "≥" : "<"} ${required}` }, label: `${m.canonicalSku}: ${cand.reason}` });
    candidates.push(cand);
  }
  const g = await gate(ctx, claims);
  const verifiedPass = candidates.filter((c) => c.passes && c.claimIdx.every((i) => g.claims[i].status === "verified") && g.claims[c.mountClaimIdx].status === "verified");
  const selected = verifiedPass.sort((a, b) => (a.deliverable ?? 0) - (b.deliverable ?? 0))[0] ?? null;
  const bom: { line: number; sku: string; description: string; qty: number; role: string; basis: string }[] = [];
  const accessoriesUnknown: string[] = [];
  if (selected) {
    bom.push({ line: 1, sku: valve!.canonicalSku, description: valve!.name, qty: 1, role: "valve", basis: "requested" });
    bom.push({ line: 2, sku: selected.sku, description: selected.name, qty: 1, role: "actuator", basis: selected.reason });
    if (selected.accessory) { const acc = await ctx.sql`SELECT name FROM product_variants WHERE canonical_sku = ${selected.accessory}`; bom.push({ line: bom.length + 1, sku: selected.accessory, description: acc[0]?.name ?? selected.accessory, qty: 1, role: "mounting_kit", basis: "required by mounting compatibility chart" }); }
    if (p.solenoidVoltage) {
      const sol = await ctx.sql`SELECT v.canonical_sku, v.name, pa.value_text AS voltage FROM product_relationships r JOIN product_variants v ON v.id = r.from_variant_id JOIN product_variants act ON act.id = r.to_variant_id JOIN product_attributes pa ON pa.variant_id = v.id AND pa.attribute_key = 'voltage' JOIN product_attributes pt ON pt.variant_id = v.id AND pt.attribute_key = 'product_type' AND pt.value_text = 'solenoid_valve' WHERE act.canonical_sku = ${selected.sku} AND r.relationship_type = 'compatible_with' AND r.status IN ('verified','human_approved')`;
      const want = p.solenoidVoltage.replace(/\s+/g, "").toUpperCase();
      const hit = sol.find((s) => String(s.voltage).replace(/\s+/g, "").toUpperCase().startsWith(want));
      if (hit) bom.push({ line: bom.length + 1, sku: hit.canonicalSku, description: hit.name, qty: 1, role: "solenoid", basis: `compatible_with ${selected.sku}; voltage ${hit.voltage}` }); else accessoriesUnknown.push(`No verified ${p.solenoidVoltage} solenoid is recorded as compatible with ${selected.sku}`);
    }
    if (p.includeLimitSwitch) {
      const ls = await ctx.sql`SELECT v.canonical_sku, v.name FROM product_relationships r JOIN product_variants v ON v.id = r.from_variant_id JOIN product_variants act ON act.id = r.to_variant_id JOIN product_attributes pt ON pt.variant_id = v.id AND pt.attribute_key = 'product_type' AND pt.value_text = 'limit_switch' WHERE act.canonical_sku = ${selected.sku} AND r.relationship_type = 'compatible_with' AND r.status IN ('verified','human_approved')`;
      if (ls[0]) bom.push({ line: bom.length + 1, sku: ls[0].canonicalSku, description: ls[0].name, qty: 1, role: "limit_switch", basis: `compatible_with ${selected.sku}` }); else accessoriesUnknown.push(`No verified limit switch is recorded as compatible with ${selected.sku}`);
    }
  }
  if (!selected) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  else if (accessoriesUnknown.length) { g.outcome = "partial"; g.confidence = "NEEDS_REVIEW"; }
  const answer = buildAnswer({
    agent: "assembly", question, input: { ...p }, criticality: 4, gate: g,
    data: { valve: valve!.canonicalSku, breakTorqueInLb: breakTorque, safetyFactor: p.safetyFactor, requiredTorqueInLb: required, supplyPressurePsi: supply, actuation: p.actuation, candidates, selected: selected?.sku ?? null, bom, accessoriesUnknown },
    known: g.claims.filter((c) => c.status === "verified").map((c) => c.label ?? c.predicate),
    unknown: selected ? accessoriesUnknown : [`No verified ${p.actuation.replace("_", " ")} actuator with a mounting relationship to ${valve!.canonicalSku} delivers ≥ ${required} in-lb at ${supply} psi`, ...candidates.map((c) => `${c.sku}: ${c.reason}`)],
    resolvingSources: selected ? [] : ["Application engineering: larger actuator with a verified mounting kit, or revised safety factor"],
    humanReview: true, // criticality 4: engineering-sensitive; human confirmation required before quoting
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
