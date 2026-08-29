/**
 * Build a UnitRegistry from the database.
 *
 * Units are data (ADR-0015), so the registry is loaded rather than hard-coded. It also
 * carries the designation term codes, so that handing a pressure class to the
 * conversion service produces a precise explanation rather than "unknown unit".
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../../platform/db/index.js';
import { UnitRegistry, type UnitDefinition } from './conversion.js';

export async function loadUnitRegistry(
  db: Database | DbTransaction,
): Promise<UnitRegistry> {
  const units = await sql<{
    code: string;
    dimension_code: string;
    name: string;
    symbol: string;
    factor_to_base: string;
    offset_to_base: string;
    is_base: boolean;
    aliases: string[] | null;
  }>`
    SELECT u.code, u.dimension_code, u.name, u.symbol,
           u.factor_to_base, u.offset_to_base, u.is_base,
           array_remove(array_agg(a.alias), NULL) AS aliases
      FROM pim.unit u
      LEFT JOIN pim.unit_alias a ON a.unit_code = u.code
     GROUP BY u.code, u.dimension_code, u.name, u.symbol,
              u.factor_to_base, u.offset_to_base, u.is_base
     ORDER BY u.dimension_code, u.sort_order
  `.execute(db);

  const definitions: UnitDefinition[] = units.rows.map((row) => ({
    code: row.code,
    dimension: row.dimension_code,
    name: row.name,
    symbol: row.symbol,
    factorToBase: row.factor_to_base,
    offsetToBase: row.offset_to_base,
    isBase: row.is_base,
    aliases: row.aliases ?? [],
  }));

  // Designation term codes, so a misuse is diagnosed precisely (ADR-0016).
  const designations = await sql<{ code: string; designation_kind: string }>`
    SELECT t.code, v.designation_kind
      FROM pim.vocabulary_term t
      JOIN pim.vocabulary v ON v.key = t.vocabulary_key
     WHERE v.is_designation
  `.execute(db);

  return new UnitRegistry(
    definitions,
    new Map(designations.rows.map((r) => [r.code, r.designation_kind])),
  );
}
