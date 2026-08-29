import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { applyRealMetadata } from '../support/metadata.js';
import {
  loadUnitRegistry,
  UnitRegistry,
  UnknownUnitError,
  DimensionMismatchError,
  Decimal,
} from '../../src/modules/pim/index.js';

/** Relative closeness, so assertions do not depend on decimal.js internals. */
function expectClose(actual: Decimal, expected: string, tolerance = '1e-24'): void {
  const target = new Decimal(expected);
  const difference = actual.minus(target).abs();
  const scale = Decimal.max(target.abs(), new Decimal(1));
  expect(
    difference.dividedBy(scale).lessThan(new Decimal(tolerance)),
    `expected ${actual.toString()} to be close to ${expected}`,
  ).toBe(true);
}

describe('unit conversion (ADR-0015, acceptance criterion 6)', () => {
  let testDb: TestDatabase;
  let units: UnitRegistry;

  beforeAll(async () => {
    testDb = await createTestDatabase('units');
    await applyRealMetadata(testDb.db);
    units = await loadUnitRegistry(testDb.db);
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('preserves the original, normalizes to base, and returns any unit on request', () => {
    // The acceptance criterion: enter a pressure in bar, keep what was entered, store
    // the normalized value, and answer in PSI.
    const entered = { value: '10', unit: 'bar' };

    const normalized = units.toBase(entered.value, entered.unit);
    expect(normalized.unit).toBe('Pa');
    expect(normalized.dimension).toBe('PRESSURE');
    expectClose(normalized.value, '1000000');

    const asPsi = units.fromBase(normalized.value, '[psi]');
    expectClose(asPsi.value, '145.037737730209215154241027951');

    // The original is untouched, which is the half of the requirement that a naive
    // implementation loses.
    expect(entered).toEqual({ value: '10', unit: 'bar' });
  });

  it('converts known reference values correctly', () => {
    const cases: readonly [string, string, string, string][] = [
      // value, from, to, expected
      ['1', '[in_i]', 'mm', '25.4'],
      ['12', '[in_i]', '[ft_i]', '1'],
      ['1', '[lb_av]', 'kg', '0.45359237'],
      ['100', 'Cel', 'K', '373.15'],
      ['100', 'Cel', '[degF]', '212'],
      ['0', 'Cel', '[degF]', '32'],
      ['-40', 'Cel', '[degF]', '-40'],
      ['0', '[degF]', 'K', '255.3722222222222222222222222222'],
      ['1', 'bar', '[psi]', '14.5037737730209215154241027951'],
      ['1', 'atm', 'kPa', '101.325'],
      ['1', '[gal_us]/min', 'L/min', '3.785411784'],
      ['1', '[in_lbf]', 'N.m', '0.1129848290276167'],
      ['1', '[ft_lbf]', '[in_lbf]', '12'],
      ['1', '[Cv]', '[Kv]', '0.8650000000000000000000000000'],
      ['1', 'rad', 'deg', '57.29577951308232087679815481'],
      ['1', 'h', 'min', '60'],
    ];
    for (const [value, from, to, expected] of cases) {
      expectClose(units.convert(value, from, to).value, expected, '1e-20');
    }
  });

  it('keeps temperature and temperature difference apart', () => {
    // 10 degC is 283.15 K. A 10 degC *difference* is 10 K. Conflating them is a
    // classic bug, so they are separate dimensions and cannot be converted between.
    expectClose(units.toBase('10', 'Cel').value, '283.15');
    expectClose(units.toBase('10', 'Cel{diff}').value, '10');
    expect(() => units.convert('10', 'Cel', 'K{diff}')).toThrow(DimensionMismatchError);
    expect(() => units.convert('10', 'Cel{diff}', 'K')).toThrow(DimensionMismatchError);
  });

  it('keeps gauge and absolute pressure apart', () => {
    // Converting between them needs ambient pressure, so it must be an explicit
    // engineering decision, never an implicit unit conversion.
    expect(() => units.convert('100', '[psig]', '[psi]')).toThrow(DimensionMismatchError);
    expect(() => units.convert('1', 'bar{gauge}', 'bar')).toThrow(DimensionMismatchError);
  });

  it('refuses to convert across dimensions', () => {
    expect(() => units.convert('1', 'mm', 'kg')).toThrow(DimensionMismatchError);
    expect(() => units.convert('1', '[psi]', 'Cel')).toThrow(DimensionMismatchError);
  });

  it('refuses to guess at an unknown unit', () => {
    expect(() => units.get('furlongs')).toThrow(UnknownUnitError);
    expect(units.resolve('furlongs')).toBeUndefined();
  });

  it('resolves the spellings source data actually uses', () => {
    expect(units.resolve('PSIG')?.code).toBe('[psig]');
    expect(units.resolve('psi g')?.code).toBe('[psig]');
    expect(units.resolve('inches')?.code).toBe('[in_i]');
    expect(units.resolve('DEG F')?.code).toBe('[degF]');
    expect(units.resolve('lbs')?.code).toBe('[lb_av]');
    expect(units.resolve('GPM')?.code).toBe('[gal_us]/min');
    expect(units.resolve('ft-lbs')?.code).toBe('[ft_lbf]');
  });

  it('leaves a bare "PSI" unresolved rather than guessing gauge or absolute', () => {
    // Industrial data usually means gauge, but "usually" is not a basis for comparing
    // pressures. A connector mapping declares the unit for its column; free text that
    // says only "psi" is a validation failure, not an assumption (spec §31).
    expect(units.resolve('psi')).toBeUndefined();
    expect(units.resolve('PSI')).toBeUndefined();
  });

  it('distinguishes Kv from kV, which differ only by case', () => {
    // Flow coefficient versus kilovolt. Case-insensitive matching here would silently
    // mix valve capacity with electrical supply.
    expect(units.get('[Kv]').dimension).toBe('FLOW_COEFFICIENT');
    expect(units.get('kV').dimension).toBe('VOLTAGE');
    expect(units.resolve('[Kv]')?.dimension).toBe('FLOW_COEFFICIENT');
    expect(units.resolve('kV')?.dimension).toBe('VOLTAGE');
  });

  it('round-trips every unit through its base', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...units.all().map((u) => u.code)),
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (code, raw) => {
          const value = new Decimal(raw.toFixed(6));
          const base = units.toBase(value, code);
          const back = units.fromBase(base.value, code);
          expectClose(back.value, value.toString(), '1e-20');
        },
      ),
      { numRuns: 400 },
    );
  });

  it('round-trips every pair of units within a dimension', () => {
    for (const dimension of new Set(units.all().map((u) => u.dimension))) {
      const codes = units.unitsFor(dimension).map((u) => u.code);
      for (const from of codes) {
        for (const to of codes) {
          const converted = units.convert('123.456', from, to);
          const back = units.convert(converted.value, to, from);
          expectClose(back.value, '123.456', '1e-20');
        }
      }
    }
  });

  it('preserves ordering through conversion, including across zero', () => {
    // A range filter converted into base values must not invert its endpoints.
    for (const [from, to] of [
      ['Cel', '[degF]'],
      ['[degF]', 'K'],
      ['bar', '[psi]'],
      ['[in_i]', 'mm'],
    ] as const) {
      const values = ['-273', '-40', '-1', '0', '1', '100', '1000'];
      const converted = values.map((v) => units.convert(v, from, to).value);
      for (let i = 1; i < converted.length; i += 1) {
        expect(converted[i]!.greaterThan(converted[i - 1]!)).toBe(true);
      }
    }
  });

  it('rejects a registry with a dimension that has no base unit', () => {
    expect(
      () =>
        new UnitRegistry([
          {
            code: 'x',
            dimension: 'MADE_UP',
            name: 'x',
            symbol: 'x',
            factorToBase: '2',
            offsetToBase: '0',
            isBase: false,
            aliases: [],
          },
        ]),
    ).toThrow(/no base unit/);
  });

  it('has exactly one base unit per dimension in the shipped configuration', () => {
    for (const dimension of new Set(units.all().map((u) => u.dimension))) {
      const bases = units.unitsFor(dimension).filter((u) => u.isBase);
      expect(bases, `dimension ${dimension}`).toHaveLength(1);
      expect(bases[0]!.factorToBase).toBe('1');
    }
  });
});
