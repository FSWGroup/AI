import { beforeAll } from "vitest";
import { execSync } from "node:child_process";

/**
 * Integration test setup.
 *
 * Points the Prisma client at the dedicated test database and applies
 * migrations before the suite runs. The test database is never the development
 * or production database — the guard below refuses to run otherwise.
 */

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fsw:fsw_dev_password@localhost:5432/fsw_academy_test?schema=public";

if (!/(_test|test_)/.test(TEST_DB_URL)) {
  throw new Error(
    `Refusing to run integration tests against "${TEST_DB_URL}" — the database name must contain "test".`,
  );
}

process.env.DATABASE_URL = TEST_DB_URL;
process.env.SHADOW_DATABASE_URL = TEST_DB_URL.replace("fsw_academy_test", "fsw_academy_shadow");
process.env.FIELD_ENCRYPTION_KEY =
  process.env.FIELD_ENCRYPTION_KEY ?? "dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLTEyMzQ1Ng==";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-not-for-production-use-000000";
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = "./storage/test";
// NODE_ENV is typed readonly by @types/node; Vitest already sets it to "test".
Object.assign(process.env, { NODE_ENV: "test" });

beforeAll(() => {
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
});
