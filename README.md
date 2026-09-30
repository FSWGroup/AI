# Welsford Product Intelligence

A verified industrial knowledge and decision layer for **F.S. Welsford Co.** (industrial valve, instrumentation, automation and flow-control distributor / manufacturer's representative) and **ValveMan** (Welsford's national ecommerce business), with AI agents built on top of it.

The product goal is **≥ 99.9 % claim-level precision on the classes of questions the system elects to answer**. Abstention ("I don't have enough verified information to answer that confidently") is a successful result; a confident wrong answer is a system failure. The LLM is a translator / planner / explainer — never a source of truth. See [docs/accuracy-strategy.md](docs/accuracy-strategy.md).

> **Status: MVP vertical slice on development fixtures.** All manufacturers, part numbers, ratings, prices and quantities in this repository are invented (`sources.is_fixture = true`, titles carry `[DEV FIXTURE]`). No real Welsford / ValveMan / manufacturer data has been loaded yet.

## What is here

| Area | Location | Notes |
|---|---|---|
| Core library (knowledge model, retrieval, rule engine, answer gate, agents, connectors, eval) | `packages/core` | TypeScript, PostgreSQL 16 via postgres.js |
| Schema | `packages/core/migrations/0001_init.sql` | 49 tables: sources → source_records → assertions/evidence → projection; claims/citations per run; reviews, conflicts, evaluations |
| Fixture knowledge base | `packages/core/fixtures/` | Catalog, manufacturer documents (as page text), Shopify- and P21-shaped JSON |
| Golden evaluation dataset | `eval/golden/*.json` | Versioned; regression cases are appended by the review workflow |
| Web app (internal + customer experiences) | `apps/web` | Next.js App Router; development cookie auth with fixture users |
| Documentation | `docs/` | Vision, architecture, data model, accuracy, source precedence, Shopify, Prophet 21, evaluation, release gates |

## Run it locally

Prerequisites: Node 22+, PostgreSQL 16 with the `pg_trgm` extension (pgvector optional and currently unused).

```bash
cp .env.example .env                 # DATABASE_URL defaults to postgres://postgres:postgres@localhost:5432/wpi
createdb wpi                         # or: su postgres -c "psql -c 'CREATE DATABASE wpi'"
npm install
npm run db:reset                     # drop + migrate + seed fixtures + Shopify/P21 fixture sync + reconciliation + golden dataset
npm test                             # unit + integration tests (vitest)
npm run eval                         # runs every golden/regression case, prints claim-level metrics, writes eval/runs/*.json
npm run eval:gate                    # same, exit code 2 if the release gate fails
npm run dev                          # web app on http://localhost:3000
```

The LLM layer is disabled unless `ANTHROPIC_API_KEY` is set (`NullProvider`). Every evaluation runs with the LLM disabled so the numbers measure the deterministic knowledge layer alone. Shopify and Prophet 21 connectors run in **fixture mode** unless their credentials are present in `.env` (`SHOPIFY_SHOP_DOMAIN`/`SHOPIFY_ADMIN_ACCESS_TOKEN`, `P21_BASE_URL`/`P21_API_TOKEN`); the sync job records which mode produced every record.

## How an answer is produced

1. **Deterministic retrieval first** — exact normalized identifier → manufacturer-qualified → historical/alias → structured attribute filter over the verified projection → explicit relationships → Postgres FTS. (`packages/core/src/retrieval`)
2. **Claims, not prose** — each agent assembles *proposed claims* `(subject, predicate, value)` from structured records, each pointing at its `knowledge_assertion` / relationship / ERP record and the `source_records` that support it. (`packages/core/src/agents`)
3. **Answer validation gate** — every claim is checked for: evidence exists; assertion/relationship status is verified or human-approved; every cited source meets the authority threshold for the claim's criticality and is a source type allowed for the predicate; the document revision is current; the evidence is fresh; no open knowledge conflict; the supporting text actually contains the claimed value; the principal is permitted to see the predicate. Unsupported claims are removed; a removed *critical* claim abstains the whole answer. (`packages/core/src/gate/answerGate.ts`)
4. **Citations** — every surviving claim carries clickable citations (document/number/revision/page, or P21/Shopify record with as-of time).
5. **Audit** — the run, its claims, citations, gate report and retrieval trace are stored (`agent_runs`, `claims`, `citations`, `retrieval_events`).

Confidence is categorical and computed from the gate outcome — `VERIFIED`, `NEEDS_REVIEW`, `INSUFFICIENT_EVIDENCE` — never a model-reported percentage.

## Agents

`ask` (deterministic router), `part_lookup`, `product_specs`, `product_finder`, `cross_reference` (manufacturer-approved / Welsford-approved / technically similar / possible-match-requiring-review, never blurred), `eligibility` (channel & territory rule engine), `pricing`, `inventory`, `document_finder`, `assembly` (deterministic actuator sizing from verified torque data), `rfq_bom`.

## Evaluation and release gate

`npm run eval` executes the golden dataset through the real agents and scores at claim level: claim precision, critical-claim precision, citation validity, unsupported-claim rate, severity-1 errors, abstention quality, exact-part-lookup, per-category pass rates and regression cases. The release gate (`releaseGate()` in `packages/core/src/eval/runner.ts`) fails unless claim precision ≥ 99.9 %, critical precision = 100 %, zero severity-1 errors, citation validity ≥ 99.9 %, all regression cases pass, and pricing / inventory / territory categories are 100 %. See [docs/evaluation-strategy.md](docs/evaluation-strategy.md) and [docs/release-gates.md](docs/release-gates.md).

Every incorrect answer reported through the Knowledge Review Center (`reportIncorrectAnswer`) becomes a regression evaluation case automatically.

## Repository layout

```
apps/web/                 Next.js application (Ask, Product Finder, Cross Reference, RFQ/BOM, Products, Assemblies,
                          Documents, Knowledge Review, Conflicts, Sources, Evaluations, Admin)
packages/core/
  migrations/             SQL migrations
  fixtures/               DEV FIXTURE knowledge base and system payloads
  src/db                  client, migrate, reset, seed
  src/knowledge           authority/precedence, conflicts, projection, evidence loading
  src/gate                answer validation gate + citation text support
  src/retrieval           identifier lookup, attribute filter, FTS (vector adapter stub)
  src/rules               channel / territory rule engine
  src/requirements        NL → structured requirements (EXPLICIT / INFERRED / UNKNOWN)
  src/agents              the agents and run recording
  src/connectors          Shopify and Prophet 21 connectors (fixture + live)
  src/ingest              catalog seed, Shopify sync, P21 sync, reconciliation
  src/review              Knowledge Review Center actions, corrections, regression capture
  src/eval                golden dataset loader, runner, metrics, release gate, CLI
  src/llm                 model abstraction (NullProvider / AnthropicProvider)
  src/auth                RBAC
  test/                   vitest unit + integration tests
eval/golden/              versioned golden dataset      eval/runs/   evaluation outputs (git-ignored)
docs/                     design documentation
```
