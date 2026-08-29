# ADR-0007: One canonical Party model; organizations play roles

- Status: Accepted (provisional)
- Date: 2026-08-29
- Resolves: specification §6, §8 conflict item 8, §45

## Context

PIM needs manufacturers and brand owners. Account Master needs customers, prospects,
parents, and subsidiaries. Procurement needs suppliers. Welsford needs specifiers
(A&E firms) and OEMs. The same real company routinely plays several of these roles: a
manufacturer FSW represents may also buy equipment from FSW; a distributor may be both
competitor and supplier.

If PIM has a `manufacturer` table and Account Master has an `organization` table, then
"Emerson the vendor" and "Emerson the customer" are permanently different records, and
no future application can answer a question that spans them.

## Decision

**One `party.organization` table.** Roles are rows in `party.organization_role`, each
with a role type, an owning operating-company scope where relevant, effective dates, and
provenance.

Role types (v1): `CUSTOMER`, `PROSPECT`, `MANUFACTURER`, `BRAND_OWNER`, `SUPPLIER`,
`DISTRIBUTOR`, `MANUFACTURER_REP`, `SPECIFIER`, `OEM`, `CONTRACTOR`, `END_USER`,
`CARRIER`, `INTERNAL` (the FSW entities themselves).

Four concepts are kept rigorously distinct, because collapsing them is the single most
common and most expensive MDM mistake:

| Concept                | Table                      | Definition                                                                                                                              |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization**       | `party.organization`       | A company or legal/business entity. Exists whether or not FSW trades with it.                                                           |
| **Site**               | `party.site`               | A physical facility an organization operates: a plant, a headquarters, a distribution centre. The thing a salesperson visits.           |
| **Location**           | `party.location`           | A postal or physical address. Raw text plus a normalized form. Not a business entity.                                                   |
| **Commercial account** | `party.commercial_account` | A source-system accounting construct — a P21 customer, a ValveMan web customer. Belongs to an organization; not itself an organization. |

`party.ship_to` is a **commercial and logistical role referencing a location**, optionally
associated with a site. A ship-to is not a plant. A ship-to may be a loading dock, a job
trailer, a third-party warehouse, or a customer's freight forwarder.

`party.person` is the single canonical human, shared by IAM and Account Master
(ADR-0020). Employment and customer contact roles are `party.person_affiliation` rows
with effective dates, never a boolean on the person.

## Alternatives considered

- **Separate `pim.manufacturer` and `party.organization`.** Rejected: guarantees
  permanent divergence and makes ADR-0012 merges meaningless for manufacturers.
- **A fully abstract Party supertype with Organization and Person subtypes** (the
  classic Party model). Rejected as over-general: FSW has no real case where a natural
  person is a customer account, and the abstraction would make every query one join
  deeper for no benefit. Organizations and persons are separate tables that share
  conventions, not a supertype hierarchy.
- **Role as a column on the organization.** Rejected: an organization has many roles
  simultaneously and they change over time.

## Why this wins

It is the only shape that lets a future application ask "what do we know about this
plant across every FSW business" — the question that motivates the entire project.

## Consequences

- PIM depends on `party` for manufacturer and brand-owner identity. This is an accepted
  cross-module foreign key, listed in the coupling inventory (ADR-0003).
- Authorization must consider that one organization can be visible to Welsford through
  one role and to ValveMan through another (see ADR-0019 and open question I6).
- Entity resolution operates on organizations, so merging a manufacturer record and a
  customer record for the same company is a normal, supported operation.

## Risks

Role explosion — the temptation to add a role type for every nuance. Mitigated by
requiring a data-dictionary entry and a stated consumer for every new role type.

## Reversal cost

Extremely high after mastering begins. This is a day-one decision.

## Revisit if

A role type needs attributes so extensive that it is really a separate aggregate; that
argues for a satellite table keyed by organization, not for a second organization table.
