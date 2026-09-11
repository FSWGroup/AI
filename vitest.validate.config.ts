// Runs the developer-only workbook validation against a real Order Tracker.
// Usage: VALVEMAN_TRACKER_PATH=/path/to/tracker.xlsx npm run validate:workbook
// The workbook is never committed; this only reads a local file.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.validate.ts'],
    testTimeout: 120000,
  },
});
