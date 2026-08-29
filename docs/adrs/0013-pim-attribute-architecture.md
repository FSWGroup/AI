# ADR-0013: Typed EAV for canonical attribute values; no runtime DDL, ever

- Status: Accepted (provisional)
- Date: 2026-08-29
- Resolves: specification §23, §25, §34, and conflict item 5 — the central technical decision of the project

## Context

Four requirements are individually reasonable and jointly constraining:

1. New product types and attributes with **no code change and no hand-written migration** (§23, AC3)
2. **Typed relational** storage, explicitly not one opaque JSONB column (§25)
3. **Sub-100 ms faceted filtering** without an external search engine (§34, §35, AC4)
4. **Read-your-write** search consistency (§34, AC5)

The specification itself flags the trap: a physically wide projection cannot stay static
while accepting arbitrary new attributes with zero DDL. Something has to give, and it
must not be requirement 1 or 2.

## Decision

**Two layers, both with fixed schemas. No DDL is ever generated at runtime.**

### Layer 1 — canonical: `pim.attribute_value`

One table, one row per (owner, attribute, candidate). The owner is one of
`product_line`, `product_family`, `product`, or `variant`, expressed as four nullable
foreign-key columns with a `CHECK` that exactly one is populated — real referential
integrity, no polymorphic pointers.

Values are stored in **typed columns**, selected by the attribute's declared value type:

| Value type | Columns used |
|---|---|
| `TEXT` | `value_text` |
| `BOOLEAN` | `value_boolean` |
| `INTEGER`, `DECIMAL` | `value_numeric` |
| `DATE` | `value_date` |
| `ENUM` | `value_term_id` → `pim.vocabulary_term` |
| `NOMINAL_SIZE` | `value_term_id` (constrained to the nominal-size vocabulary) |
| `PRESSURE_CLASS` | `value_term_id` (constrained to a pressure-class vocabulary) |
| `QUANTITY` | `value_qty_original`, `value_qty_original_unit`, `value_qty_base`, `value_qty_dimension` |
| `QUANTITY_RANGE` | the quantity columns plus `value_qty_max_original` / `value_qty_max_base` |
| `ENTITY_REF` | `value_entity_id` + `value_entity_type` |

A `CHECK` constraint per value type asserts that exactly the right columns are populated
and the rest are `NULL`. The database, not the application, guarantees that a `QUANTITY`
attribute cannot hold a bare string and that a `PRESSURE_CLASS` cannot hold a number.

Each row also carries provenance (`source_system_id`, `source_record_id`, `confidence`,
`verification_status`), the untouched `entered_raw` text, valid-time bounds, and
`is_selected` with `selected_reason` (ADR-0011).

Uniqueness of the selected value is enforced by an exclusion constraint over
`(owner_key, attribute_key, validity)` where `is_selected`, using `btree_gist` — so a
single-cardinality attribute physically cannot have two effective selected values at
the same point in valid time.

### Layer 2 — search: `pim.variant_facet`

A **fixed-schema, denormalized, synchronously maintained** projection: one row per
(variant, attribute, ordinal) holding the *resolved effective* value after inheritance —
`num_value`, `num_min`, `num_max`, `term_id`, `bool_value`, `text_value`. Written in the
same transaction as the canonical change, so a newly committed product is immediately
filterable (AC5). Fully rebuildable from Layer 1 at any time.

Inheritance (§27) is resolved *into* the facet table rather than at query time, which is
what makes faceted filtering a set of index scans rather than a recursive join.

### What we are explicitly not doing

- **No `ALTER TABLE` at runtime.** Defining a new attribute inserts metadata rows. It
  does not create a column, an index, a view, or a partition. This preserves ADR-0006's
  guarantee that the schema is exactly what the reviewed migrations say it is, and keeps
  staging and production structurally identical.
- **No canonical JSONB blob.** `jsonb` appears only in raw source payloads, event
  payloads, rule definitions, and evidence — never as the home of a canonical
  engineering fact.

## Alternatives considered

| Option | Assessment |
|---|---|
| **Generated DDL** — a column and index per attribute, created when an attribute is defined | Fastest possible filtering, and the only option that gives a genuinely wide table. Rejected: it makes production schema a function of production *data*, breaks migration checksums (ADR-0006), makes staging structurally divergent, and turns "define an attribute" into a schema-lock event on a large table. |
| **Single `jsonb` column with a GIN index** | Simple, flexible, and genuinely fast for containment queries. Rejected as the *canonical* store by §25 — and correctly so: it cannot express typed constraints, cannot foreign-key an enum value to a vocabulary term, and makes unit-aware range queries awkward. Retained as a permitted *accelerator* shape (below). |
| **Table-per-product-type** | Clean and fast; fails AC3 outright, since a new type means a new table. |
| **Naive EAV with all values as text** | The specification's named anti-pattern. Rejected. |
| **Sparse pre-allocated columns** (`num_1..num_50`, `term_1..term_50`) | A common industry hack. Rejected: attribute-to-slot mapping becomes hidden global state and slot exhaustion is a cliff. |

### Accelerators, if and only if measured

If benchmarking shows the facet table missing the SLO for specific high-traffic product
types, ADR-0014 permits an additional per-product-type materialized projection generated
from metadata. Such a projection is asynchronous, rebuildable, and **never the only path
to correctness** — the facet table always answers the query correctly, just more slowly.
No accelerator will be built without a benchmark showing the need.

## Consequences

- Product writes cost more: canonical rows, survivorship, inheritance resolution, facet
  rows, and quality evaluation, all in one transaction. Measured and budgeted.
- Bulk import needs a separate path that defers facet maintenance to a batched rebuild
  at the end of the run rather than per row.
- An attribute value change on a product line fans out to every descendant variant's
  facet rows. This fan-out is bounded and measured; a family with 10,000 variants is a
  10,000-row rebuild, executed set-based, not row-by-row.

## Risks

- **Facet drift** — canonical and facet disagreeing after a bug. Mitigated by a
  reconciliation job that recomputes a sample and alerts on mismatch, plus a full rebuild
  command with a documented runbook.
- **Fan-out cost** on high-level attribute edits. Mitigated by set-based rebuild and by
  measuring the worst realistic case in the performance suite.

## Reversal cost

High for Layer 1 (canonical shape). **Low for Layer 2** — the facet table is derived and
can be redesigned, replaced, or supplemented at any time without touching canonical data.
This asymmetry is deliberate: we have committed hard only where we must.

## Revisit if

Benchmarks at the agreed catalogue size and concurrency miss the SLO. The escalation
order is: index tuning → query reshaping → per-type accelerator projections → a
materialized `jsonb`+GIN accelerator → and only then, with evidence, an external search
engine.
