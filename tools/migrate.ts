/**
 * Migration CLI. A thin wrapper; the engine lives in src/platform/db/migrator.ts so
 * the CLI, the deployment job and the test harness all apply migrations identically.
 *
 *   tsx tools/migrate.ts up      apply everything pending
 *   tsx tools/migrate.ts status  show applied and pending
 *   tsx tools/migrate.ts verify  checksums only, no writes (CI gate)
 *   tsx tools/migrate.ts reset   drop all owned schemas (never in production)
 */
import { Client } from 'pg';
import { loadDotEnv } from '../src/platform/config.js';
import {
  appliedMigrations,
  applyMigrations,
  assertHistoryIntact,
  bootstrap,
  loadMigrations,
  OWNED_SCHEMAS,
  resetSchemas,
} from '../src/platform/db/migrator.js';

loadDotEnv();

function connectionString(): string {
  const url = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be set');
  }
  return url;
}

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const commands: Record<string, () => Promise<void>> = {
  async up() {
    const result = await withClient((client) =>
      applyMigrations(client, {
        onProgress: (name, ms) => console.log(`  applied ${name} (${ms}ms)`),
      }),
    );
    console.log(
      result.applied.length === 0
        ? `Up to date (${result.alreadyApplied} migration(s) applied).`
        : `Applied ${result.applied.length} migration(s).`,
    );
  },

  async status() {
    await withClient(async (client) => {
      await bootstrap(client);
      const files = await loadMigrations();
      const applied = await appliedMigrations(client);
      for (const file of files) {
        const row = applied.get(file.version);
        if (row === undefined) console.log(`  pending   ${file.name}`);
        else if (row.sha256 !== file.sha256)
          console.log(`  CHANGED   ${file.name}   <-- checksum mismatch`);
        else console.log(`  applied   ${file.name}   ${row.applied_at.toISOString()}`);
      }
    });
  },

  async verify() {
    await withClient(async (client) => {
      await bootstrap(client);
      const files = await loadMigrations();
      const applied = await appliedMigrations(client);
      assertHistoryIntact(files, applied);
      const pending = files.filter((f) => !applied.has(f.version)).length;
      console.log(
        `Migration history intact: ${files.length} on disk, ${applied.size} applied, ${pending} pending.`,
      );
    });
  },

  async reset() {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('reset is not permitted when NODE_ENV=production');
    }
    await withClient(resetSchemas);
    console.log(`Dropped ${OWNED_SCHEMAS.length} schema(s).`);
  },
};

const command = process.argv[2] ?? 'up';
const handler = commands[command];

if (handler === undefined) {
  console.error(
    `Unknown command '${command}'. Expected: ${Object.keys(commands).join(', ')}`,
  );
  process.exit(2);
}

handler().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
