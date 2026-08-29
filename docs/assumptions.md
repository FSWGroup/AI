# Assumption log

Every assumption made in the absence of an answer. Each has an ID, the question it
stands in for, what breaks if it is wrong, and what it costs to change.

**Status of this log:** the Gate 1 discovery questions were not answered before
implementation began; the owner instructed "go with what you think". Everything below is
therefore a decision made on the owner's behalf. Each row is a question waiting to be
asked again.

Cost key: **L** = configuration or a small change · **M** = code change plus migration ·
**H** = significant rework · **XH** = effectively a rebuild.

| ID | Assumption | Stands in for | If wrong | Cost |
|---|---|---|---|---|
| A-001 | Layer 0 lives in `FSWGroup/AI` at the repository root | A1 | Move the repository; history is portable | L |
| A-002 | Future maintainers are TypeScript-capable | A2, A3 | Language rewrite | XH |
| A-003 | The first proving ground is PIM + a working Account Master spine, not a consuming app | A4, A6 | Re-sequenced phases | L |
| A-004 | Infrastructure budget is modest: one managed database, one container host, one bucket | A5 | Hosting choice changes | L |
| A-005 | Layer 0 is a **mastered golden copy** in v1; authoritative only for concepts no source owns | B1 | Write surface expands; write-back becomes critical path | M |
| A-006 | Field ownership defaults: P21 owns commercial terms and account status; Pipedrive owns sales ownership and activity-derived contact data; Layer 0 owns canonical identity, sites, relationships, and all technical product data | B2 | Reconfigure `party.field_ownership` | L |
| A-007 | Nothing is written back to P21 or Pipedrive in v1 | B3, B4 | A write-back connector is new work, not a redesign | M |
| A-008 | No named data steward exists yet; review queues are built but unassigned | B5 | Add assignment and notification | L |
| A-009 | P21 extraction is **file-based** — delimited or Excel exports landing in a watched location, possibly produced manually on a schedule | C1, C2 | Replace the adapter's fetch/parse; mapping and canonical model unchanged | L |
| A-010 | Welsford and ValveMan share one P21 company; source IDs are unique within it | C3 | Source keys gain a company qualifier | M |
| A-011 | v1 P21 entities: customer, ship-to, contact, item, supplier, product group. No transactional history | C4 | Additional mappings; additive | L |
| A-012 | P21 exports carry a usable last-modified timestamp; if not, full-snapshot diffing is used | C6 | Already handled — snapshot diff is implemented as the fallback | L |
| A-013 | Pipedrive is used by both companies in one account, and its organizations are an inconsistent mix of legal entities and plants | D2, D5 | Mapping changes; the candidate-organization-plus-candidate-site design already anticipates the mix | L |
| A-014 | Product search SLO: p50 < 25 ms, p95 < 100 ms, p99 < 250 ms at **250,000 variants**, ~400 attributes, 3–7 criteria, 50 concurrent queries | F1–F5 | Re-run the benchmark at the real size; escalation ladder in ADR-0014 | L→H |
| A-015 | ValveMan's storefront is the largest product-content source and the first likely consumer | E1, E2 | Import order changes | L |
| A-016 | Microsoft Entra ID is the likely IdP, with Google Workspace possible — so multi-issuer is built from the start | G1, G2 | Already handled by design | L |
| A-017 | Authorization is delivered as a directory plus cached claims, with a batch check endpoint | G3 | Token-issuance model would be new work | M |
| A-018 | RPO 5 minutes | H2 | Backup configuration | L |
| A-019 | RTO 4 hours | H2 | Hosting topology | M |
| A-020 | Environments: local, CI, staging, production | H3 | Drop or add staging | L |
| A-021 | After a cross-company merge: organization identity and sites are visible group-wide; commercial accounts, ship-tos and contact commercial relationships stay within their owning operating company | I6 | Change the scope predicate | M |
| A-022 | FSW sells to the same legal entity through multiple accounts, so commercial account is many-to-one on organization | I1 | Already the design | — |
| A-023 | P21 ship-tos are an inconsistent mix of plants and delivery points, so a ship-to never automatically becomes a site | I2 | Already the design | — |
| A-024 | No trusted external identifiers (DUNS/GLN/tax ID) are available initially; matching is name + address + domain | I5 | Deterministic stage gets stronger — strictly an improvement | L |
| A-025 | Metadata is authored as version-controlled YAML, not edited at runtime by non-engineers | **J1 — most likely to be wrong** | A runtime authoring API and UI is significant new work | H |
| A-026 | Product = a manufacturer's model series; variant = an orderable configuration | J3 | Terminology and hierarchy remapping | M |
| A-027 | Ball valve is the first fully modelled product type | J5 | Different seed and fixtures | L |
| A-028 | No pricing in Layer 0 v1 | J6 | Temporal price facts are additive | L |
| A-029 | FSW has California data subjects and possibly EU/UK; erasure is built as a real capability | K1 | Already conservative | — |
| A-030 | Retention: raw payloads 2 years, ingestion runs 2 years, audit 7 years, event ledger indefinite | K2 | Retention job configuration | L |
| A-031 | Model-number parsing is **deferred**: the output model exists, the parser engine does not | §36 vs. delivery risk | Build the engine later against real manufacturer patterns | L |
| A-032 | General bitemporality is **not** built; valid time only, with system time from audit and ledger | §20 | Additive per table with backfill | M |
| A-033 | Deals are not ingested from Pipedrive; deal links may later be used as matching evidence only | D7 | Additive | L |
| A-034 | Cross-references and supersession are treated as high priority, above channel content and model parsing | §40, §43 | Re-sequence | L |
