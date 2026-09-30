/**
 * "Ask" router: deterministic intent classification → specialized agent. The LLM (when enabled) is only consulted
 * to propose a plan for questions the deterministic classifier cannot place, and the plan is validated with zod
 * before use. Unclassifiable questions abstain — they are never free-generated.
 */
import { z } from "zod";
import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun } from "./context.ts";
import type { Answer } from "../answer/types.ts";
import { extractIdentifierCandidates } from "../identifiers.ts";
import { partLookupAgent } from "./partLookup.ts";
import { productSpecsAgent, predicatesFromQuestion } from "./productSpecs.ts";
import { productFinderAgent } from "./productFinder.ts";
import { crossReferenceAgent } from "./crossReference.ts";
import { eligibilityAgent } from "./eligibility.ts";
import { inventoryAgent, pricingAgent } from "./commercial.ts";
import { documentFinderAgent } from "./documentFinder.ts";
import { assemblyAgent } from "./assembly.ts";
import { lookupPartNumber } from "../retrieval/partLookup.ts";

export type Intent = "part_lookup" | "product_specs" | "product_finder" | "cross_reference" | "eligibility" | "pricing" | "inventory" | "document_finder" | "assembly" | "unknown";

const STATE_RE = /\b(?:in|to|for)\s+(?:a\s+customer\s+in\s+)?(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
const STATE_NAMES: Record<string, string> = { pennsylvania: "PA", "new jersey": "NJ", delaware: "DE", maryland: "MD", "new york": "NY", texas: "TX", california: "CA", ohio: "OH", virginia: "VA" };

export async function classify(ctx: AgentContext, q: string): Promise<{ intent: Intent; partNumber: string | null; state: string | null; channel: "welsford" | "valveman" | null }> {
  const ids = extractIdentifierCandidates(q);
  let partNumber: string | null = null;
  for (const id of ids) { const m = await lookupPartNumber(ctx.sql, id, { allowFuzzy: false }); if (m.length) { partNumber = id; break; } }
  if (!partNumber && ids.length) partNumber = ids[0];
  let state = STATE_RE.exec(q)?.[1] ?? null;
  if (!state) for (const [name, code] of Object.entries(STATE_NAMES)) if (new RegExp(`\\b${name}\\b`, "i").test(q)) { state = code; break; }
  const channel = /\bvalveman\b|\bonline\b|\bwebsite\b|\becommerce\b/i.test(q) ? "valveman" : /\bwelsford\b/i.test(q) ? "welsford" : null;
  const has = (re: RegExp) => re.test(q);
  let intent: Intent = "unknown";
  if (has(/\bactuat(?:e|ed|or)\b.*\b(assembly|size|sizing|build|package)\b|\b(size|build)\b.*\bactuator\b|\bspring[- ]return\b.*\b(for|on)\b.*\b(valve|S70|S90)\b/i) && partNumber) intent = "assembly";
  else if (has(/\b(iom|manual|datasheet|data sheet|cut sheet|drawing|certificate|p\/?t chart|pressure[- ]temperature chart|document|bulletin|spec sheet)\b/i)) intent = "document_finder";
  else if (has(/\b(cross[- ]?ref(?:erence)?s?|substitut\w*|equivalents?|replace(?:ment|s|d)?|alternatives?|interchange\w*|xref|instead of)\b/i) && partNumber) intent = "cross_reference";
  else if (has(/\b(price|pricing|cost|how much|quote price|\$)\b/i) && partNumber) intent = "pricing";
  else if (has(/\b(stock|inventory|availab|on hand|lead time|in stock|how many)\b/i) && partNumber) intent = "inventory";
  else if (has(/\b(can (?:we|welsford|valveman|you) sell|authorized|territory|eligib|allowed to sell|sell (?:this|it|to))\b/i) && partNumber) intent = "eligibility";
  else if (partNumber && predicatesFromQuestion(q).length) intent = "product_specs";
  else if (has(/\b(i need|looking for|need a|recommend|find me|find a|which valve|what valve|select|options? for)\b/i) || (!partNumber && has(/\bvalve|actuator|trap\b/i) && has(/\d/))) intent = "product_finder";
  else if (partNumber && (has(/\bwhat is\b|\bwhat's\b|\bidentify\b|\blook ?up\b|\bpart number\b/i) || ids.length === q.trim().split(/\s+/).length)) intent = "part_lookup";
  else if (partNumber && q.trim().split(/\s+/).length <= 3) intent = "part_lookup";
  return { intent, partNumber, state, channel };
}

const PlanSchema = z.object({ intent: z.enum(["part_lookup", "product_specs", "product_finder", "cross_reference", "eligibility", "pricing", "inventory", "document_finder", "assembly", "unknown"]), partNumber: z.string().nullable(), predicates: z.array(z.string()).optional() });

export async function askAgent(ctx: AgentContext, question: string, opts: { customerP21Id?: string | null } = {}): Promise<Answer> {
  const t0 = Date.now();
  let c = await classify(ctx, question);
  let llmUsed = false;
  if (c.intent === "unknown" && ctx.llm.enabled) {
    const plan = await ctx.llm.extractJson("Classify this product question into one intent and extract the part number if present, as {intent, partNumber, predicates}.", question, PlanSchema);
    if (plan) { llmUsed = true; c = { ...c, intent: plan.value.intent, partNumber: plan.value.partNumber ?? c.partNumber }; }
  }
  const channel = c.channel ?? ctx.channelId;
  let answer: Answer;
  switch (c.intent) {
    case "part_lookup": answer = await partLookupAgent(ctx, c.partNumber ?? question); break;
    case "product_specs": answer = await productSpecsAgent(ctx, { partNumber: c.partNumber!, predicates: predicatesFromQuestion(question), question }); break;
    case "product_finder": answer = await productFinderAgent(ctx, { text: question, channel, state: c.state }); break;
    case "cross_reference": answer = await crossReferenceAgent(ctx, { partNumber: c.partNumber! }); break;
    case "eligibility": answer = await eligibilityAgent(ctx, { partNumber: c.partNumber!, channel, state: c.state }); break;
    case "pricing": answer = await pricingAgent(ctx, { partNumber: c.partNumber!, channel, customerP21Id: opts.customerP21Id }); break;
    case "inventory": answer = await inventoryAgent(ctx, { partNumber: c.partNumber! }); break;
    case "document_finder": answer = await documentFinderAgent(ctx, { query: question, partNumber: c.partNumber }); break;
    case "assembly": {
      const sf = /safety factor\s*(?:of\s*)?(\d+(?:\.\d+)?)/i.exec(question)?.[1]; const sp = /(\d+)\s*psi\s*(?:air\s*)?supply|supply\s*(?:pressure\s*)?(?:of\s*)?(\d+)\s*psi/i.exec(question);
      answer = await assemblyAgent(ctx, { valvePartNumber: c.partNumber!, actuation: /double[- ]acting/i.test(question) ? "double_acting" : "spring_return", supplyPressurePsi: sp ? Number(sp[1] ?? sp[2]) : null, safetyFactor: sf ? Number(sf) : null, solenoidVoltage: /(\d+\s*V(?:AC|DC))/i.exec(question)?.[1] ?? null, includeLimitSwitch: /limit switch/i.test(question) }); break;
    }
    default: {
      const g = await gate(ctx, []); g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
      answer = buildAnswer({ agent: "ask", question, input: { question }, criticality: 3, gate: g, unknown: ["The question could not be mapped to a verified answering capability (part lookup, specifications, product finder, cross reference, eligibility, pricing, inventory, documents, assemblies)"], resolvingSources: ["Rephrase with a part number or product requirements, or route to a Welsford specialist"], humanReview: true, llmUsed });
      await recordRun(ctx, answer, Date.now() - t0);
    }
  }
  answer.data = { ...(answer.data ?? {}), routedIntent: c.intent, routedPartNumber: c.partNumber, routedState: c.state };
  answer.input = { question, customerP21Id: opts.customerP21Id ?? null };
  answer.llmUsed = answer.llmUsed || llmUsed;
  return answer;
}
