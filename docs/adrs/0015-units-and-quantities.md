# ADR-0015: Units are first-class; UCUM codes, affine conversion, normalized base values

- Status: Accepted (provisional)
- Date: 2026-08-29

## Context

§31 requires that a quantity know its dimension, preserve what was entered, and remain
comparable across unit systems — so that a product entered as "10 bar" matches a PSI
range query. Temperature makes this non-trivial, because Celsius and Fahrenheit are
affine, not merely scaled: converting a temperature and converting a temperature
*difference* are different operations.

## Decision

### Model

- `pim.quantity_dimension` — `PRESSURE`, `TEMPERATURE`, `TEMPERATURE_DIFFERENCE`,
  `LENGTH`, `MASS`, `FLOW_VOLUMETRIC`, `FLOW_MASS`, `TORQUE`, `FORCE`, `VOLTAGE`,
  `CURRENT`, `POWER`, `FREQUENCY`, `AREA`, `VOLUME`, `ANGLE`, `TIME`, `VELOCITY`,
  `DENSITY`, `DIMENSIONLESS`. Each names its base unit.
- `pim.unit` — `code` (UCUM, e.g. `bar`, `[psi]`, `Cel`, `[degF]`, `mm`, `[in_i]`,
  `N.m`, `L/min`), `dimension`, `factor_to_base` and `offset_to_base` (both `NUMERIC`),
  display symbol, and aliases.
- Conversion is affine in both directions: `base = value × factor + offset`,
  `value = (base − offset) ÷ factor`. Pure scaling is the case where `offset = 0`.

`TEMPERATURE` and `TEMPERATURE_DIFFERENCE` are **separate dimensions**. A 10 °C
temperature is 283.15 K; a 10 °C *difference* is 10 K. Conflating them is a classic and
consequential engineering bug, so the type system refuses to.

### Storage

Every quantity persists four things: `value_qty_original` (exactly as entered or
received), `value_qty_original_unit`, `value_qty_base` (normalized), and
`value_qty_dimension`. Comparison, filtering, and sorting always use the base value;
display defaults to the original. A response can render any unit in the same dimension
on request.

### Arithmetic

All conversion arithmetic uses `decimal.js` at 34 significant digits and persists to
`NUMERIC`. Conversion factors are exact rationals where the definition is exact
(1 in = 25.4 mm exactly; 1 psi = 6894.757293168361... Pa by definition of the pound-force
and inch), stored to sufficient precision and documented in
`docs/data-dictionary.md#units`.

### Testing

Table-driven and property tests are mandatory (§65):

- round-trip: `to_base(from_base(x)) ≈ x` within tolerance, for every unit
- known reference conversions from published standards
- boundary values: zero, negative (meaningful for temperature and gauge pressure), very
  large, very small
- temperature offsets in both directions, including the −40 crossover where °C = °F
- range endpoints, ensuring min/max survive conversion in the correct order
- rounding and precision behaviour at the declared attribute precision

### Gauge vs. absolute pressure

Recorded as a distinct unit code (`bar` vs `bar-g`, `[psi]` vs `[psig]`), not as a flag,
because a gauge-to-absolute conversion depends on ambient pressure and must be explicit
rather than implicit. Industrial data overwhelmingly means gauge; the ingestion mappings
declare which, per source, rather than guessing.

## Alternatives considered

- **A units library (`js-quantities`, `mathjs` units).** Rejected as the *authority*:
  the unit table must be data in our database so that ingestion mappings, the API, and
  the facet layer share one definition and so that new units are configuration, not a
  dependency upgrade. A library may be used in tests as an independent oracle.
- **Store only normalized values.** Rejected by §31 — destroys what the source said.
- **Store only original values and convert on read.** Rejected — makes range filtering
  impossible to index.
- **Non-UCUM ad-hoc codes.** Rejected: UCUM is the mature standard, is unambiguous, and
  interoperates with ETIM and healthcare/industrial exchange formats.

## Consequences

- Four columns per quantity. Accepted; they are cheap and they are the requirement.
- A source that supplies a bare number without a unit is a **validation failure**, not a
  guess. The connector's mapping must declare the unit, or the record is quarantined.

## Risks

Wrong conversion factors are silent and corrosive. Mitigated by reference-value tests
drawn from published standards and by an independent-oracle test.

## Reversal cost

High — stored base values would need recomputation, though that is mechanical and
scriptable since originals are preserved. Preserving originals is precisely what makes
this recoverable.

## Revisit if

A dimension is needed that affine conversion cannot express (e.g. logarithmic units such
as dB), which would require a per-dimension conversion strategy rather than a shared one.
