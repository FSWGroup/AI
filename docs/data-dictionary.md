# Data dictionary

What every table means, and — more importantly — what the words mean. Written for an
engineer joining FSW who was not part of any of these conversations.

Distinctions that look pedantic here are the ones that cost the most to get wrong.

---

## Terminology first

| Term                   | Means                                                                                                                          | Does **not** mean                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Organization**       | A company or legal/business entity. Exists whether or not FSW trades with it.                                                  | A plant, an account, or an address                                       |
| **Site**               | A physical facility an organization operates — a plant, a headquarters, a distribution centre. The thing a salesperson visits. | An address, or a ship-to                                                 |
| **Location**           | A postal or physical address. Raw text plus a normalized form.                                                                 | A business entity                                                        |
| **Commercial account** | A source-system accounting construct: a P21 customer, a ValveMan web customer.                                                 | An organization. One organization routinely has several                  |
| **Ship-to**            | A commercial and logistical role referencing a location.                                                                       | A plant. It may be a loading dock, a job trailer, or a freight forwarder |
| **Brand**              | A trade name products are sold under, owned by an organization.                                                                | The manufacturer, necessarily                                            |
| **Product**            | A manufacturer's model series.                                                                                                 | An orderable item                                                        |
| **Variant**            | An orderable configuration of a product — what a customer actually buys.                                                       | A model series                                                           |
| **Attribute**          | A _definition_: what a property means, its type, its unit dimension.                                                           | A value                                                                  |
| **Attribute value**    | One assertion about one product or variant, from one source.                                                                   | The truth. It is a candidate                                             |
| **Candidate value**    | What one source says a field is.                                                                                               | The canonical value                                                      |
| **Survivor**           | The candidate that survivorship selected. Losing candidates are kept.                                                          | The only value that ever existed                                         |
| **Source record**      | What a source system actually said, preserved verbatim with a checksum.                                                        | A canonical record                                                       |
| **Designation**        | A controlled engineering name — `ASME Class 150`, `NPS 1"`.                                                                    | A measurement                                                            |
| **Quantity**           | A measurement with a value, a unit, and a dimension.                                                                           | A designation                                                            |

---

## `kernel` — shared primitives

Deliberately small. Not a dumping ground.

| Table               | Purpose                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_migration`  | Applied migrations with SHA-256 checksums. Editing an applied migration makes the runner refuse to start (ADR-0006)                                                                 |
| `operating_company` | `FSW_GROUP`, `WELSFORD`, `VALVEMAN`. The authorization scope and the data visibility boundary                                                                                       |
| `source_system`     | Every system that asserts facts, **including `MANUAL`** (a human editing) and `MODEL_PARSER` (a derivation). `default_priority` is the fallback survivorship precedence; lower wins |
| `idempotency_key`   | Replay protection for mutating endpoints. Same key + same request fingerprint returns the stored response; a different fingerprint is a 422                                         |

`kernel.uuid_generate_v7()` generates canonical identifiers in SQL; `src/kernel/id.ts`
does the same in the application, with a 12-bit counter guaranteeing monotonicity within
a millisecond.

`kernel.machine_key` (lowercase snake_case) and `kernel.code_key` (uppercase) are domains
that enforce naming once rather than in forty check constraints.

---

## `audit` — who changed what

`audit.change_log` answers: who changed this record, when, through which interface, from
where, and exactly what changed.

Written by the UnitOfWork in the same transaction as the change, because the actor,
interface, correlation ID and reason live in the request context and a trigger cannot
see them (ADR-0021).

| Column group                           | Notes                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `actor_*`                              | The principal, its type, and a human-readable label                                                                                       |
| `interface`, `client_ip`, `user_agent` | How the change arrived                                                                                                                    |
| `correlation_id`, `causation_id`       | Links an API call to the events it produced                                                                                               |
| `entity_*`, `operation`                | What changed. `DENY` records an authorization denial, which is auditable even though nothing changed                                      |
| `before`, `after`, `changed_fields`    | Secret-classified fields are `[redacted]` before they reach the table. PII is retained and removed later by an erasure request (ADR-0027) |
| `source_record_id`                     | For imported changes: the source record that carried the value                                                                            |

Immutability is a **grant**, not a convention: the application role has `INSERT` only.

---

## `events` — the ledger and its delivery

Two tables with sharply different mutability (ADR-0008).

| Table                | Mutability                                 | Purpose                                                                                                                                                          |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain_event`       | **Append-only.** `UPDATE`/`DELETE` revoked | The permanent, replayable record of what the business asserted                                                                                                   |
| `event_delivery`     | Fully mutable, prunable                    | Dispatch state per (event, subscription)                                                                                                                         |
| `subscription`       | Mutable                                    | Registered consumers, webhook or in-process                                                                                                                      |
| `consumer_inbox`     | Append-only in practice                    | What each consumer has already applied. Makes duplicate delivery a primary-key conflict rather than corruption                                                   |
| `consumer_cursor`    | Mutable                                    | How far each in-process projection has read. Setting it to 0 and clearing the read model is how a replay starts                                                  |
| `event_type_version` | Mutable metadata                           | Every event type and version the system may emit, with its JSON Schema. `domain_event` has a foreign key onto it, so an unregistered event **cannot** be emitted |

**`domain_event.sequence` is commit-ordered.** Sequence values are drawn under
`pg_advisory_xact_lock` held to commit, so a reader tailing `sequence > cursor` provably
cannot skip a committed event. A plain `BIGSERIAL` does not give this, and the difference
is invisible until a consumer silently misses an event under load.

**Payloads carry identifiers, never PII.** A CI check rejects a payload property that
looks like personal data. This is what lets a lawful erasure request and an immutable
ledger coexist (ADR-0009, ADR-0027).

---

## `pim` — units and quantities

### `quantity_dimension`

What a quantity measures. Two pairs are separate on purpose:

- **`TEMPERATURE` vs `TEMPERATURE_DIFFERENCE`.** 10 °C is 283.15 K; a 10 °C _difference_
  is 10 K. Converting one as the other is a classic and consequential bug.
- **`PRESSURE_GAUGE` vs `PRESSURE`.** Converting between them needs ambient pressure and
  must be an explicit engineering decision. Industrial valve data ("WOG 600 PSI") is
  almost always gauge.

`FLOW_COEFFICIENT` is its own dimension because Cv is a defined coefficient with a
specific test basis, not a plain volumetric flow.

### `unit`

UCUM codes. Conversion is affine: `base = value × factor_to_base + offset_to_base`.
Exactly one base unit per dimension, enforced by a partial unique index.

Two things worth knowing:

- A bare **`PSI`** deliberately resolves to nothing. It is genuinely ambiguous between
  gauge and absolute, and guessing is how gauge data ends up compared against absolute.
  A connector mapping declares the unit for its column once.
- **`kV`** (kilovolt) and **`[Kv]`** (flow coefficient) differ only by case, so codes are
  matched exactly and only explicit aliases are matched case-insensitively.

### `unit_alias`, `vocabulary_term_alias`

`normalized_alias` is uppercased with punctuation removed **except `/`, `.` and `-`**.
Those three carry meaning: stripping `/` makes the nominal size `1/2` collide with `12`,
turning a half-inch valve into a twelve-inch one.

---

## `pim` — vocabularies and designations

### `vocabulary`

`is_designation` marks a vocabulary of controlled **engineering designations** rather
than categories. `designation_kind` is `NOMINAL_SIZE` or `PRESSURE_CLASS`.

The unit conversion service **throws** if handed a term from a designation vocabulary.
There is no lenient path and no fallback.

### `vocabulary_term`

`sort_ordinal` orders sizes and classes correctly without their being numbers. **It is
not a measurement.** `ASME Class 150` has ordinal 150 for sorting; there is no column on
a term that could hold a pressure — no unit, no dimension, no quantity.

Designation terms also carry `size_system` (`NPS`, `DN`, `OD_TUBE`), `designation` (`1`,
`DN25`, `150`) and `reference_standard` (`ASME B16.34`).

### `vocabulary_term_alias`

The distinction that matters: `asserts_equivalence`.

- `316SS`, `SS316`, `SS 316` → aliases of `SS_316` that **assert equivalence**. Same thing.
- `CF8M` → alias of `SS_316` that does **not** assert equivalence, with a mandatory note:
  it is the cast grade (ASTM A351) commonly supplied for 316 service, but composition
  ranges and mechanical properties differ. Normalize it for search; do not treat a CF8M
  casting and wrought 316 as interchangeable without engineering review.

This is how the system normalizes messy source data without blindly declaring things
equal. A definitive alias may resolve to at most one term per vocabulary, enforced by a
partial unique index.

---

## `pim` — attributes and product types

### `attribute`

An attribute definition is **data**. Adding one is a pull request against
`config/metadata/` plus `npm run metadata:apply`. No code change, no migration, no
runtime DDL (ADR-0013, ADR-0017).

Value types:

| Value type                                      | Companion columns                                  | Notes                                   |
| ----------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| `TEXT`, `BOOLEAN`, `INTEGER`, `DECIMAL`, `DATE` | —                                                  |                                         |
| `QUANTITY`, `QUANTITY_RANGE`                    | `dimension_code` **required**, `default_unit_code` | A real measurement                      |
| `ENUM`                                          | `vocabulary_key` **required**                      | Must not be a designation vocabulary    |
| `NOMINAL_SIZE`                                  | `vocabulary_key`, kind `NOMINAL_SIZE`              | A designation                           |
| `PRESSURE_CLASS`                                | `vocabulary_key`, kind `PRESSURE_CLASS`            | A designation                           |
| `ENTITY_REF`                                    | `entity_type` **required**                         | A reference to another canonical entity |

Check constraints make the value type and its companions agree, so an attribute cannot be
incoherent. A composite foreign key against a generated column forces a `NOMINAL_SIZE`
attribute to use a nominal-size vocabulary and a `PRESSURE_CLASS` attribute to use a
pressure-class one.

`nominal_size` and `face_to_face` sitting side by side is the point: one is a
designation, the other is a measured length. So is `pressure_class` next to
`wog_pressure`.

Attributes are **deprecated and superseded, never deleted**: values recorded against them
remain meaningful.

### `product_type`

Hierarchical — a ball valve is a valve and inherits its ancestors' attribute
applicability. Cycles are rejected by a constraint trigger (PostgreSQL cannot express
"no cycles" declaratively; this is an invariant guard, not business logic).

`etim_class` and `etim_release` map to ETIM where useful. ETIM is an interoperability
vocabulary, never the master of FSW's domain (spec §33).

### `product_type_attribute`

Which attributes apply, how strongly (`REQUIRED`/`RECOMMENDED`/`OPTIONAL`), and at which
level (`LINE`/`FAMILY`/`PRODUCT`/`VARIANT`/`ANY`).

`condition` holds a predicate in the **FSW condition DSL** — a deliberately tiny,
versioned, non-executable language with no `eval`, no function reference, no loop and no
way to reach outside the attribute values it is handed. Example:

```yaml
- attribute: voltage
  requirement: REQUIRED
  condition: { all: [{ attr: actuation_type, op: in, value: [ELECTRIC, SOLENOID] }] }
  conditionNote: >-
    An electrically actuated or solenoid valve is not orderable without a supply
    voltage.
```

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `exists`, `missing`.
Combinators: `all`, `any`, `not`. Adding one is a code change, on purpose.

A `condition` **must** carry a `condition_note` explaining in prose why the rule exists,
and a rule that references an attribute the product type does not have is rejected: a
rule that can never fire is a mistake, not a no-op.

### `metadata_version`

Every application of `config/metadata/**`, with the content hash, the actor, and a
summary of what changed. An attribute value can be traced to the metadata version in
force when it was written.

---

## Conventions across every table

- Primary keys are UUIDv7, generated by FSW, never recycled, never derived from source
  data (ADR-0004).
- Human-readable `key` and `code` columns are **secondary** natural keys with their own
  unique constraints. Never primary keys, never what a consumer stores.
- No `p21_id`-style column exists outside the `ingest` schema. External identifiers live
  in crosswalk structures.
- All timestamps are `timestamptz`, stored in UTC.
- All decimals are `NUMERIC` and travel as strings; JavaScript's `number` never touches a
  value on its way to or from the database.
- Business entities are soft-deleted or deprecated, never dropped. Erasure of personal
  data is a separate, privileged, audited operation (ADR-0027).
