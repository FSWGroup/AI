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
 */

const alias = {
  "@": path.resolve(__dirname, "./src"),
  "server-only": path.resolve(__dirname, "./tests/server-only-stub.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
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
          // Integration tests share one database; run them serially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 90_000,
        },
      },
    ],
  },
});
