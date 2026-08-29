# ADR-0016: Nominal size and pressure class are controlled designations, not measurements

- Status: Accepted (provisional)
- Date: 2026-08-29
- Enforces: specification §29, §30, acceptance criterion 7

## Context

Two errors are endemic in industrial product data and both are actively harmful:

1. Treating **NPS 1"** as a 25.4 mm measured diameter. It is not: NPS 1 pipe has an
   outside diameter of 1.315 in. Nominal size is a designation within a sizing system,
   not a length.
2. Treating **ASME Class 150** as 150 PSI. It is not: Class 150 is a
   pressure–temperature rating designation whose allowable working pressure depends on
   material and temperature — a Class 150 carbon-steel flange is rated about 285 psig at
   ambient and well under 150 psig at 750 °F.

A system that normalizes either of these into a quantity will eventually contribute to a
misapplied valve. This is the requirement in the specification that has physical
consequences.

## Decision

**Both are vocabulary-backed value types with no conversion path to any quantity.**

- `NOMINAL_SIZE` values reference terms in a nominal-size vocabulary. Each term carries
  `size_system` (`NPS`, `DN`, `OD_TUBE`, `JIS`, `ISO`), a `designation` (`1`, `DN25`,
  `1/2`), an optional `reference_standard` (`ASME B36.10M`), and a `sort_ordinal` so
  sizes order correctly without being numbers. Cross-system equivalence (NPS 1 ≈ DN 25)
  is an explicit, evidence-bearing `NOMINAL_SIZE_EQUIVALENT` relationship between terms,
  flagged as a **conventional correspondence, not an identity**.
- `PRESSURE_CLASS` values reference terms in a pressure-class vocabulary. Each term
  carries `standard` (`ASME B16.34`, `EN 1092-1`, `API 6A`), a `class_designation`
  (`150`, `300`, `PN16`), and a `class_ordinal` for ordering. The number in the
  designation is **metadata for sorting and display only** and is never exposed as a
  pressure.
- Actual measured pressures — WOG rating, maximum working pressure, test pressure,
  set pressure — are ordinary `QUANTITY` attributes with dimension `PRESSURE` (ADR-0015).
  A product routinely has both: pressure class *and* a WOG rating.

### Mechanical enforcement

- The database `CHECK` constraints on `pim.attribute_value` (ADR-0013) make it
  physically impossible for a `PRESSURE_CLASS` attribute to populate a numeric or
  quantity column, or for a `QUANTITY` attribute to populate `value_term_id`.
- `pim.vocabulary` rows for designation vocabularies carry `is_designation = true`, and
  the unit-conversion service **throws** if handed a designation term. There is no code
  path from a designation to a quantity: not a lenient one, not a fallback one.
- `tests/pim/engineering-semantics.test.ts` asserts, as required by acceptance criterion
  7, that "Class 150" cannot become 150 PSI and that NPS 1 is not 25.4 mm — by attempting
  the conversion and requiring it to fail, and by attempting to store a pressure class in
  a quantity attribute and requiring the database to reject it.
- Ingestion mappings that encounter a bare `150` in a "pressure class" source column map
  it to the class term; a bare `150 PSI` in a "pressure" column maps to a quantity.
  Ambiguous source columns are quarantined, not guessed.

## Alternatives considered

- **Store both as enums with an attached numeric "for convenience".** Rejected: the
  convenience field is exactly the thing that leaks into a comparison and causes the harm.
- **Store nominal size as a length with a `is_nominal` flag.** Rejected for the same
  reason; a flag does not stop a range query.
- **Store as free text.** Rejected: no ordering, no filtering, no normalization of
  `1"` vs `1 in` vs `NPS 1`.

## Consequences

- Sorting sizes and classes requires the ordinal metadata on the term. Cheap and correct.
- "Find valves rated for at least 200 psig at 400 °F" is a *derived* question requiring
  pressure–temperature rating tables per material and class. Those tables are a legitimate
  future PIM capability; they are explicitly not a conversion, and they are out of scope
  for v1.

## Risks

A future developer adds a numeric shortcut under delivery pressure. Mitigated by the
constraint, the throwing conversion service, and the named test.

## Reversal cost

High, and deliberately so.

## Revisit if

Never for the semantic distinction. The pressure–temperature rating table capability is
a separate, additive decision.
