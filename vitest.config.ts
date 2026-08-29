import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Benchmarks live alongside the tests but are excluded from the default run by
    // the `test` script, because they generate a catalogue and take minutes.
    include: ['tests/**/*.test.ts', 'tests/**/*.perf.ts'],
    // Integration tests provision their own database; they must not share one.
    fileParallelism: true,
    maxConcurrency: 4,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globals: false,
    reporters: ['default'],
    sequence: { shuffle: false },
  },
});
