# ADR-0014: Faceted product search in PostgreSQL, benchmarked before anything is added

- Status: Accepted (provisional)
- Date: 2026-08-29
- Depends on: ADR-0013

## Context

Acceptance criterion 4 requires filtering by a combination such as nominal size + 316
stainless + socket weld + pressure class + certification, meeting an agreed SLO on an
agreed realistic dataset. §35 rightly refuses to call the requirement complete until
"realistic" is quantified, and §80 forbids reaching for Elasticsearch reflexively.

## Decision

### Query strategy

Filtering runs against `pim.variant_facet` (ADR-0013). An N-criterion filter compiles to
an N-way intersection:

```sql
SELECT variant_id FROM pim.variant_facet WHERE attribute_key = $1 AND term_id = $2
INTERSECT
SELECT variant_id FROM pim.variant_facet WHERE attribute_key = $3 AND num_value BETWEEN $4 AND $5
...
```

with a `GROUP BY variant_id HAVING count(DISTINCT criterion) = N` form available as an
alternative plan. Both are implemented; the planner comparison is part of the benchmark,
and the chosen default is recorded in `docs/testing.md` with its query plan.

Range criteria on quantities always compare **normalized base values** (ADR-0015), so a
filter expressed in PSI matches a value entered in bar.

### Indexes

- `(attribute_key, term_id, variant_id)` — enum, nominal size, pressure class, certification
- `(attribute_key, num_value, variant_id)` — quantity and numeric range
- `(attribute_key, bool_value, variant_id)`
- GIN `pg_trgm` on `text_value` for substring search
- `(variant_id)` for the rebuild path

### Facet counts

Facet _counts_ (how many results remain per candidate value) are computed over the
already-restricted variant set, not the whole catalogue, and are capped and cached per
query shape only if measurement shows a need.

### SLO — provisional, pending owner input on catalogue size

Until questions F1–F5 are answered, the working target is:

- **p50 < 25 ms, p95 < 100 ms, p99 < 250 ms**
- at **250,000 variants**, ~400 attributes, 3–7 simultaneous criteria
- at **50 concurrent filter queries**
- warm cache, on the production instance class

These numbers are an assumption of record in `docs/assumptions.md` (A-014) and will be
re-set the moment real figures arrive. `tests/perf/product-filter.perf.ts` generates a
synthetic catalogue at the stated size and fails if the SLO is missed.

### Escalation ladder

No component is added without evidence, in this order: index tuning → query reshaping →
`work_mem`/planner tuning → per-type accelerator projections → materialized `jsonb`+GIN
accelerator → external search engine (requires a new ADR and owner approval).

## Alternatives considered

- **Elasticsearch/OpenSearch from day one.** Rejected per §80. It is also the wrong first
  move: it would mean a second copy of the catalogue, an eventual-consistency window that
  violates AC5, and a second cluster to operate.
- **PostgreSQL full-text (`tsvector`) as the primary filter mechanism.** Wrong tool:
  faceted filtering on typed values is not text search. `tsvector` is retained for
  free-text product search over names and descriptions, which is a different endpoint.
- **Application-side intersection.** Rejected: moves set operations out of the database
  and off the indexes.

## Consequences

- The performance suite is part of the definition of done for the PIM phases, not an
  afterthought.
- If PostgreSQL genuinely cannot meet the SLO at the real catalogue size, we will have
  the query plans and the benchmark to justify the next step, which is exactly what §83
  demands.

## Risks

The provisional dataset size may be badly wrong in either direction. Mitigated by making
it a parameter of the benchmark rather than a hard-coded assumption.

## Reversal cost

Low — this layer is derived and replaceable.

## Revisit if

Real catalogue figures arrive (questions F1–F5), or the benchmark fails.
