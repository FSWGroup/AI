/**
 * Unit conversion (ADR-0015).
 *
 * Every quantity knows its dimension, keeps what was entered, and carries a
 * normalized base value so a filter expressed in PSI matches a value entered in bar.
 *
 * Conversion is affine in both directions:
 *
 *     base  = value * factor + offset
 *     value = (base - offset) / factor
 *
 * Pure scaling is the case where offset = 0. Temperature is not: 10 degC is 283.15 K,
 * which is why TEMPERATURE and TEMPERATURE_DIFFERENCE are separate dimensions.
 *
 * All arithmetic uses decimal.js at 34 significant digits. JavaScript's `number` never
 * touches a value on its way to or from the database.
 */
import { Decimal } from 'decimal.js';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

export type DecimalLike = Decimal | string | number;

export interface UnitDefinition {
  readonly code: string;
  readonly dimension: string;
  readonly name: string;
  readonly symbol: string;
  readonly factorToBase: string;
  readonly offsetToBase: string;
  readonly isBase: boolean;
  readonly aliases: readonly string[];
}

export interface Quantity {
  readonly value: Decimal;
  readonly unit: string;
  readonly dimension: string;
}

export class UnknownUnitError extends Error {
  constructor(code: string) {
    super(
      `Unknown unit '${code}'. Units are data: add it to config/metadata/units.yaml ` +
        `rather than converting by hand.`,
    );
    this.name = 'UnknownUnitError';
  }
}

export class DimensionMismatchError extends Error {
  constructor(from: string, to: string, fromDimension: string, toDimension: string) {
    super(
      `Cannot convert '${from}' (${fromDimension}) to '${to}' (${toDimension}): ` +
        `different dimensions.`,
    );
    this.name = 'DimensionMismatchError';
  }
}

/**
 * Raised when something tries to treat an engineering designation as a measurement.
 *
 * This is the guard behind acceptance criterion 7. ASME Class 150 is a
 * pressure-temperature rating designation whose allowable working pressure depends on
 * material and temperature; a Class 150 carbon-steel flange is rated around 285 psig
 * at ambient and well under 150 psig at 750 F. Turning it into "150 PSI" is how a
 * valve gets misapplied.
 */
export class NotAQuantityError extends Error {
  readonly designation: string;
  constructor(designation: string, kind: string) {
    super(
      `'${designation}' is a ${kind.toLowerCase().replace(/_/g, ' ')} designation, ` +
        `not a measurement, and has no conversion to any quantity. ` +
        `See ADR-0016. If you need a measured pressure, use the product's ` +
        `working-pressure or WOG attribute, which is a QUANTITY.`,
    );
    this.name = 'NotAQuantityError';
    this.designation = designation;
  }
}

/**
 * Normalize a spelling for lookup. Uppercased, with punctuation removed EXCEPT
 * '/', '.' and '-', which carry meaning in engineering designations: stripping '/'
 * makes the nominal size '1/2' collide with '12'. Must stay identical to the
 * generated columns in db/migrations/0008.
 */
export function normalizeAlias(text: string): string {
  return text.replace(/[^a-zA-Z0-9/.-]/g, '').toUpperCase();
}

export class UnitRegistry {
  readonly #byCode = new Map<string, UnitDefinition>();
  readonly #byAlias = new Map<string, UnitDefinition>();
  readonly #baseByDimension = new Map<string, UnitDefinition>();
  /** Designation codes, so a misuse produces a precise error instead of "unknown unit". */
  readonly #designations = new Map<string, string>();

  constructor(
    units: readonly UnitDefinition[],
    designations: ReadonlyMap<string, string> = new Map(),
  ) {
    for (const unit of units) {
      if (this.#byCode.has(unit.code)) {
        throw new Error(`Duplicate unit code '${unit.code}'`);
      }
      this.#byCode.set(unit.code, unit);
      // Codes are matched EXACTLY, never through the case-insensitive alias map.
      // 'kV' (kilovolt) and '[Kv]' (flow coefficient) differ only by case, and
      // conflating them would silently mix an electrical supply with valve capacity.
      for (const alias of unit.aliases) {
        const key = normalizeAlias(alias);
        const existing = this.#byAlias.get(key);
        if (existing !== undefined && existing.code !== unit.code) {
          throw new Error(
            `Unit alias '${alias}' is ambiguous between '${existing.code}' and '${unit.code}'`,
          );
        }
        this.#byAlias.set(key, unit);
      }
      if (unit.isBase) {
        if (this.#baseByDimension.has(unit.dimension)) {
          throw new Error(`Dimension '${unit.dimension}' has more than one base unit`);
        }
        this.#baseByDimension.set(unit.dimension, unit);
      }
    }

    for (const dimension of new Set(units.map((u) => u.dimension))) {
      if (!this.#baseByDimension.has(dimension)) {
        throw new Error(`Dimension '${dimension}' has no base unit`);
      }
    }

    for (const [code, kind] of designations) this.#designations.set(code, kind);
  }

  has(code: string): boolean {
    return this.#byCode.has(code);
  }

  get(code: string): UnitDefinition {
    const designationKind = this.#designations.get(code);
    if (designationKind !== undefined) throw new NotAQuantityError(code, designationKind);
    const unit = this.#byCode.get(code);
    if (unit === undefined) throw new UnknownUnitError(code);
    return unit;
  }

  /**
   * Resolve a spelling seen in source data. Exact code first, then the
   * case-insensitive alias map. Returns undefined rather than guessing -- a unit that
   * cannot be resolved is a validation failure, not an assumption (spec §31).
   */
  resolve(text: string): UnitDefinition | undefined {
    return this.#byCode.get(text) ?? this.#byAlias.get(normalizeAlias(text));
  }

  baseUnitOf(dimension: string): UnitDefinition {
    const unit = this.#baseByDimension.get(dimension);
    if (unit === undefined) throw new Error(`Unknown dimension '${dimension}'`);
    return unit;
  }

  /** Normalize to the dimension's base unit. This is what gets indexed and compared. */
  toBase(value: DecimalLike, unitCode: string): Quantity {
    const unit = this.get(unitCode);
    const normalized = new Decimal(value)
      .times(unit.factorToBase)
      .plus(unit.offsetToBase);
    return {
      value: normalized,
      unit: this.baseUnitOf(unit.dimension).code,
      dimension: unit.dimension,
    };
  }

  fromBase(baseValue: DecimalLike, unitCode: string): Quantity {
    const unit = this.get(unitCode);
    const value = new Decimal(baseValue)
      .minus(unit.offsetToBase)
      .dividedBy(unit.factorToBase);
    return { value, unit: unit.code, dimension: unit.dimension };
  }

  convert(value: DecimalLike, fromCode: string, toCode: string): Quantity {
    const from = this.get(fromCode);
    const to = this.get(toCode);
    if (from.dimension !== to.dimension) {
      throw new DimensionMismatchError(fromCode, toCode, from.dimension, to.dimension);
    }
    if (from.code === to.code) {
      return { value: new Decimal(value), unit: to.code, dimension: to.dimension };
    }
    return this.fromBase(this.toBase(value, fromCode).value, toCode);
  }

  unitsFor(dimension: string): readonly UnitDefinition[] {
    return [...this.#byCode.values()].filter((u) => u.dimension === dimension);
  }

  all(): readonly UnitDefinition[] {
    return [...this.#byCode.values()];
  }
}

/**
 * Round for storage at an attribute's declared scale. Half-even, because half-up
 * biases a catalogue of measurements upward.
 */
export function roundToScale(
  value: DecimalLike,
  scale: number | null | undefined,
): Decimal {
  const decimal = new Decimal(value);
  return scale === null || scale === undefined
    ? decimal
    : decimal.toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
}

export { Decimal };
