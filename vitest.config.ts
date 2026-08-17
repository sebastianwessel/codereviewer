import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    // `scripts/github/**` holds the GitHub Action's tests. They are hermetic —
    // every side effect is injected — so they belong in the default suite. Kept
    // here rather than in a config of their own because a suite CI does not run
    // is a suite that rots.
    include: ['src/**/*.test.ts', 'scripts/github/**/*.test.ts'],
    // Live tests hit real providers (they cost money). They are excluded from the
    // default suite and run only via `npm run test:live` (vitest.live.config.ts).
    exclude: [...configDefaults.exclude, 'src/**/*.live.test.ts'],
    // Negative-path workflow tests intentionally trigger provider failures; keep
    // the harness logger quiet so expected error logs do not pollute test output.
    env: {
      PURISTA_HARNESS_LOG_LEVEL: 'fatal'
    },
    // Run by `npm run test:coverage`, which is what CI executes. Until 2026-08-17
    // nothing ran these thresholds at all — no npm script and no workflow step —
    // while the contributing guide told readers coverage was "enforced at 80%".
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli/main.ts'],
      // Floors set just under what the suite MEASURES, not at a round number
      // somebody liked. Measured 2026-08-17 over 2 862 tests: statements 96.48%,
      // branches 87.69%, functions 97.64%, lines 96.49%.
      //
      // The old 80% was so far below the real figure that a sixteen-point collapse
      // would have passed — a gate positioned where it can never fire is the same
      // shape of problem as no gate. These leave roughly 1.5pp of headroom on the
      // three high numbers and 2.7pp on branches, which is slack for ordinary work
      // and not for a wholesale regression.
      thresholds: {
        lines: 95,
        branches: 85,
        functions: 95,
        statements: 95
      }
    }
  }
})
