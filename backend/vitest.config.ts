import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    // Live Postgres and live HTTP; serial keeps failures readable.
    fileParallelism: false,
    testTimeout: 30_000,
    // beforeEach/afterAll here open the first Postgres connection of the
    // process, which can take 10-20s cold (container warm-up, TLS negotiation,
    // DNS). Vitest's 10s default hook timeout fails those runs spuriously; the
    // test bodies themselves are fast.
    hookTimeout: 60_000,
  },
});
