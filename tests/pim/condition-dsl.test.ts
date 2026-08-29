import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseCondition,
  evaluateCondition,
  conditionAttributeKeys,
  describeCondition,
  ConditionSyntaxError,
  type AttributeResolver,
} from '../../src/modules/pim/index.js';

const resolver =
  (values: Record<string, string | number | boolean | string[]>): AttributeResolver =>
  (key) =>
    values[key];

describe('conditional applicability DSL (spec §26)', () => {
  describe('parsing', () => {
    it('accepts the shapes the configuration uses', () => {
      expect(
        parseCondition({ attr: 'actuation_type', op: 'eq', value: 'ELECTRIC' }),
      ).toEqual({
        attr: 'actuation_type',
        op: 'eq',
        value: 'ELECTRIC',
      });
      expect(
        parseCondition({
          all: [
            { attr: 'actuation_type', op: 'in', value: ['ELECTRIC', 'SOLENOID'] },
            { not: { attr: 'voltage', op: 'exists' } },
          ],
        }),
      ).toBeTruthy();
    });

    it('rejects anything that is not in the language', () => {
      const invalid: unknown[] = [
        null,
        'ELECTRIC',
        [],
        {},
        { attr: 'x' },
        { op: 'eq', value: 1 },
        { attr: 'Bad_Key', op: 'eq', value: 1 },
        { attr: 'x', op: 'matches', value: 'y' },
        { attr: 'x', op: 'eq' },
        { attr: 'x', op: 'exists', value: 1 },
        { attr: 'x', op: 'in', value: 'not-an-array' },
        { attr: 'x', op: 'in', value: [] },
        { attr: 'x', op: 'gt', value: 'not-a-number' },
        { all: [] },
        { all: [{ attr: 'x', op: 'eq', value: 1 }], any: [] },
        { not: {} },
        { attr: 'x', op: 'eq', value: { nested: true } },
      ];
      for (const value of invalid) {
        expect(() => parseCondition(value), JSON.stringify(value)).toThrow(
          ConditionSyntaxError,
        );
      }
    });

    it('cannot express anything executable', () => {
      // The point of a deliberately tiny language: no function reference, no
      // expression, no way to reach outside the values it is handed.
      for (const value of [
        { attr: 'x', op: 'eq', value: '${process.env.SECRET}' },
        { $where: 'return true' },
        { attr: 'x', op: 'eval', value: '1' },
      ]) {
        const parsedOrThrew = (() => {
          try {
            return parseCondition(value);
          } catch {
            return 'threw';
          }
        })();
        if (parsedOrThrew !== 'threw') {
          // A string that looks like an interpolation is just a string; it is
          // compared, never evaluated.
          expect(evaluateCondition(parsedOrThrew, resolver({ x: 'anything' }))).toBe(
            false,
          );
        }
      }
    });

    it('reports where the problem is', () => {
      try {
        parseCondition({ all: [{ attr: 'a', op: 'eq', value: 1 }, { bad: true }] });
        expect.unreachable();
      } catch (error) {
        expect((error as ConditionSyntaxError).path).toBe('.all[1]');
      }
    });
  });

  describe('evaluation', () => {
    it('evaluates the rules the shipped configuration relies on', () => {
      const electricVoltageRequired = parseCondition({
        all: [{ attr: 'actuation_type', op: 'in', value: ['ELECTRIC', 'SOLENOID'] }],
      });
      expect(
        evaluateCondition(
          electricVoltageRequired,
          resolver({ actuation_type: 'ELECTRIC' }),
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          electricVoltageRequired,
          resolver({ actuation_type: 'SOLENOID' }),
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          electricVoltageRequired,
          resolver({ actuation_type: 'PNEUMATIC' }),
        ),
      ).toBe(false);
      expect(
        evaluateCondition(
          electricVoltageRequired,
          resolver({ actuation_type: 'MANUAL_LEVER' }),
        ),
      ).toBe(false);
    });

    it('treats a missing value as absent, not as false', () => {
      // A rule about an attribute nobody has filled in must not blow up
      // catalogue-wide validation, and must not silently claim the rule matched.
      expect(
        evaluateCondition(
          parseCondition({ attr: 'x', op: 'eq', value: 1 }),
          resolver({}),
        ),
      ).toBe(false);
      expect(
        evaluateCondition(
          parseCondition({ attr: 'x', op: 'ne', value: 1 }),
          resolver({}),
        ),
      ).toBe(false);
      expect(
        evaluateCondition(parseCondition({ attr: 'x', op: 'missing' }), resolver({})),
      ).toBe(true);
      expect(
        evaluateCondition(parseCondition({ attr: 'x', op: 'exists' }), resolver({})),
      ).toBe(false);
    });

    it('handles multi-valued attributes', () => {
      const values = resolver({ certifications: ['API_607', 'NACE_MR0175'] });
      expect(
        evaluateCondition(
          parseCondition({ attr: 'certifications', op: 'eq', value: 'API_607' }),
          values,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          parseCondition({ attr: 'certifications', op: 'eq', value: 'THREE_A' }),
          values,
        ),
      ).toBe(false);
      expect(
        evaluateCondition(
          parseCondition({ attr: 'certifications', op: 'notIn', value: ['THREE_A'] }),
          values,
        ),
      ).toBe(true);
    });

    it('compares numbers only against numbers', () => {
      const above = parseCondition({ attr: 'cv', op: 'gt', value: 10 });
      expect(evaluateCondition(above, resolver({ cv: 20 }))).toBe(true);
      expect(evaluateCondition(above, resolver({ cv: 5 }))).toBe(false);
      // A quantity that arrived as text does not accidentally compare as a number.
      expect(evaluateCondition(above, resolver({ cv: '20' }))).toBe(false);
    });

    it('never throws, whatever it is handed', () => {
      const condition = parseCondition({
        any: [
          { attr: 'a', op: 'eq', value: 'X' },
          {
            all: [
              { attr: 'b', op: 'gte', value: 5 },
              { not: { attr: 'c', op: 'missing' } },
            ],
          },
        ],
      });
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.constantFrom('a', 'b', 'c', 'd'),
            fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.array(fc.string())),
          ),
          (values) => {
            expect(typeof evaluateCondition(condition, resolver(values))).toBe('boolean');
          },
        ),
      );
    });
  });

  it('reports which attributes a rule depends on', () => {
    const condition = parseCondition({
      all: [
        { attr: 'actuation_type', op: 'eq', value: 'ELECTRIC' },
        {
          any: [
            { attr: 'voltage', op: 'exists' },
            { attr: 'frequency', op: 'exists' },
          ],
        },
      ],
    });
    expect(conditionAttributeKeys(condition)).toEqual([
      'actuation_type',
      'frequency',
      'voltage',
    ]);
  });

  it('renders a rule a non-engineer can read', () => {
    expect(
      describeCondition(
        parseCondition({
          all: [{ attr: 'actuation_type', op: 'in', value: ['ELECTRIC', 'SOLENOID'] }],
        }),
      ),
    ).toBe('actuation_type is one of [ELECTRIC, SOLENOID]');
    expect(describeCondition(parseCondition({ attr: 'cv', op: 'gte', value: 10 }))).toBe(
      'cv is at least 10',
    );
    expect(describeCondition(parseCondition({ not: { attr: 'cv', op: 'exists' } }))).toBe(
      'not (cv is present)',
    );
  });
});
