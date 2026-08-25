import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    // Live Postgres and live HTTP; serial keeps failures readable.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
