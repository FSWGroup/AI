import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Two projects:
 *  - `unit`        pure logic, no database. Fast, runs on every commit.
 *  - `integration` real Postgres (fsw_academy_test). Requires the test DB to be
 *                  migrated; see tests/integration/setup.ts.
 *
 * `server-only` is aliased to an empty module: it throws on import outside a
 * React Server Component, which would prevent testing server modules at all.
 * The production import guard is unaffected.
 *
 * Integration test files share one database and truncate it between tests, so
 * they must not run concurrently. `fileParallelism` and the single-fork pool are
 * set at the root because Vitest applies them per-run, not per-project.
 */

const alias = {
  "@": path.resolve(__dirname, "./src"),
  "server-only": path.resolve(__dirname, "./tests/server-only-stub.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // One test file at a time, in one fork: the integration suite shares a
    // database. The unit suite is fast enough that serializing costs nothing.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
          globals: true,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globals: true,
          setupFiles: ["tests/integration/setup.ts"],
          sequence: { concurrent: false },
          testTimeout: 30_000,
          hookTimeout: 90_000,
        },
      },
    ],
  },
});
