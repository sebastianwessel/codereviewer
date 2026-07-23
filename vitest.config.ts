import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Live tests hit real providers (they cost money). They are excluded from the
    // default suite and run only via `npm run test:live` (vitest.live.config.ts).
    exclude: [...configDefaults.exclude, 'src/**/*.live.test.ts'],
    // Negative-path workflow tests intentionally trigger provider failures; keep
    // the harness logger quiet so expected error logs do not pollute test output.
    env: {
      PURISTA_HARNESS_LOG_LEVEL: 'fatal'
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli/main.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80
      }
    }
  }
})
