# ADR-0031: Read replica plus a modelled reporting schema; no warehouse in Layer 0

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§19 requires that BI queries not hammer canonical operational tables, that we start
simply, and that a warehouse is not built during Layer 0 without justification.

## Decision

Three steps, only the first two of which are Layer 0 work:

1. **Read replica.** All reporting and BI connections point at a physical read replica
   with the `fsw_readonly` role. No BI tool ever connects to the primary. This alone
   solves the stated problem.
2. **A modelled `reporting` schema** on the replica: intentional, documented, stable views
   designed for analytical questions — `reporting.dim_organization`,
   `reporting.dim_site`, `reporting.dim_product`, `reporting.fct_source_record_state`,
   `reporting.fct_data_quality` — rather than letting analysts join canonical tables and
   thereby couple every dashboard to the internal schema. The reporting views are a
   **published contract**, versioned like the API, and canonical schema changes must keep
   them working.
3. **A warehouse, later, when justified.** Documented migration path: the event feed
   (ADR-0010) is already the extraction mechanism, so loading into DuckDB, BigQuery,
   Snowflake, or Postgres-as-warehouse is a consumer, not a rearchitecture. Trigger
   conditions: cross-system analytics beyond Layer 0's own data; BI concurrency the
   replica cannot serve; retention or aggregation needs that distort the operational
   schema; or transformation logic complex enough to need dbt.

Data-quality metrics (§64) are first-class citizens of the reporting schema, not an
afterthought: completeness by product type, products missing manufacturer identifiers,
unresolved duplicate accounts, stale source records, contradictory source values,
source-to-canonical mapping coverage, orphaned source records, invalid units, and
unresolved model numbers.

## Alternatives considered

- **Let BI query the primary.** The problem §19 names.
- **Build a warehouse now.** Rejected: no identified requirement, and it would be a
  second data platform for a team that does not yet have one.
- **Materialized views on the primary.** Useful selectively; they still consume primary
  resources on refresh and do not solve BI concurrency.

## Consequences

- A replica costs money and is the cheapest possible answer to the requirement.
- The reporting contract adds a compatibility obligation, which is the point.

## Reversal cost

Low.

## Revisit if

Any trigger condition above is met, or L1/L2 reveal an immediate reporting requirement.
