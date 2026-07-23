import { defineConfig } from 'vitest/config'

// Live integration tests: they resolve the real model provider from the
// environment (`npm run test:live` loads `.env`) and make real provider calls,
// so they cost money and are NOT part of the default `npm test` suite. Each live
// test skips itself when no provider environment is present, so this config is
// safe to run without credentials (it simply reports skipped tests).
export default defineConfig({
  test: {
    include: ['src/**/*.live.test.ts'],
    env: {
      PURISTA_HARNESS_LOG_LEVEL: 'fatal'
    },
    // Real provider calls and the bounded agent loop are far slower than unit tests.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Live tests make network calls; never parallelize them into a rate-limit wall.
    fileParallelism: false
  }
})
