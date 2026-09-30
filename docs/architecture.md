# Architecture

Everything described here is in `/home/user/AI/packages/core` unless stated otherwise. File paths are relative to `packages/core/src/`.

## Layers

```
sources ──▶ documents / document_versions / document_pages
   │
   └──▶ source_records  (atomic, versioned, checksummed evidence: a page, an API record, an approved note)
              │
              ▼
knowledge_assertions ◀── assertion_evidence ──▶ source_records
product_relationships ◀── relationship_evidence ──▶ source_records
channel_rules.source_record_id ──▶ source_records
customer_pricing / inventory .source_record_id ──▶ source_records
              │
              ▼  rebuildAttributeProjection()  (knowledge/projection.ts)
product_attributes   (projection of verified / human_approved, non-conflicting variant assertions)
              │
              ▼
retrieval  (retrieval/partLookup.ts, attributeFilter.ts, fts.ts; rules/channelEngine.ts)
              │
              ▼
agents  (agents/*.ts) assemble ProposedClaim[] from retrieved rows — never from prose
              │
              ▼
gate  (gate/answerGate.ts) verifies each claim against evidence → GatedClaim[] with citations
              │
              ▼
Answer { claims, citations, summary built from verified claims only }  → recordRun() → agent_runs / claims / citations / retrieval_events
```

Design rules stated at the top of `migrations/0001_init.sql`:

1. Every technical/commercial fact is a `knowledge_assertion` with `assertion_evidence` rows pointing at versioned `source_records`. Nothing in `products` / `product_attributes` is answerable without evidence.
2. Relationships (substitutes, compatibility, supersession) are explicit rows with evidence and `approval_authority`.
3. Channel/territory logic lives in rule tables compiled by the rule engine, not in prose.
4. Fixture data is flagged at the source level (`sources.is_fixture`) and can never be mistaken for production.

## Retrieval order

The retrieval stages match the `retrieval_events.stage` vocabulary in the schema. Stages actually implemented:

| # | Stage | Implementation | Notes |
|---|---|---|---|
| 1 | Exact normalized identifier | `lookupPartNumber` stage 1/2, `retrieval/partLookup.ts` | `identifier_norm` equality on canonical_sku, mfr_part_number, p21_item_id, shopify_sku, upc. Match type `exact` only if raw text matches case-insensitively, else `normalized`. |
| 2 | Manufacturer + identifier | same function: `manufacturer` option filter, and stage 2b strips a leading manufacturer code/name/alias ("Bramwell S70-200") | |
| 3 | Alternate / historical | stage 3: historical_part_number, superseded_part_number, alias, competitor_part_number → `historical` or `competitor_xref` | |
| 3b/3c | Prefix, trigram fuzzy | only when `allowFuzzy`; `pg_trgm similarity > 0.45`; capped by `limit` | Never labeled exact; `resolveVariant` discards them. Only `partLookupAgent`, `rfqBomAgent` and the cross-reference "no match" path allow fuzzy. |
| 4 | Attribute filter | `filterByAttributes`, `retrieval/attributeFilter.ts` | Runs over `product_attributes` only, so every hit is already evidence-backed. Ops: eq, in, gte, lte, num_eq, contains. Active variants only. |
| 5 | Relationship traversal | inline SQL in `agents/crossReference.ts`, `agents/assembly.ts` | `product_relationships` + `relationship_evidence`. |
| 6 | Full-text search | `searchProductsText`, `searchDocumentPages` in `retrieval/fts.ts` | Postgres tsvector (`products.search_tsv`, `document_pages.search_tsv`, maintained by triggers). Document search defaults to current versions only. |
| 7 | Vector | `disabledVectorRetriever` | Adapter interface only; disabled unless pgvector + embeddings; documented as never usable as evidence. |
| 8 | Evidence validation | `runAnswerGate`, `gate/answerGate.ts` | See `accuracy-strategy.md`. |
| 9 | Rule filter | `decideEligibility`, `rules/channelEngine.ts`; RBAC `restrictedPredicatesFor` applied inside the gate | |

Identifier normalization (`identifiers.ts`): NFKC, upper-case, strip whitespace and `- _ . / \ , ; : ( ) [ ]`. The raw identifier is always stored beside the normalized one; match semantics are decided in retrieval, not in normalization.

## Agents

All agents share `AgentContext` (`agents/context.ts`): `sql`, `principal`, `channelId`, optional `state` / `customerId` / `customerClass`, `mode` (`interactive | shadow | evaluation`), `llm`, `now`, and a `retrievalTrace` that `trace()` appends to. Each agent:

1. resolves inputs with retrieval,
2. builds `ProposedClaim[]` (`answer/types.ts`) where each claim carries `support.sourceRecordIds` and optionally `assertionId` / `relationshipId` / `dependsOn`,
3. calls `gate(ctx, claims)`,
4. may tighten the outcome (`g.outcome = "abstained"`) when its own contract is unmet (e.g. product_specs when a requested attribute has no assertion; assembly when no actuator passes),
5. calls `buildAnswer` (summary from verified claims only) and `recordRun`.

Agents never loosen a gate outcome.

| Agent | File | Criticality set by agent |
|---|---|---|
| part_lookup | `agents/partLookup.ts` | 1 (identity claims are criticality 2, `critical: true`) |
| product_specs | `agents/productSpecs.ts` | max(3, requested attribute criticalities) |
| product_finder | `agents/productFinder.ts` | 3 |
| cross_reference | `agents/crossReference.ts` | 3 (substitute claims 4, similar/possible 3) |
| eligibility | `agents/eligibility.ts` | 2 |
| pricing, inventory | `agents/commercial.ts` | 2 |
| document_finder | `agents/documentFinder.ts` | 1 |
| assembly | `agents/assembly.ts` | 4 (always `humanReviewRecommended`) |
| rfq_bom | `agents/rfqBom.ts` | 2 |
| ask | `agents/ask.ts` | routes; unknown intent → abstain at criticality 3 |

## Role of the LLM

`llm/provider.ts` defines `LlmProvider { enabled, model, extractJson(task, untrustedData, schema), explain(instruction, verifiedFacts) }`.

- **`NullProvider` is the default** (`makeContext`, and `createLlmProvider` when `ANTHROPIC_API_KEY` is unset or `WPI_LLM_DISABLED=1`). Both methods return `null`; every call site must work without it.
- **`AnthropicProvider`** uses `@anthropic-ai/sdk` (`messages.create`, `max_tokens: 16000`, `output_config: { effort: "low" }`). Model from `WPI_LLM_MODEL`, code default `claude-opus-5-5` (`.env.example` sets `claude-sonnet-5-5`).
- Where the LLM is consulted, and only there:

| Call site | What the LLM may propose | How it is constrained |
|---|---|---|
| `requirements/extract.ts` `extractRequirements` | Additional requirement fields `{key, value, quote}` | Deterministic extraction runs first; an LLM field is `EXPLICIT` only if `quote` literally appears in the text, otherwise `INFERRED` and labeled "proposed by model; not literally stated". Only INFERRED/UNKNOWN fields may be overwritten. Product finder uses EXPLICIT fields for hard filters; INFERRED fields become labeled assumption claims. |
| `agents/rfqBom.ts` | Line split `{quantity, manufacturer, partNumber, description, quote}` | Accepted only if `quote` is a literal substring of the RFQ and any `partNumber` appears literally; used only if it yields at least as many lines as the deterministic parser. |
| `agents/ask.ts` | Intent plan `{intent, partNumber, predicates}` for questions the deterministic classifier could not place | zod `PlanSchema`; the routed agent still retrieves and gates everything. Note: `PlanSchema` does not include `assembly`. |
| `LlmProvider.explain` | Prose over already-verified facts | Defined, not called by any agent. |

**Untrusted data handling.** `extractJson` wraps the input in `<untrusted_data>` (stripping any embedded tags), the system prompt states the block is data whose instructions must be ignored and forbids inventing part numbers / ratings / quantities, the reply is parsed as a single JSON object and validated with zod, and any error yields `null` (deterministic path continues). `source_records.extracted_text` is documented in the schema as "untrusted data, never instructions". The LLM output never reaches the gate as evidence; all evidence is a `source_record` row.

`Answer.llmUsed` and `agent_runs.llm_used / llm_model` record whether a model was involved. The evaluation runner always uses `NullProvider`.

## Run recording and observability

`recordRun` (`agents/context.ts`) persists, per answer:

| Table | Content |
|---|---|
| `agent_runs` | agent, channel, user, role, mode, question, criticality, outcome, confidence, answer JSON (summary/known/unknown/data), `gate_report`, llm flags, latency |
| `claims` | one row per gated claim: subject_ref, predicate, value, criticality, status (`verified`, `removed_*`, `assumption`), assertion_id, reason |
| `citations` | per verified claim: source_record_id, supporting_text, label |
| `retrieval_events` | every `trace()` call: stage, query JSON, result_count, latency |
| `human_escalations` | inserted automatically when outcome is `abstained` and criticality ≥ 4 |

`audit_events` records review decisions, corrections and incorrect-answer reports (`review/reviews.ts`). `sync_jobs` / `sync_conflicts` record integrations (`ingest/*`).

## RBAC at the data layer

`auth/rbac.ts`:

- `Principal` is loaded from `users` + `roles.permissions` (`loadPrincipalByEmail`) or is `PUBLIC_PRINCIPAL`.
- `restrictedPredicatesFor(principal, { customerId })` returns predicates the principal may never receive: `cost`, `margin`, `supplier_price` without `view_cost`; `customer_contract_price` without `view_customer_pricing` (unless `view_own_pricing` and the pricing context is the principal's own customer); `internal_note`, `supplier` without `view_internal`; `territory_rule_detail` without `view_territory_rules`; `qty_available`/`qty_on_hand` without any inventory permission; `qty_on_hand`, `qty_committed`, `qty_on_order` without `view_inventory`.
- The gate removes such claims with status `removed_channel` before any evidence check. `pricingAgent` additionally never proposes a cost claim without `view_cost` (`can()`).
- `allowedChannels`: public/customer → `valveman` only.

## Criticality levels

`attribute_definitions.criticality` (1–5) is copied onto assertions at ingest and onto claims by the agents; agents assign fixed criticalities to identity, rule, commercial and calculation claims.

| Level | Meaning in fixtures (`fixtures/attributes.ts`) | Gate: max source authority (`maxAuthorityForCriticality`) |
|---|---|---|
| 1 | weight | 9 (anything but general internet) |
| 2 | product_type, stem_material, port_configuration, flow_characteristic; identity, rule and commercial claims | 9 |
| 3 | size, end_connection, certifications, lead_free, ball/disc/seal material, vacuum, actuation, voltage, enclosure | 7 (manufacturer website acceptable) |
| 4 | body_material, pressure, temperatures, media, seat_material, steam rating, Cv, torques, ISO 5211 pad/stem, supply pressures, hazardous-area cert; substitute relationships; assembly calculations | 6 |
| 5 | (no fixture attribute) | 2, **and** the assertion must be `human_approved` |

Answers with criticality ≥ 4 are always `humanReviewRecommended` (`buildAnswer`), and abstentions at ≥ 4 open a `human_escalations` row.

## Monorepo layout

```
/home/user/AI
├── package.json            npm workspaces: packages/*, apps/*; scripts db:migrate|seed|reset, test, eval, eval:gate, typecheck, dev, build
├── .env / .env.example     DATABASE_URL, ANTHROPIC_API_KEY, WPI_LLM_MODEL, SHOPIFY_*, P21_*
├── eval/golden/*.json      golden dataset (v1-core.json)
├── eval/runs/              evaluation run outputs (git-ignored)
├── apps/web                @wpi/web (Next.js 15, React 19, Tailwind 4) — package.json only
└── packages/core           @wpi/core (TypeScript, ESM, run with tsx; deps: postgres, zod, @anthropic-ai/sdk)
    ├── migrations/0001_init.sql
    ├── fixtures/{catalog.ts, attributes.ts, shopify-products.json, p21.json}
    └── src/
        ├── db/            client (postgres.js, camelCase column transform), migrate, reset, seed
        ├── identifiers.ts
        ├── knowledge/     authority, conflicts, projection, evidence
        ├── retrieval/     partLookup, attributeFilter, fts
        ├── rules/         channelEngine
        ├── requirements/  extract
        ├── gate/          answerGate, textSupport
        ├── answer/        types
        ├── agents/        context + one file per agent + ask router
        ├── auth/          rbac
        ├── review/        reviews
        ├── connectors/    shopify, p21
        ├── ingest/        seedCatalog, shopifySync, p21Sync, reconcile
        ├── eval/          dataset, runner, cli
        └── index.ts       public exports
```

`npm run db:reset` drops and recreates the `public` schema, applies migrations (tracked in `schema_migrations`), then `seedAll` (`db/seed.ts`): seed catalog → Shopify sync → P21 sync → `detectConflicts` → `rebuildAttributeProjection` → `reconcileShopifyP21` → load golden dataset.

## Future-direction hooks (present in code, not implemented)

| Hook | Where |
|---|---|
| MCP / API surface | `index.ts` exports every agent and `makeContext`; `users.api_key_hash` column; `rfqs.source_kind = 'api'` |
| Pipedrive | `opportunities.crm_system` default `'pipedrive'`, `crm_external_id`, status `prepared/pushed/failed`; `write_crm` permission |
| Email ingestion | `rfqs.source_kind = 'email'`; `rfqBomAgent` treats input as untrusted text |
| pgvector | `VectorRetriever` interface, `disabledVectorRetriever` |
| Shopify webhooks / GraphQL extras | `ShopifyAdminConnector` already uses Admin GraphQL; see `shopify-integration.md` |
| P21 orders / quotes | `quotes.p21_quote_id`, `quote_lines.price_source_record_id`; see `prophet21-integration.md` |
| Shadow mode | `agent_runs.mode`, `AgentContext.mode` |
