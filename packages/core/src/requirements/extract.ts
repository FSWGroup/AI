/**
 * Natural-language → structured requirements. Deterministic pattern extraction first; the LLM (if enabled) may
 * propose additional fields, but every LLM-proposed field is marked INFERRED unless the literal text supports it.
 * Every field carries provenance: EXPLICIT (stated), INFERRED (derived), UNKNOWN (needed, not stated).
 */
import { z } from "zod";
import type { LlmProvider } from "../llm/provider.ts";

export type Provenance = "EXPLICIT" | "INFERRED" | "UNKNOWN";
export interface RequirementField { key: string; value: string | number | null; provenance: Provenance; sourceText?: string; note?: string }
export interface Requirements { fields: RequirementField[]; freeText: string; llmUsed: boolean }

const fraction = (s: string): number => {
  s = s.replace(/["”]/g, "").replace(/\s*(in|inch|inches)$/i, "").trim();
  const m = /^(\d+)-(\d+)\/(\d+)$/.exec(s); if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  const f = /^(\d+)\/(\d+)$/.exec(s); if (f) return Number(f[1]) / Number(f[2]);
  return Number(s);
};

const MATERIALS: [RegExp, string][] = [
  [/\b(316|304)?\s*(stainless|ss|sst)\b(\s*steel)?/i, "stainless"],
  [/\bbrass\b/i, "brass"],
  [/\bbronze\b/i, "bronze"],
  [/\bcarbon steel\b|\bwcb\b|\ba105\b/i, "carbon steel"],
  [/\bductile iron\b|\bdi\b/i, "ductile iron"],
  [/\bcast iron\b/i, "cast iron"],
  [/\bpvc\b/i, "PVC"],
  [/\bcpvc\b/i, "CPVC"],
  [/\baluminum\b/i, "aluminum"],
];
const TYPES: [RegExp, string][] = [
  [/\bball valves?\b/i, "ball_valve"], [/\bbutterfly valves?\b|\bbfv\b/i, "butterfly_valve"], [/\bcheck valves?\b/i, "check_valve"],
  [/\bgate valves?\b/i, "gate_valve"], [/\bglobe valves?\b/i, "globe_valve"], [/\bsteam traps?\b/i, "steam_trap"],
  [/\bsolenoid valves?\b|\bsolenoid\b/i, "solenoid_valve"], [/\blimit switch(?:es)?\b|\bswitch box\b/i, "limit_switch"],
  [/\b(pneumatic|rack\s*(and|&)\s*pinion)\s+actuators?\b/i, "pneumatic_actuator"], [/\belectric actuators?\b/i, "electric_actuator"],
];
const ENDS: [RegExp, string][] = [
  [/\bnpt\b|\bthreaded\b|\bfnpt\b|\bthread(ed)? ends?\b/i, "NPT"], [/\bwafer\b/i, "wafer"], [/\blug\b/i, "lug"],
  [/\bflanged?\b.*\b300\b|\bclass 300\b/i, "flanged_300"], [/\bflanged?\b|\bclass 150\b|\b150#\b/i, "flanged_150"],
  [/\bsocket weld\b|\bsw\b/i, "socket_weld"], [/\bbutt weld\b|\bbw\b/i, "butt_weld"], [/\btri[- ]?clamp\b|\bsanitary clamp\b/i, "tri_clamp"],
];
const MEDIA: [RegExp, string][] = [
  [/\bcompressed air\b|\binstrument air\b|\bair\b/i, "air"], [/\bsteam\b/i, "steam"], [/\bpotable water\b|\bdrinking water\b/i, "potable water"],
  [/\bwater\b/i, "water"], [/\bnatural gas\b|\bgas\b/i, "gas"], [/\boil\b/i, "oil"], [/\bchemical\b|\bacid\b|\bcaustic\b/i, "chemical"],
];

export function extractRequirementsDeterministic(text: string): Requirements {
  const fields: RequirementField[] = [];
  const add = (key: string, value: string | number | null, provenance: Provenance, sourceText?: string, note?: string) => { if (!fields.some((f) => f.key === key)) fields.push({ key, value, provenance, sourceText, note }); };

  const size = /(\d+(?:-\d+\/\d+)?|\d+\/\d+|\d+(?:\.\d+)?)\s*(?:["”]|-?\s*(?:inch|in\b)(?:es)?)/i.exec(text);
  if (size) add("size_in", fraction(size[1]), "EXPLICIT", size[0]);
  for (const [re, v] of TYPES) { const m = re.exec(text); if (m) { add("product_type", v, "EXPLICIT", m[0]); break; } }
  for (const [re, v] of MATERIALS) { const m = re.exec(text); if (m) { add("body_material", v, "EXPLICIT", m[0]); break; } }
  for (const [re, v] of ENDS) { const m = re.exec(text); if (m) { add("end_connection", v, "EXPLICIT", m[0]); break; } }
  const psi = /(\d+(?:\.\d+)?)\s*(psig?|wog|bar)\b/i.exec(text);
  if (psi) { const val = /bar/i.test(psi[2]) ? Number(psi[1]) * 14.5038 : Number(psi[1]); add("min_pressure_psi", Math.round(val * 100) / 100, "EXPLICIT", psi[0], /bar/i.test(psi[2]) ? "converted from bar" : undefined); }
  const temp = /(-?\d+(?:\.\d+)?)\s*(?:°|deg(?:rees)?)?\s*([FC])\b/.exec(text);
  if (temp) { const val = temp[2] === "C" ? Number(temp[1]) * 9 / 5 + 32 : Number(temp[1]); add("max_temp_f", Math.round(val * 10) / 10, "EXPLICIT", temp[0], temp[2] === "C" ? "converted from °C" : undefined); }
  for (const [re, v] of MEDIA) { const m = re.exec(text); if (m) { add("media", v, "EXPLICIT", m[0]); break; } }
  if (/\bspring[- ]return\b|\bfail[- ](safe|closed?|open)\b/i.test(text)) add("actuation", "spring_return", "EXPLICIT", /\bspring[- ]return\b|\bfail[- ](safe|closed?|open)\b/i.exec(text)![0]);
  else if (/\bdouble[- ]acting\b/i.test(text)) add("actuation", "double_acting", "EXPLICIT", "double acting");
  const fail = /\bfail[- ](closed?|open)\b/i.exec(text);
  if (fail) add("fail_position", fail[1].toLowerCase().startsWith("c") ? "closed" : "open", "EXPLICIT", fail[0]);
  if (/\bpneumatic\b/i.test(text)) add("actuator_power", "pneumatic", "EXPLICIT", "pneumatic");
  else if (/\belectric(al)?\b/i.test(text)) add("actuator_power", "electric", "EXPLICIT", "electric");
  else if (fields.some((f) => f.key === "actuation" && f.value === "spring_return")) add("actuator_power", "pneumatic", "INFERRED", undefined, "spring-return implies pneumatic unless stated");
  const volt = /(\d+)\s*(vac|vdc|v)\b/i.exec(text);
  if (volt) add("voltage", `${volt[1]} ${volt[2].toUpperCase()}`, "EXPLICIT", volt[0]);
  const supply = /(\d+)\s*psi[g]?\s*(supply|air supply|instrument air)/i.exec(text) ?? /(supply|air supply)\s*(?:pressure)?\s*(?:of|at|=)?\s*(\d+)\s*psi/i.exec(text);
  if (supply) add("supply_pressure_psi", Number(supply[1].match(/\d+/) ? supply[1] : supply[2]), "EXPLICIT", supply[0]);
  if (/\bfull[- ]port\b/i.test(text)) add("port_configuration", "full_port", "EXPLICIT", "full port");
  if (/\blead[- ]free\b|\bnsf\b/i.test(text)) add("lead_free", true as unknown as string, "EXPLICIT", "lead-free");
  if (/\bhazardous\b|\bclass 1\b|\bdiv(ision)? [12]\b|\bexplosion[- ]proof\b/i.test(text)) add("hazardous_area", "required", "EXPLICIT", "hazardous");

  // Media-driven inferences (labeled) and required-but-unknown fields
  const media = fields.find((f) => f.key === "media")?.value;
  if (media === "steam") add("steam_service", true as unknown as string, "INFERRED", undefined, "steam media requires steam rating");
  const productType = fields.find((f) => f.key === "product_type")?.value;
  const required: Record<string, string[]> = {
    ball_valve: ["max_temp_f", "min_pressure_psi", "media", "seat_material", "certifications"],
    butterfly_valve: ["max_temp_f", "min_pressure_psi", "media", "seat_material"],
    steam_trap: ["min_pressure_psi", "max_temp_f", "condensate_load"],
    pneumatic_actuator: ["supply_pressure_psi", "fail_position", "valve_torque"],
    default: ["max_temp_f", "min_pressure_psi", "media"],
  };
  const need = [...(required[String(productType)] ?? required.default)];
  if (fields.some((f) => f.key === "actuation")) need.push("supply_pressure_psi", "fail_position", "hazardous_area", "voltage");
  for (const k of new Set(need)) if (!fields.some((f) => f.key === k)) fields.push({ key: k, value: null, provenance: "UNKNOWN" });
  return { fields, freeText: text, llmUsed: false };
}

const LlmRequirementSchema = z.object({ fields: z.array(z.object({ key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]), quote: z.string() })) });

/** LLM-assisted extraction: only fields whose `quote` literally appears in the text are accepted as EXPLICIT; the rest are INFERRED. */
export async function extractRequirements(text: string, llm: LlmProvider): Promise<Requirements> {
  const det = extractRequirementsDeterministic(text);
  if (!llm.enabled) return det;
  const res = await llm.extractJson("Extract product selection requirements as {fields:[{key,value,quote}]} using keys: size_in, product_type, body_material, end_connection, min_pressure_psi, max_temp_f, media, actuation, fail_position, voltage, supply_pressure_psi, seat_material, certifications.", text, LlmRequirementSchema);
  if (!res) return det;
  for (const f of res.value.fields) {
    const existing = det.fields.find((d) => d.key === f.key);
    const literal = f.quote && text.toLowerCase().includes(f.quote.toLowerCase());
    if (existing && existing.provenance !== "UNKNOWN") continue;
    const field: RequirementField = { key: f.key, value: f.value as string | number, provenance: literal ? "EXPLICIT" : "INFERRED", sourceText: literal ? f.quote : undefined, note: literal ? undefined : "proposed by model; not literally stated" };
    if (existing) Object.assign(existing, field); else det.fields.push(field);
  }
  det.llmUsed = true;
  return det;
}
