/**
 * Publish the in-code event definitions into `events.event_type_version` at startup.
 *
 * `events.domain_event` has a foreign key onto that table, so an event type that has
 * not been registered cannot be emitted at all. Registration is the mechanism, not a
 * convention.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';
import { registeredEvents } from './definition.js';
import type { EventDefinition } from './definition.js';

/**
 * Stable JSON rendering with sorted keys.
 *
 * PostgreSQL's jsonb does not preserve key order, so a schema read back is a
 * different string from the one written even when nothing changed. Comparing raw
 * JSON.stringify output therefore reports every schema as modified on the second
 * run -- which would either block every deployment or, worse, train people to pass
 * --allow-schema-update by reflex.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export interface RegistrySyncResult {
  readonly registered: number;
  readonly incompatible: readonly string[];
}

/**
 * Upsert every registered definition. An existing (type, version) whose stored schema
 * differs is reported rather than silently overwritten: changing a published schema in
 * place is exactly what ADR-0009 forbids, and the fix is a new version, not a rewrite.
 */
export async function syncEventRegistry(
  db: Database | DbTransaction,
  definitions: readonly EventDefinition[] = registeredEvents(),
  options: { allowSchemaUpdate?: boolean } = {},
): Promise<RegistrySyncResult> {
  const incompatible: string[] = [];

  for (const definition of definitions) {
    const existing = await sql<{ json_schema: unknown }>`
      SELECT json_schema FROM events.event_type_version
      WHERE event_type = ${definition.type} AND schema_version = ${definition.version}
    `.execute(db);

    const stored = existing.rows[0];
    if (stored === undefined) {
      await sql`
        INSERT INTO events.event_type_version
          (event_type, schema_version, producer_module, description, json_schema, aggregate_type)
        VALUES (
          ${definition.type}, ${definition.version}, ${definition.module},
          ${definition.description}, ${JSON.stringify(definition.payload)}::jsonb,
          ${definition.aggregateType}
        )
      `.execute(db);
      continue;
    }

    const same = canonicalJson(stored.json_schema) === canonicalJson(definition.payload);
    if (same) continue;

    if (options.allowSchemaUpdate === true) {
      await sql`
        UPDATE events.event_type_version
           SET json_schema = ${JSON.stringify(definition.payload)}::jsonb,
               description = ${definition.description}
         WHERE event_type = ${definition.type} AND schema_version = ${definition.version}
      `.execute(db);
    } else {
      incompatible.push(`${definition.type}@${definition.version}`);
    }
  }

  return { registered: definitions.length, incompatible };
}
