import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Integration tests share one PostgreSQL database, so they run serially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 'server-only' is a Next.js build-time guard with no runtime behaviour;
      // stub it so the same service modules can be tested directly in Node.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
