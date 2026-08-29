/**
 * Load the demonstration catalogue. Run by `make seed` and by `make dev`.
 *
 * Safe to re-run only on an empty catalogue: it creates rather than upserts, because
 * a seed that silently merges into real data is a hazard. Use `npm run db:reset` for
 * a clean start.
 */
import { loadConfig, loadDotEnv } from '../src/platform/config.js';
import { createDatabase, createPool } from '../src/platform/db/index.js';
import { syncEventRegistry } from '../src/modules/events/index.js';
import { ALL_EVENTS } from '../src/event-catalog.js';
import { seedCatalog, seedConflictingSource } from './seed-data.js';

loadDotEnv();

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.env === 'production') {
    throw new Error('The demonstration seed must not be loaded into production.');
  }

  const pool = createPool({
    connectionString: config.database.url,
    applicationName: 'fsw-seed',
  });
  const db = createDatabase(pool);

  try {
    const registry = await syncEventRegistry(db, ALL_EVENTS);
    if (registry.incompatible.length > 0) {
      throw new Error(
        `Event schemas changed in place: ${registry.incompatible.join(', ')}. ` +
          `A breaking payload change needs a new schema_version (ADR-0009).`,
      );
    }

    const existing = await db
      .selectFrom('pim.product')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    if (Number(existing.count) > 0) {
      console.log(`Catalogue already has ${existing.count} product(s); nothing seeded.`);
      return;
    }

    const result = await seedCatalog(db);
    await seedConflictingSource(db);

    console.log(
      `Seeded ${result.brands} brands, ${result.products} products, ` +
        `${result.variants} variants, plus one conflicting source value.`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
