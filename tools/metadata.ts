/**
 * Metadata CLI (ADR-0017).
 *
 *   tsx tools/metadata.ts check    validate config/metadata without touching the database
 *   tsx tools/metadata.ts plan     show what applying would change (no writes)
 *   tsx tools/metadata.ts apply    apply it
 *
 * Adding a product type or an attribute is a pull request against config/metadata
 * plus `apply`. No code change. No migration.
 */
import { join } from 'node:path';
import { loadConfig, loadDotEnv } from '../src/platform/config.js';
import { createDatabase, createPool } from '../src/platform/db/index.js';
import {
  readMetadata,
  applyMetadata,
  planMetadata,
  MetadataValidationError,
  BreakingMetadataChangeError,
  type MetadataApplyReport,
} from '../src/modules/pim/index.js';

loadDotEnv();

const METADATA_DIR = join(process.cwd(), 'config', 'metadata');
const allowBreaking = process.argv.includes('--allow-breaking');

function report(result: MetadataApplyReport): void {
  const byKind = new Map<string, number>();
  for (const change of result.changes) {
    byKind.set(change.kind, (byKind.get(change.kind) ?? 0) + 1);
  }
  if (result.changes.length === 0) {
    console.log('  no changes');
  } else {
    for (const change of result.changes) {
      const detail = change.detail === undefined ? '' : `  (${change.detail})`;
      console.log(
        `  ${change.kind.padEnd(9)} ${change.entity.padEnd(22)} ${change.key}${detail}`,
      );
    }
    console.log(
      `\n  ${[...byKind].map(([kind, count]) => `${count} ${kind.toLowerCase()}`).join(', ')}`,
    );
  }
  if (result.breaking.length > 0) {
    console.log(`\n  BREAKING:`);
    for (const item of result.breaking) console.log(`    - ${item}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'apply';

  const parsed = await readMetadata(METADATA_DIR);
  console.log(
    `Validated ${parsed.fileCount} file(s): ` +
      `${parsed.dimensions.length} dimensions, ${parsed.units.length} units, ` +
      `${parsed.vocabularies.length} vocabularies ` +
      `(${parsed.vocabularies.reduce((n, v) => n + v.terms.length, 0)} terms), ` +
      `${parsed.attributes.length} attributes, ${parsed.productTypes.length} product types, ` +
      `${parsed.conditions.size} conditional rules.`,
  );

  if (command === 'check') {
    console.log(`Content hash ${parsed.contentHash.slice(0, 16)}.`);
    return;
  }

  const config = loadConfig();
  const pool = createPool({
    connectionString: config.database.url,
    applicationName: 'fsw-metadata',
  });
  const db = createDatabase(pool);

  try {
    if (command === 'plan') {
      console.log('\nPlan (nothing written):');
      report(await planMetadata(db, parsed, { actor: actorName() }));
      return;
    }
    if (command !== 'apply') {
      console.error(`Unknown command '${command}'. Expected: check, plan, apply.`);
      process.exit(2);
    }

    const result = await applyMetadata(db, parsed, {
      actor: actorName(),
      ...(allowBreaking ? { allowBreaking: true } : {}),
    });
    console.log('\nApplied:');
    report(result);
    console.log(
      `\nMetadata version ${result.versionId ?? 'unknown'} recorded ` +
        `(content hash ${result.contentHash.slice(0, 16)}).`,
    );
  } finally {
    await db.destroy();
  }
}

function actorName(): string {
  return process.env['USER'] ?? process.env['HOSTNAME'] ?? 'unknown';
}

main().catch((error: unknown) => {
  if (
    error instanceof MetadataValidationError ||
    error instanceof BreakingMetadataChangeError
  ) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  console.error(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
