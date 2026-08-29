/**
 * Event definitions (ADR-0009).
 *
 * One TypeBox definition yields the TypeScript payload type, the JSON Schema stored
 * in the registry, the runtime validator, and the entry in the published catalogue.
 * Four surfaces, one source of truth, no drift.
 */
import type { Static, TSchema } from '@sinclair/typebox';
import { Ajv } from 'ajv';
import { default as ajvFormats } from 'ajv-formats';
import type { ValidateFunction } from 'ajv';

export interface EventDefinitionInput<S extends TSchema> {
  /** `fsw.<module>.<Aggregate><PastTenseVerb>`, e.g. `fsw.pim.ProductCreated`. */
  readonly type: string;
  /** Starts at 1. A breaking payload change creates a new version, never a mutation. */
  readonly version: number;
  readonly module: string;
  readonly aggregateType: string;
  /** Why a consumer would care. Published in the catalogue. */
  readonly description: string;
  readonly payload: S;
}

export interface EventDefinition<P = unknown> {
  readonly type: string;
  readonly version: number;
  readonly module: string;
  readonly aggregateType: string;
  readonly description: string;
  readonly payload: TSchema;
  validate(payload: unknown): asserts payload is P;
  readonly __payload?: P;
}

const TYPE_PATTERN = /^fsw\.[a-z]+\.[A-Za-z]+$/;

/**
 * Property names that must not appear in an event payload (ADR-0009). Events carry
 * identifiers; a consumer needing a person's name resolves it from the API. This is
 * what lets an immutable ledger coexist with a lawful erasure obligation, so it is
 * enforced at definition time rather than left to review.
 */
const PII_PROPERTY_PATTERN =
  /(email|phone|first_?name|last_?name|full_?name|given_?name|family_?name|address|postal|street|dob|date_?of_?birth|ssn|tax_?id|national_?id)/i;

const PII_REVIEWED_KEY = 'x-fsw-pii-reviewed';

const addFormats = ajvFormats as unknown as (instance: Ajv) => Ajv;
const ajv = addFormats(
  new Ajv({ strict: false, allErrors: true, allowUnionTypes: true }),
);

const registry = new Map<string, EventDefinition>();

function assertNoPii(schema: TSchema, path: string[], typeName: string): void {
  const node = schema as Record<string, unknown>;
  if (node[PII_REVIEWED_KEY] === true) return;

  const properties = node['properties'];
  if (properties !== undefined && typeof properties === 'object' && properties !== null) {
    for (const [name, child] of Object.entries(properties as Record<string, TSchema>)) {
      const childNode = child as unknown as Record<string, unknown>;
      if (PII_PROPERTY_PATTERN.test(name) && childNode[PII_REVIEWED_KEY] !== true) {
        throw new Error(
          `Event ${typeName}: payload property '${[...path, name].join('.')}' looks like ` +
            `personal data. Event payloads carry identifiers, not PII (ADR-0009). ` +
            `If this is genuinely not personal data, mark the property with ` +
            `'${PII_REVIEWED_KEY}: true' and a justification.`,
        );
      }
      assertNoPii(child, [...path, name], typeName);
    }
  }

  const items = node['items'];
  if (items !== undefined && typeof items === 'object' && items !== null) {
    assertNoPii(items as TSchema, [...path, '[]'], typeName);
  }
}

export function defineEvent<S extends TSchema>(
  input: EventDefinitionInput<S>,
): EventDefinition<Static<S>> {
  if (!TYPE_PATTERN.test(input.type)) {
    throw new Error(
      `Event type '${input.type}' must match fsw.<module>.<Aggregate><PastTenseVerb>`,
    );
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error(`Event ${input.type}: version must be an integer >= 1`);
  }
  assertNoPii(input.payload, [], input.type);

  const key = `${input.type}@${input.version}`;
  if (registry.has(key)) {
    throw new Error(`Event ${key} is already defined`);
  }

  let compiled: ValidateFunction | undefined;

  const definition: EventDefinition<Static<S>> = {
    type: input.type,
    version: input.version,
    module: input.module,
    aggregateType: input.aggregateType,
    description: input.description,
    payload: input.payload,
    validate(payload: unknown): asserts payload is Static<S> {
      const validator = (compiled ??= ajv.compile(input.payload));
      if (!validator(payload)) {
        const detail = (validator.errors ?? [])
          .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
          .join('; ');
        throw new Error(`Event ${key} payload does not match its schema: ${detail}`);
      }
    },
  };

  registry.set(key, definition as EventDefinition);
  return definition;
}

export function registeredEvents(): readonly EventDefinition[] {
  return [...registry.values()].sort((a, b) =>
    a.type === b.type ? a.version - b.version : a.type.localeCompare(b.type),
  );
}

export function findEvent(type: string, version: number): EventDefinition | undefined {
  return registry.get(`${type}@${version}`);
}

/** Test-only. Definitions are module-level singletons; suites that reload need a reset. */
export function clearEventRegistry(): void {
  registry.clear();
}
