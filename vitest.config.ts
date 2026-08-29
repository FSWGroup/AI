import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
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
