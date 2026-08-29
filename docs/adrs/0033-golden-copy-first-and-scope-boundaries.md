# ADR-0033: Layer 0 starts as a mastered golden copy; no write-back; pricing stays out

- Status: Accepted (provisional — this is a business decision made under delegated authority and most needs owner confirmation)
- Date: 2026-08-29
- Resolves: conflict items 6 and 7

## Context

§3 and §88 want every future application to read from and write to Layer 0. §9 forbids
writing to P21. Those cannot both hold for a field P21 owns: a Layer 0 edit that cannot
be pushed either silently reverts on the next extract or diverges permanently.

Separately, §55 asks what price data, if any, belongs in Layer 0 — a question that
becomes ERP scope creep on the second follow-up.

## Decision

### Posture: golden copy first, authority earned per domain

Layer 0 v1 is a **mastered golden copy** for anything a source system owns, and
**authoritative from day one** only for concepts no source system owns.

| Class | Examples | Layer 0 behaviour |
|---|---|---|
| **Layer 0 authoritative** | canonical organization identity; site identity; organization relationships; canonical person identity; technical product attributes; product types and vocabularies; cross-references; supersession; certifications; ETIM mappings; source crosswalks; merges | Full read/write API. Sources never overwrite. |
| **Source-owned, mastered** | legal name, addresses, phone, credit terms, customer status, salesperson assignment, Pipedrive ownership | Read-only through the API in v1. Survivorship selects among sources. A manual override is possible but is recorded as a `MANUAL` candidate (ADR-0011) and **flagged as divergent from the owning source**, never silently applied. |
| **Not in Layer 0** | orders, invoices, inventory, quotes, pipelines, activities, commissions, contract pricing | Absent. |

`party.field_ownership(entity_type, field_key, owning_source_system, layer0_writable,
divergence_policy)` makes this configuration rather than code, so the register can be
populated as question B2 is answered field by field, and a field can be promoted to Layer
0 authority without a code change.

Every source-owned field the API exposes carries its owning source and last-sync
timestamp, so a consumer always knows how fresh and how authoritative a value is. Fields
that diverge from their owning source appear in a **divergence report** — a visible,
countable data-quality metric rather than a silent inconsistency.

### No write-back in v1

Layer 0 writes to no source system. The consequence, stated plainly for the record: a
Layer-0-authored value for a source-owned field will not appear in P21 or Pipedrive, and
users of those systems will not see it. This is the accepted answer to question B3 until
told otherwise.

### Pricing: out

No pricing in Layer 0 v1. The boundary, if pricing is later admitted: **manufacturer
list price and FSW cost as source-backed temporal facts** (value, currency, unit of
measure, source, effective date range, provenance) and nothing else. Explicitly never in
Layer 0: quoting rules, contract or customer-specific pricing, discount logic, commission
calculation, margin rules, or purchasing logic. Any request that requires evaluating a
price rather than recording one is out of scope and must be raised, not absorbed (§86).

### The scope tripwire

If implementation begins producing opportunity pipelines, order entry, inventory,
quotation logic, storefront rendering, valve sizing, or training content, work stops and
the drift is raised. This ADR is the reference for that judgement.

## Alternatives considered

- **Layer 0 authoritative on day one for everything.** Rejected: it requires write-back
  to P21 that we cannot build, and it would put the spine in permanent conflict with the
  systems people actually work in.
- **Pure read-only mirror.** Rejected: it forfeits the canonical concepts (site,
  cross-reference, canonical organization) that are the whole point.
- **Include list pricing now.** Rejected pending a named consumer (question J6).

## Consequences

- The v1 write surface is smaller than §3 implies, and honestly so.
- Promotion to authority becomes a deliberate, per-field, documented event, which is a
  healthier migration than a big-bang cutover.

## Reversal cost

Low — the ownership register is data.

## Revisit if

B1/B2/B3 are answered differently, P21 write access becomes available, or a named
consumer needs list pricing.
