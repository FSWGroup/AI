# Product Vision — Welsford Product Intelligence

## What it is

Welsford Product Intelligence (WPI) is a **verified industrial knowledge and decision layer** for F.S. Welsford Co. (manufacturer's rep / distributor, territory-restricted "welsford" channel) and ValveMan (national ecommerce, "valveman" channel). Agents sit on top of that layer and answer a fixed set of question types about valves, actuators, accessories and steam specialties.

The system is built around one rule: **it only says things it can prove from a stored, versioned piece of evidence.** Every answer is a set of claims; every claim is either verified against a `source_record` and cited, or removed with a reason. If a critical claim cannot be verified the system abstains. The LLM is never a source of truth.

Headline requirement: ≥ 99.9% claim-level precision on the questions the system elects to answer. Abstention is a success; a confident wrong answer is a failure. See `accuracy-strategy.md` and `release-gates.md`.

## Where the code lives

| Area | Path |
|---|---|
| Monorepo root (npm workspaces) | `/home/user/AI` |
| Core package (`@wpi/core`, all logic) | `/home/user/AI/packages/core` |
| Schema | `packages/core/migrations/0001_init.sql` |
| Agents | `packages/core/src/agents/*.ts` |
| Answer gate | `packages/core/src/gate/answerGate.ts` |
| Evaluation | `packages/core/src/eval/*.ts`, `/home/user/AI/eval/golden/*.json` |
| Web app (`@wpi/web`, Next.js) | `/home/user/AI/apps/web` — package.json only at this time; no UI source yet |
| Fixture data (all invented) | `packages/core/fixtures/` |

All fixture manufacturers (Bramwell Valve Works, Corvin Actuation, Halden Valve, Stratton Steam) are fictional. Every fixture source row carries `is_fixture = true` and citations are prefixed `[FIXTURE]` (`src/knowledge/evidence.ts`, `citationFor`).

## Users

### Welsford internal roles (`roles` table, seeded in `src/ingest/seedCatalog.ts`)

| Role | Permissions | Typical use |
|---|---|---|
| `admin` | view_cost, view_customer_pricing, view_inventory, view_internal, review_knowledge, write_crm, manage_users, view_territory_rules | Everything, including Knowledge Review |
| `app_engineer` | view_customer_pricing, view_inventory, view_internal, review_knowledge, view_territory_rules | Specs, cross-reference, assembly sizing, resolving conflicts / approving assertions |
| `sales` | view_cost, view_customer_pricing, view_inventory, view_internal, write_crm, view_territory_rules | Part lookup, eligibility by state, pricing incl. cost, RFQ → BOM |
| `cs` | view_customer_pricing, view_inventory, view_internal | Availability, pricing, document finder |

### ValveMan-side principals

| Role | Permissions | Notes |
|---|---|---|
| `customer` | view_own_pricing, view_public_inventory | Authenticated customer; sees own contract price only when `users.customer_id` matches the pricing context |
| `public` | view_public_inventory | Anonymous ValveMan assistant; `PUBLIC_PRINCIPAL` in `src/auth/rbac.ts` |

Public/customer principals may only act in the `valveman` channel (`allowedChannels`). RBAC is enforced in the data layer: the gate removes claims on restricted predicates (`restrictedPredicatesFor`), it is not a prompt instruction.

## Capabilities today (in code)

Each capability is an agent in `src/agents/` and goes through the same gate.

| Capability | Agent | What it does today |
|---|---|---|
| Part lookup | `partLookup.ts` | Resolves an identifier (canonical SKU, mfr part number, P21 item, Shopify SKU, UPC, historical/superseded number, alias, competitor number) to exactly one variant; returns key attributes. Fuzzy/prefix hits are listed as candidates only, never asserted. |
| Product specs | `productSpecs.ts` | "What is the pressure rating of X" — maps question words to attribute keys deterministically (`PREDICATE_SYNONYMS`), answers from verified assertions, abstains if the requested attribute is missing. |
| Product finder | `productFinder.ts` | Natural-language requirements → deterministic extraction (`src/requirements/extract.ts`) → filter over the verified projection → requirement matrix (MATCH / MISMATCH / UNKNOWN) per candidate → per-channel eligibility. Returns multiple ranked products; never forces one. |
| Cross reference | `crossReference.ts` | Four categories kept separate: manufacturer-approved substitute, Welsford-approved substitute, technically similar (explicitly NOT a substitute), possible match requiring review. Plus supersession history. |
| Eligibility | `eligibility.ts` + `src/rules/channelEngine.ts` | "Can Welsford sell X in NJ?" from `channel_rules` rows (territory, customer class, priority). Unknown when no rule exists → abstain. |
| Pricing | `commercial.ts` (`pricingAgent`) | List / ecommerce / contract / cost from `customer_pricing`, stating system and as-of time. Cost only with `view_cost`. |
| Inventory | `commercial.ts` (`inventoryAgent`) | Available / on hand / committed / on order / lead time from `inventory`, P21 preferred over Shopify. |
| Document finder | `documentFinder.ts` | Finds current document versions linked to a variant through assertion evidence, then by manufacturer + series title, else full-text search over `document_pages`. |
| Actuated assembly | `assembly.ts` | Deterministic torque sizing (break torque × safety factor vs. verified actuator torque at 80 psi), mounting from explicit `mounted_with` relationships incl. required bracket kits, optional solenoid / limit switch from `compatible_with`. Abstains without supply pressure and safety factor; no interpolation. |
| RFQ → BOM | `rfqBom.ts` | Parses pasted RFQ text line by line, resolves each line with the same identifier retrieval, persists `rfqs` / `rfq_lines`, flags every non-exact line for review. |
| Ask router | `ask.ts` | Deterministic intent classification → one of the above. Unclassifiable questions abstain. |

Cross-cutting, also in code: knowledge conflicts and human review (`src/knowledge/conflicts.ts`, `src/review/reviews.ts`), Shopify and P21 sync with reconciliation (`src/connectors`, `src/ingest`), run recording with claims / citations / retrieval trace (`src/agents/context.ts`), the evaluation runner and release gate (`src/eval`).

## Planned (not in code)

- Web UI: `apps/web` is a Next.js 15 package stub with no source files.
- PDF ingestion pipeline: `seedCatalog.ts` states that a manufacturer-PDF pipeline should produce the same document → version → page → source_record shape; no PDF parser exists.
- Shadow-mode runner: `agent_runs.mode = 'shadow'` exists in the schema and `AgentContext.mode`, but nothing schedules shadow runs against live traffic.
- Live P21 API: `P21ApiConnector` is an unvalidated scaffold (see `prophet21-integration.md`).
- Shopify webhooks, collections, media, per-location inventory (see `shopify-integration.md`).
- CRM push: `opportunities` table with `crm_system = 'pipedrive'` default; no connector.
- Email ingestion for RFQs: `rfqs.source_kind = 'email'` is accepted, but input is pasted text.
- Vector retrieval: `disabledVectorRetriever` adapter in `src/retrieval/fts.ts`; disabled unless pgvector and embeddings are configured, and never usable as evidence.
- LLM explanation: `LlmProvider.explain()` exists but no agent calls it.
- Tests: `vitest.config.ts` targets `test/**/*.test.ts`; no `test/` directory exists yet.

## Worked example (fixture data)

Question via `askAgent`: "What is the pressure rating of Bramwell S70-200?"

1. `classify` extracts identifier candidates, `lookupPartNumber` stage 2b strips the manufacturer alias and resolves `S70-200` → variant `BVW-S70-200` (match type `normalized`). `predicatesFromQuestion` maps "pressure rating" → `pressure_rating_psi`. Intent: `product_specs`.
2. `productSpecsAgent` proposes identity claims (identifier, canonical SKU, manufacturer — criticality 2, critical) and one attribute claim `pressure_rating_psi = 1000` (criticality 4, critical) backed by the assertion's evidence: datasheet BVW-70-DS Rev C page with supporting text containing "1000".
3. The gate checks: RBAC, evidence exists, assertion `verified`, no open conflict, source `mfr_document` (authority 2 ≤ 6, allowed for a technical predicate), revision current, `last_verified_at` within 3 years, supporting text in record and contains `1000`.
4. Outcome `answered`, confidence `VERIFIED`, `humanReviewRecommended = true` (criticality 4). Citation label: `[FIXTURE] Bramwell Series 70 … Datasheet (BVW-70-DS) Rev C, p.2`.

Same question for `S40-100`: two eligible sources disagree (600 vs 800 WOG), the assertions are `conflicting` and a `knowledge_conflicts` row is open → the critical claim is `removed_conflict` → outcome `abstained`, `INSUFFICIENT_EVIDENCE`, `resolvingSources = ["Resolve the open knowledge conflict on pressure_rating_psi in Knowledge Review"]`, and a `human_escalations` row is created.

## Non-goals

- **Not "ChatGPT with PDFs".** There is no free-form generation path. `NullProvider` is the default LLM; with it disabled every agent still works. When enabled, the LLM produces zod-validated *hints* (requirement fields, RFQ line splits, an intent plan) that deterministic code re-verifies against literal text.
- **Not a recommender that picks one product.** Product finder returns every verified match; it asks for missing requirements instead of guessing.
- **Not a merchandising CMS.** Shopify copy is never a technical authority (`sourceTypeAllowedForPredicate`).
- **Not an ERP.** P21 is the system of record for inventory, cost and customer pricing; WPI holds dated projections and always states the as-of time.
- **Not a place where the model resolves disagreements.** Conflicting eligible sources block the attribute until a human resolves it (`resolveConflict`, `correctAssertion`).

## Rollout phases

Phase names below are the intended sequence; only the mechanisms marked "in code" exist.

| Phase | Scope | Mechanism |
|---|---|---|
| 1. Shadow mode | Run agents against real questions without showing answers; compare to what humans said. | `agent_runs.mode = 'shadow'` and `mode = 'evaluation'` exist; runner/eval record every claim and citation. Scheduling against live traffic is planned. |
| 2. Internal users | Welsford `admin`, `app_engineer`, `sales`, `cs` on the welsford channel. All outcomes recorded; incorrect answers reported via `reportIncorrectAnswer` become regression cases. | In code: RBAC, run recording, review center actions, regression case creation. |
| 3. Low-risk ValveMan customers | `public` / `customer` principals, valveman channel, low-criticality questions (part lookup, documents, public availability). | In code: `PUBLIC_PRINCIPAL`, `allowedChannels`, `restrictedPredicatesFor`. |
| 4. Validated selection categories | Product finder for categories where the golden dataset proves precision (ball valves, butterfly valves, actuators, steam traps in fixtures). | In code: category-level metrics in `computeMetrics.byCategory`; release gate per category for pricing, inventory, territory_eligibility. |
| 5. Complex workflows | Actuated assemblies, RFQ → BOM → quote, CRM push. | In code: assembly and RFQ agents (both always `humanReviewRecommended` when anything is unresolved); quotes/opportunities tables exist without a quoting flow. |

Every phase is gated by `releaseGate()` in `src/eval/runner.ts`; see `release-gates.md`. Scope is widened only by adding golden cases that pass, and narrowed (never loosened) when precision falls short.
