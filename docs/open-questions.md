# Open questions

Questions whose answers change the system. Grouped as they were asked at Gate 1, with
the assumption currently standing in for each.

Answering the **blocking** set is the highest-value thing the owner can do for this
project.

## Blocking — an assumption is load-bearing until answered

| #     | Question                                                             | Standing assumption                                | What changes                                       |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| A1    | Which repository is Layer 0's permanent home?                        | A-001 (`FSWGroup/AI`)                              | Repository move                                    |
| A2/A3 | Who maintains this, and in what language are they fluent?            | A-002 (TypeScript)                                 | **Language rewrite if wrong**                      |
| A4    | What must work first for the project to be worth continuing?         | A-003                                              | Phase order                                        |
| B1    | Golden copy, or authoritative from day one?                          | A-005 (golden copy)                                | The entire write surface                           |
| B2    | Which system wins per field?                                         | A-006                                              | `party.field_ownership` configuration              |
| B3    | Is permanent divergence in P21 acceptable?                           | A-007 (yes)                                        | Write-back becomes critical path                   |
| C1    | What can actually be extracted from P21, confirmed with Epicor?      | A-009 (file exports)                               | Adapter fetch/parse only                           |
| C2    | Is a scheduled manual export acceptable as the v1 mechanism?         | A-009 (yes)                                        | Freshness guarantees                               |
| C3    | One P21 company or two?                                              | A-010 (one)                                        | Source key uniqueness                              |
| D1    | Can a read-only Pipedrive token be provisioned for development?      | none — **blocks Phase 5 fixtures**                 | Connector is designed but unverifiable             |
| D2    | One Pipedrive account or two?                                        | A-013 (one)                                        | Operating-company derivation                       |
| E1/E2 | What runs ValveMan.com, and where does product content live?         | A-015                                              | First import's shape                               |
| F1/F2 | Catalogue size and concurrency for the benchmark                     | A-014 (250k / 50)                                  | Search architecture escalation                     |
| G1/G2 | Entra or Google; one directory or two?                               | A-016 (multi-issuer built)                         | Already mitigated                                  |
| G3    | How do consuming apps get authorization decisions?                   | A-017 (claims)                                     | The contract every future app depends on           |
| H1    | Cloud provider?                                                      | A-004                                              | Hosting only                                       |
| H2    | RPO and RTO?                                                         | A-018/A-019                                        | Backup topology                                    |
| I1/I2 | How are plants and multi-account customers represented in P21 today? | A-022/A-023                                        | Already modelled defensively                       |
| J1    | Does "no source-code change" permit a reviewed config file in git?   | **A-025 — the assumption most likely to be wrong** | Runtime metadata authoring is significant new work |
| K1    | Are there EU/UK data subjects?                                       | A-029 (assume yes)                                 | Already conservative                               |

## Important

B4 (Pipedrive two-way?) · B5 (named stewards?) · B6 (internal objections?) ·
C4–C8 (P21 entities, volumes, timestamps, deletion semantics, customizations) ·
D3–D6 (Pipedrive volumes, custom fields, organization semantics, existing crosswalk) ·
E3–E5 (manufacturer catalogue formats, document locations, existing cross-reference data) ·
F3–F5 (attribute counts, filter shape, SLO confirmation) ·
G4–G6 (headcount, external users, MFA) ·
H3–H5 (environments, CI approval, data residency) ·
I3–I5 (commercial roles actually tracked, duplicate rate, trusted identifiers) ·
I6 (post-merge visibility — **assumption A-021 is a real business decision made by default**) ·
J3–J6 (product/variant semantics, type count, first type, pricing) ·
K2 (retention) · K3 (confirm no-PII-in-events) · L1/L2 (BI tooling, reporting timeline)

## Can defer

A7 · C8 · D7 · G7 · H6 · I7 · J7 · J8 · K4 · L3

## Questions raised since Gate 1

| #   | Question                                                                                                         | Why it matters                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Does FSW distinguish specifier (A&E firm), OEM, contractor and end user today, even informally?                  | Modelling it now is cheap; retrofitting after mastering is not. The roles exist in the schema but will be unpopulated without a mapping rule      |
| N2  | Should a real-world acquisition ("Acme was acquired by Pfizer") be modelled differently from a duplicate merge?  | Currently they are different: acquisition is an `organization_relationship`, duplication is a merge. Confirm this matches how the business thinks |
| N3  | Who owns the match review queue and the quarantine queue operationally?                                          | Both are built; neither has an assignee model until there is a person                                                                             |
| N4  | Is a divergence report (Layer 0 value differs from owning source) something the business wants to see, or noise? | It is implemented as a data-quality metric under ADR-0033                                                                                         |
