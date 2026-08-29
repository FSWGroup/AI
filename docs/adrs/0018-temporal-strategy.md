# ADR-0018: Valid time where it is a business fact; system time from audit and ledger

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§20 asks for bitemporal modelling where historical truth matters, and explicitly warns
against making every table bitemporal. Full bitemporality — valid time _and_ system time
as first-class table structure — roughly doubles the modelling and query cost and is a
leading source of subtle defects in small teams.

The motivating example is real: a manufacturer tells us on 10 March that a pressure
rating changed effective 1 February. Both dates matter.

## Decision

**Valid time is modelled explicitly where the business needs it. System time is answered
from the audit log and the event ledger, not from bitemporal table structure.**

### Valid time (`valid_from`, `valid_to`, or a `daterange`/`tstzrange`) on:

- `pim.attribute_value` — product specifications
- product and variant lifecycle status
- `pim.product_relationship` — cross-references and supersession
- certifications and their applicability
- `party.organization_role`, `party.person_affiliation`, `party.organization_relationship`
- pricing facts, if pricing is ever admitted (ADR-0032)

Non-overlap is enforced by exclusion constraints using `btree_gist` where a fact must be
single-valued at a point in time, rather than by application checks.

### System time comes from:

- `audit.change_log` — who changed what, when, through which interface, before/after
- `events.domain_event` — the ordered, replayable record of what the system asserted and
  when it asserted it
- `ingest.source_record_version` — what each source said, at each extraction

Together these answer "what did we know, and when did we know it" for any record,
which is the requirement §20 is actually reaching for. In the manufacturer example:
`valid_from = 1 February` on the new attribute value, and `recorded_at = 10 March` on
both the row and its event. Both dates are represented, with one temporal dimension in
the table.

### Where full bitemporality is genuinely required

If a named business question requires _reproducing a past query result as the system
would have answered it on a past date_ — for example reconstructing the specification
sheet that was submitted with a quote in 2027 — that is added to specific tables as
`system_from`/`system_to` at that time, as an additive migration. No such requirement has
been identified yet, and the specification's own guidance is not to build it speculatively.

## Alternatives considered

- **Full bitemporality everywhere.** Rejected: cost without an identified consumer, and
  a substantial ongoing tax on every query a future developer writes.
- **Neither; overwrite and rely on audit.** Rejected: forward-dated and back-dated facts
  are ordinary in this domain, and audit cannot express "true from 1 February".
- **An append-only satellite table per entity (Data Vault style).** Rejected as
  over-engineering for a small team; it is bitemporality with more joins.

## Consequences

- Queries default to "currently valid": `valid_from <= now() AND (valid_to IS NULL OR
valid_to > now())`, wrapped in helper views so this is not retyped and mistyped.
- "As of" queries in valid time are supported today; "as we knew it" queries are answered
  by reading the ledger, which is slower and less convenient — an accepted trade.

## Risks

A future need for true bitemporality on an already-large table. Mitigated by the fact
that the audit log and ledger retain enough information to backfill system time if it is
ever required.

## Reversal cost

Moderate — adding system time later is additive but requires a careful backfill.

## Revisit if

A named business question requires reproducing historical query results as answered at
the time.
