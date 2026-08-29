/**
 * The FSW condition DSL (spec §26).
 *
 * Attribute applicability is conditional: if actuation is electric, voltage becomes
 * applicable; if pneumatic, supply pressure does. Those rules must be configuration,
 * not code — and configuration that a future engineer can read, test and trust.
 *
 * So this is deliberately tiny and deliberately not a programming language. There is
 * no `eval`, no function reference, no loop, no arithmetic and no way to reach outside
 * the attribute values it is handed. Everything it can express is enumerated here.
 *
 * Adding an operator is a code change, on purpose. A rule language that grows by
 * accident becomes a second system nobody can reason about.
 */

/** Bumped when the semantics change. Stored with every rule so old rules stay readable. */
export const CONDITION_DSL_VERSION = 1;

export type ConditionScalar = string | number | boolean;

export type ComparisonOperator =
  'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn';

export type PresenceOperator = 'exists' | 'missing';

export interface AllCondition {
  readonly all: readonly Condition[];
}
export interface AnyCondition {
  readonly any: readonly Condition[];
}
export interface NotCondition {
  readonly not: Condition;
}
export interface ComparisonPredicate {
  readonly attr: string;
  readonly op: ComparisonOperator;
  readonly value: ConditionScalar | readonly ConditionScalar[];
}
export interface PresencePredicate {
  readonly attr: string;
  readonly op: PresenceOperator;
}

export type Condition =
  AllCondition | AnyCondition | NotCondition | ComparisonPredicate | PresencePredicate;

function isPresencePredicate(
  predicate: ComparisonPredicate | PresencePredicate,
): predicate is PresencePredicate {
  return predicate.op === 'exists' || predicate.op === 'missing';
}

/**
 * Resolves an attribute key to its comparable value(s): a term code for enumerated
 * attributes, the normalized base value for quantities, or the raw scalar otherwise.
 * Returns undefined when the attribute has no value.
 */
export type AttributeResolver = (
  key: string,
) => ConditionScalar | readonly ConditionScalar[] | undefined;

export class ConditionSyntaxError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`Invalid condition at ${path === '' ? '(root)' : path}: ${message}`);
    this.name = 'ConditionSyntaxError';
    this.path = path;
  }
}

const COMPARISON_OPERATORS: readonly string[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
];
const PRESENCE_OPERATORS: readonly string[] = ['exists', 'missing'];
const ORDERED_OPERATORS: readonly string[] = ['gt', 'gte', 'lt', 'lte'];

function isScalar(value: unknown): value is ConditionScalar {
  return (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  );
}

/**
 * Validate untrusted JSON into a Condition. Every rule that reaches the database has
 * been through here, so evaluation never has to defend itself.
 */
export function parseCondition(input: unknown, path = ''): Condition {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConditionSyntaxError(path, 'expected an object');
  }
  const node = input as Record<string, unknown>;
  const keys = Object.keys(node);

  if (keys.length === 0) throw new ConditionSyntaxError(path, 'empty condition');

  if ('all' in node || 'any' in node) {
    const combinator = 'all' in node ? 'all' : 'any';
    if (keys.length !== 1) {
      throw new ConditionSyntaxError(path, `'${combinator}' must be the only key`);
    }
    const branches = node[combinator];
    if (!Array.isArray(branches) || branches.length === 0) {
      throw new ConditionSyntaxError(path, `'${combinator}' must be a non-empty array`);
    }
    const parsed = branches.map((branch, index) =>
      parseCondition(branch, `${path}.${combinator}[${index}]`),
    );
    return combinator === 'all' ? { all: parsed } : { any: parsed };
  }

  if ('not' in node) {
    if (keys.length !== 1)
      throw new ConditionSyntaxError(path, `'not' must be the only key`);
    return { not: parseCondition(node['not'], `${path}.not`) };
  }

  if (!('attr' in node)) {
    throw new ConditionSyntaxError(
      path,
      `expected 'all', 'any', 'not', or a predicate with 'attr' and 'op'. Got: ${keys.join(', ')}`,
    );
  }

  const attr = node['attr'];
  if (typeof attr !== 'string' || !/^[a-z][a-z0-9_]*$/.test(attr)) {
    throw new ConditionSyntaxError(path, `'attr' must be a snake_case attribute key`);
  }
  const op = node['op'];
  if (typeof op !== 'string') throw new ConditionSyntaxError(path, `'op' is required`);

  if (PRESENCE_OPERATORS.includes(op)) {
    if (keys.length !== 2) {
      throw new ConditionSyntaxError(path, `'${op}' takes no 'value'`);
    }
    return { attr, op: op as PresenceOperator };
  }

  if (!COMPARISON_OPERATORS.includes(op)) {
    throw new ConditionSyntaxError(
      path,
      `unknown operator '${op}'. Supported: ${[...COMPARISON_OPERATORS, ...PRESENCE_OPERATORS].join(', ')}`,
    );
  }
  if (keys.length !== 3 || !('value' in node)) {
    throw new ConditionSyntaxError(
      path,
      `'${op}' requires exactly 'attr', 'op' and 'value'`,
    );
  }

  const value = node['value'];
  if (op === 'in' || op === 'notIn') {
    if (!Array.isArray(value) || value.length === 0 || !value.every(isScalar)) {
      throw new ConditionSyntaxError(
        path,
        `'${op}' requires a non-empty array of scalars`,
      );
    }
    return { attr, op, value: value as readonly ConditionScalar[] };
  }
  if (!isScalar(value)) {
    throw new ConditionSyntaxError(path, `'${op}' requires a string, number or boolean`);
  }
  if (ORDERED_OPERATORS.includes(op) && typeof value !== 'number') {
    throw new ConditionSyntaxError(path, `'${op}' requires a number`);
  }
  return { attr, op: op as ComparisonOperator, value };
}

/** Every attribute key a condition depends on. Used to validate rules against a product type. */
export function conditionAttributeKeys(condition: Condition): string[] {
  const keys = new Set<string>();
  const walk = (node: Condition): void => {
    if ('all' in node) node.all.forEach(walk);
    else if ('any' in node) node.any.forEach(walk);
    else if ('not' in node) walk(node.not);
    else keys.add(node.attr);
  };
  walk(condition);
  return [...keys].sort();
}

/**
 * Evaluate against resolved attribute values.
 *
 * Missing values do not throw and do not silently mean "false-ish": a comparison
 * against a missing value is false, `missing` is true, and `not` inverts. An
 * applicability rule for an attribute nobody has filled in yet must not blow up
 * catalogue-wide validation.
 */
export function evaluateCondition(
  condition: Condition,
  resolve: AttributeResolver,
): boolean {
  if ('all' in condition) {
    return condition.all.every((branch) => evaluateCondition(branch, resolve));
  }
  if ('any' in condition) {
    return condition.any.some((branch) => evaluateCondition(branch, resolve));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, resolve);
  }

  const actual = resolve(condition.attr);

  if (isPresencePredicate(condition)) {
    return condition.op === 'exists' ? actual !== undefined : actual === undefined;
  }
  if (actual === undefined) return false;

  const actuals: readonly ConditionScalar[] = Array.isArray(actual)
    ? (actual as readonly ConditionScalar[])
    : [actual as ConditionScalar];

  switch (condition.op) {
    case 'eq':
      return actuals.some((a) => a === condition.value);
    case 'ne':
      return !actuals.some((a) => a === condition.value);
    case 'in': {
      const allowed = condition.value as readonly ConditionScalar[];
      return actuals.some((a) => allowed.includes(a));
    }
    case 'notIn': {
      const disallowed = condition.value as readonly ConditionScalar[];
      return !actuals.some((a) => disallowed.includes(a));
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const threshold = condition.value as number;
      return actuals.some((a) => {
        if (typeof a !== 'number') return false;
        if (condition.op === 'gt') return a > threshold;
        if (condition.op === 'gte') return a >= threshold;
        if (condition.op === 'lt') return a < threshold;
        return a <= threshold;
      });
    }
    default: {
      // Exhaustiveness: adding a comparison operator without handling it here is a
      // compile error, not a silent 'false'.
      const unhandled: never = condition;
      throw new Error(`Unhandled comparison operator: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Human-readable rendering, for admin screens and quality findings. */
export function describeCondition(condition: Condition): string {
  if ('all' in condition) return condition.all.map(describeCondition).join(' and ');
  if ('any' in condition) return `(${condition.any.map(describeCondition).join(' or ')})`;
  if ('not' in condition) return `not (${describeCondition(condition.not)})`;
  if (isPresencePredicate(condition)) {
    return condition.op === 'exists'
      ? `${condition.attr} is present`
      : `${condition.attr} is absent`;
  }
  const rendered = Array.isArray(condition.value)
    ? `[${(condition.value as readonly ConditionScalar[]).join(', ')}]`
    : String(condition.value);
  const words: Record<ComparisonOperator, string> = {
    eq: 'is',
    ne: 'is not',
    gt: 'is greater than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
    in: 'is one of',
    notIn: 'is none of',
  };
  return `${condition.attr} ${words[condition.op]} ${rendered}`;
}
