# Data Model

Source: `/home/user/AI/packages/core/migrations/0001_init.sql` (49 tables, plus `schema_migrations` created by `src/db/migrate.ts`). Extensions: `pg_trgm`, `pgcrypto`. All ids are `uuid` (`gen_random_uuid()`) unless noted. Column names are snake_case in SQL; the postgres.js client maps them to camelCase in code (`src/db/client.ts`).

## Key invariants

| Invariant | Enforced by |
|---|---|
| `product_attributes` is a projection only; never edited directly | `rebuildAttributeProjection` (`src/knowledge/projection.ts`) does `DELETE FROM product_attributes` and reinserts from assertions with status `verified`/`human_approved`, `subject_type='variant'`, a matching `attribute_definitions.key`, no open `knowledge_conflicts` row, and exactly one eligible assertion per (variant, predicate). Called after seeding, approvals, rejections, corrections. |
| Every answerable assertion needs evidence | The gate (`src/gate/answerGate.ts`) removes any claim with zero loadable `source_records` (`removed_unsupported`). `assertion_evidence.source_record_id` is NOT NULL. |
| Relationships carry `approval_authority` (`manufacturer`, `welsford`, `none`) and status | `product_relationships` CHECK constraints; `crossReferenceAgent.categorize` keys off both. |
| Fixture data is flagged at the source | `sources.is_fixture`; `citationFor` prefixes labels with `[FIXTURE]`; sync jobs record `mode`. |
| Claims and citations are persisted per run | `recordRun` (`src/agents/context.ts`) writes `agent_runs`, `claims`, `citations`, `retrieval_events`. |
| Evaluation is reproducible | `evaluation_cases` keyed by stable golden id; `evaluation_runs` store metrics + full results; `regression_cases` link to the review that created them. |
| A human override supersedes everything | `correctAssertion` creates a `human_override` source (authority 1) and a `human_approved` assertion with `supersedes_id`, deprecates competitors, resolves open conflicts. |

## Organizations, users, roles

| Table | Purpose | Notable columns |
|---|---|---|
| `organizations` | `welsford`, `valveman` | `slug` UNIQUE |
| `roles` | Text PK (`admin`, `app_engineer`, `sales`, `cs`, `customer`, `public`) | `permissions text[]` — e.g. `view_cost`, `view_customer_pricing`, `view_inventory`, `view_public_inventory`, `view_own_pricing`, `view_internal`, `review_knowledge`, `write_crm`, `manage_users`, `view_territory_rules` |
| `users` | Internal staff and authenticated customers | `email` UNIQUE, `role_id`, `customer_id` (FK to `customers`, added after that table), `api_key_hash` (unused so far) |

## Sales channels and territories

| Table | Purpose | Notable columns |
|---|---|---|
| `sales_channels` | `welsford` (`rep_distributor`), `valveman` (`ecommerce`) | text PK |
| `territories` | `US-PA`, `US-NJ`, `US-DE`, `US-MD`, `US-NY`, `US-TX`, `US-CA`, `US-NATIONAL` in fixtures | `code` UNIQUE, `state` NULL for national |

## Catalog

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `manufacturers` | `code` used as SKU prefix (BVW, CVA, HLD, STR in fixtures) | `aliases text[]` used by identifier lookup stage 2b |
| `product_families` | UNIQUE (manufacturer_id, name); `category` e.g. `ball_valve` | |
| `product_series` | UNIQUE (manufacturer_id, code); e.g. `S70` | |
| `products` | `status` in active/discontinued/superseded/pending; `search_tsv` maintained by trigger `products_tsv_update` (name + description + category) | GIN index |
| `product_variants` | `canonical_sku` UNIQUE — the identity Welsford/ValveMan sell | `status` |
| `product_identifiers` | Every alias of a variant. `identifier_type` in mfr_part_number, canonical_sku, shopify_sku, p21_item_id, upc, historical_part_number, superseded_part_number, competitor_part_number, alias | `identifier_norm` (see `src/identifiers.ts`), `manufacturer_id` (the competitor for competitor numbers), `is_primary`, `source_record_id` (identity evidence). UNIQUE (type, norm, variant). B-tree + trigram GIN on `identifier_norm`. |
| `attribute_definitions` | Text PK `key`; `data_type` number/text/boolean/enum/range; `criticality` 1–5; `allowed_values`; `scope` | Seeded from `fixtures/attributes.ts` (35 keys) |

`seedCatalog.ts` currently creates one `products` row per fixture variant (1:1), so the product/variant split is not yet exercised with multi-variant products.

## Sources and evidence

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `sources` | One row per authority: `source_type` in human_override, mfr_document, mfr_structured, p21, shopify, internal_approved, mfr_website, company_website, internal_historical, internet | `authority_level` 1–10 (lower = more authoritative; must agree with `AUTHORITY_BY_SOURCE_TYPE`), `is_fixture`, `origin_url`, `manufacturer_id` |
| `documents` | `document_type` e.g. datasheet, iom, catalog, drawing, certificate, cross_reference, price_sheet, torque_chart | `document_number` |
| `document_versions` | UNIQUE (document_id, revision) | `is_current`, `superseded_at`, `checksum`, `storage_uri` (`s3://` or `fixture://`), `publication_date`, `effective_date`, `last_verified_at` |
| `document_pages` | UNIQUE (version, page_number); `search_tsv` by trigger | `text` |
| `source_records` | **The atomic unit of evidence.** Optional `document_version_id` + `page_number`; `record_locator` (`p21:item:…`, `shopify:variant:…`, `doc:<number>:rev<rev>:p<n>`, `partlist:<mfr>:<pn>`, `rule:…`, `override:…`); `extracted_text` (verbatim, untrusted); `structured jsonb`; `checksum` NOT NULL; `source_version`, `revision`, `effective_date`, `last_verified_at` | `last_verified_at` drives the gate's freshness check; `document_versions.is_current` drives the superseded-revision check |

## Knowledge assertions

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `knowledge_assertions` | One (subject, predicate, value) fact. `subject_type` in product, variant, series, manufacturer, relationship; `status` in verified, pending, conflicting, deprecated, human_approved, rejected; `criticality` 1–5 | `value_text` / `value_number` / `value_number_max` (ranges) / `value_json`, `unit`, `effective_date`, `expires_at`, `supersedes_id` (self FK), `created_by` |
| `assertion_evidence` | UNIQUE (assertion_id, source_record_id); `extraction_method` in manual, table_parser, llm_extract, api_sync, rule | `supporting_text` — the exact excerpt; the gate checks it is contained in `source_records.extracted_text` and contains the claimed value |
| `product_attributes` | PK (variant_id, attribute_key); FK to `assertion_id` | Projection only (see invariants). Indexed by (key, value_number) and (key, value_text) for `filterByAttributes`. |

Only `subject_type = 'variant'` assertions are projected or loaded by agents (`loadAssertions`); the other subject types are schema-ready but unused.

## Relationships

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `product_relationships` | `relationship_type` in compatible_with, approved_substitute_for, technically_similar_to, requires_accessory, assembled_with, actuated_by, mounted_with, replaces, superseded_by, possible_match_needs_review. UNIQUE (from, to, type) | `approval_authority` manufacturer/welsford/none; `status` verified/pending/human_approved/rejected/deprecated; `conditions jsonb` (e.g. `{"requires_accessory":"CVA-BK-F07-S90"}` consumed by the assembly agent); `notes` |
| `relationship_evidence` | UNIQUE (relationship_id, source_record_id) | `supporting_text` |

Direction matters: `approved_substitute_for` reads "from IS a substitute FOR to"; `mounted_with` reads "from (actuator) mounts to to (valve)"; `compatible_with` reads "from (accessory) fits to (actuator)".

## Channel and territory rules

| Table | Purpose | Notable columns |
|---|---|---|
| `channel_rules` | Compiled business rules. `scope_type` manufacturer/family/series/variant + `scope_id`; `rule_type` in authorized, not_authorized, rfq_only, ecommerce, pricing_visible, pricing_login_required, requires_approval | `territory_code` (NULL = everywhere the channel operates), `customer_class` (NULL = all), `priority` (lower wins), `source_record_id` (the agreement excerpt cited in eligibility answers), `effective_date`, `expires_at` |

Resolution semantics are in `src/rules/channelEngine.ts` (see `architecture.md`).

## Commercial projections

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `customers` | `p21_customer_id` UNIQUE, `shopify_customer_id` UNIQUE, `customer_class`, `state`, `channel_id`, `salesperson` | |
| `customer_pricing` | `price_type` in list, customer_contract, ecommerce, cost; `system` p21/shopify; `customer_id` NULL = list/channel price | UNIQUE index on (system, channel, variant, price_type, coalesce(customer_id, zero-uuid)); `source_record_id` NOT NULL; `as_of` NOT NULL |
| `inventory` | UNIQUE (variant_id, system, location_code) | `qty_on_hand`, `qty_committed`, `qty_available`, `qty_on_order`, `lead_time_days`, `source_record_id` NOT NULL, `as_of` |

## System mappings and sync

| Table | Purpose | Notable columns |
|---|---|---|
| `shopify_mappings` | One row per Shopify variant (`shopify_variant_id` UNIQUE) | `variant_id` (nullable), `mapping_status` mapped/unmapped/ambiguous/conflict, merchandising fields (handle, title, vendor, product_type, status, tags, price, compare_at_price, inventory_quantity), `raw jsonb`, `last_synced_at` |
| `p21_mappings` | One row per P21 item (`p21_item_id` UNIQUE) | `p21_inv_mast_uid`, `variant_id`, `item_desc`, `supplier_part_number`, `manufacturer_name`, `uom`, `raw`, `mapping_status` |
| `sync_jobs` | `system`, `job_type`, `mode` fixture/live, `status` queued/running/succeeded/failed, `stats jsonb`, `error` | |
| `sync_conflicts` | `conflict_type`: unmapped_sku, duplicate_sku, manufacturer_mismatch, description_mismatch, price_discrepancy, missing_product, uom_conflict; `status` open/resolved/ignored | `details jsonb`, optional `variant_id`, `shopify_variant_id`, `p21_item_id` |

## Knowledge conflicts and human review

| Table | Purpose | Notable columns |
|---|---|---|
| `knowledge_conflicts` | Open disagreement on (subject_type, subject_id, predicate) between eligible sources | `assertion_ids uuid[]`, `status` open/resolved/dismissed, `resolved_assertion_id`, `resolved_by`. Partial index on open rows. |
| `knowledge_reviews` | Work queue. `review_type` in new_relationship, source_conflict, possible_substitution, missing_attribute, ambiguous_mapping, document_revision, taxonomy_change, stale_evidence, low_confidence_assertion, answer_correction, escalation; `target_type` assertion/relationship/conflict/mapping/answer/document_version | `priority` (1 = highest), `status` open/approved/rejected/corrected/superseded/closed, `decided_by`, `decision_note`, `payload jsonb` |
| `review_comments` | Discussion on a review | |
| `human_escalations` | Auto-created by `recordRun` for abstentions at criticality ≥ 4 | `agent_run_id`, `question`, `known_facts`, `unknowns`, `answer`, `answered_by` |

Review types created by code today: `source_conflict` (priority 1) and `low_confidence_assertion` (priority 3) from `detectConflicts`; `answer_correction` (priority 1) from `reportIncorrectAnswer`.

## RFQs, quotes, opportunities

| Table | Purpose | Notable columns |
|---|---|---|
| `rfqs` | `source_kind` email/pdf/excel/csv/text/api; `raw_text`; `status` extracted/review/verified/quoted/closed | Written by `rfqBomAgent` |
| `rfq_lines` | UNIQUE (rfq_id, line_no); parsed quantity / manufacturer / part number / description; `candidate_variant_id`; `match_type` exact/normalized/historical/competitor_xref/attribute/none; `confidence` VERIFIED/NEEDS_REVIEW/INSUFFICIENT_EVIDENCE; `evidence jsonb` (citations); `questions text[]`; `review_required` | |
| `quotes`, `quote_lines` | `p21_quote_id`, `unit_price`, `unit_cost`, `price_source_record_id`, `lead_time_days` | Schema only; no agent writes them |
| `opportunities` | `crm_system` default `pipedrive`, `crm_external_id`, `status` prepared/pushed/failed, `payload` | Schema only |

## Agent runs, claims, citations, traces

| Table | Purpose | Notable columns |
|---|---|---|
| `agent_runs` | One per answer. `mode` interactive/shadow/evaluation; `outcome` answered/partial/abstained/escalated/error; `confidence` VERIFIED/NEEDS_REVIEW/INSUFFICIENT_EVIDENCE | `answer jsonb`, `gate_report jsonb`, `llm_used`, `llm_model`, token counts (not yet populated), `latency_ms` |
| `agent_messages` | Conversation turns per run | Schema only; not written |
| `claims` | `status` in verified, removed_unsupported, removed_conflict, removed_stale, removed_channel, removed_unapproved, assumption | `subject_ref` (canonical SKU, `rule:<channel>:<sku>`, `calc:<sku>`, `requirements`, `documents`), `predicate`, `value`, `criticality`, `assertion_id`, `reason` |
| `citations` | Per verified claim | `source_record_id`, `supporting_text`, `label` |
| `retrieval_events` | `stage`, `query jsonb`, `result_count`, `latency_ms` | Stages emitted today: identifier_lookup, attribute_filter, relationship_traversal, rule_engine, pricing_lookup, inventory_lookup, document_by_evidence, document_by_series_title, fts_documents |

## Evaluation

| Table | Purpose | Notable columns |
|---|---|---|
| `evaluations` | Named dataset registrations | Schema only; not written by the runner |
| `evaluation_cases` | Text PK = golden case id (e.g. from `eval/golden/*.json`, or `REG-<8 chars>` for regressions) | `category`, `agent`, `criticality`, `input jsonb`, `expected jsonb`, `is_regression`, `origin` (`golden file name` or `regression:<review_id>`), `dataset_version` |
| `evaluation_runs` | One per `runEvaluation` | `dataset_version`, `code_version` (git short SHA when available), `llm_model` (always `'none'`), `metrics jsonb`, `passed_gate`, `results jsonb` |
| `regression_cases` | Links an `evaluation_case` to the `knowledge_review` that reported it | `question`, `incorrect_output`, `corrected_answer`, `root_cause` |

## Audit

| Table | Purpose |
|---|---|
| `audit_events` | `action` values written today: `conflict.resolve`, `review.approve`, `review.reject`, `assertion.correct`, `answer.report_incorrect` |

## Status vocabularies at a glance

| Entity | Answerable states | Non-answerable states |
|---|---|---|
| `knowledge_assertions.status` | verified, human_approved | pending, conflicting, deprecated, rejected |
| `product_relationships.status` | verified, human_approved | pending, rejected, deprecated |
| `document_versions.is_current` | true | false (superseded) |
| `source_records.last_verified_at` | within the source-type freshness window | NULL or older than the window |
| `knowledge_conflicts.status` on (subject, predicate) | none open | open |
