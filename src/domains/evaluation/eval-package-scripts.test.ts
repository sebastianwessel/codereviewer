import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const benchmarkSliceRoot = 'eval/benchmarks/code-review-bench-style'
const hydratedBenchmarkSliceRoot =
  '.codereviewer/eval/benchmark-slices/code-review-bench-style'
const proofQualitySliceRoot = 'eval/fixtures/proof-quality-slices'

describe('evaluation package scripts', () => {
  test('exposes the benchmark fixture pack through dedicated scripts', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      readonly scripts: Record<string, string>
    }

    expect(packageJson.scripts['eval:with-env']).not.toContain(benchmarkSliceRoot)
    expect(packageJson.scripts['eval']).toContain('--case typescript-negative')
    expect(packageJson.scripts['eval']).toContain(
      '--case model-refutation-control'
    )
    expect(packageJson.scripts['eval']).not.toContain('--semantic-judge')
    expect(packageJson.scripts['eval:with-env']).toContain(
      `--slice-root ${proofQualitySliceRoot}`
    )
    expect(packageJson.scripts['eval:with-env']).toContain('--semantic-judge')
    expect(packageJson.scripts['eval:with-env']).toContain(
      '--review-mode pr --review-depth thorough'
    )
    expect(packageJson.scripts['eval:with-env']).toContain(
      '--intent-planning model --judge-findings'
    )
    expect(packageJson.scripts['eval:with-env']).toContain(
      '--max-concurrent-tasks 1'
    )
    expect(packageJson.scripts['eval:cheap:refutation']).toContain(
      'vitest run src/domains/review-workflow/model-admission-refutation-execution.test.ts'
    )
    expect(packageJson.scripts['eval:cheap']).toContain(
      'npm run eval:cheap:refutation'
    )
    expect(packageJson.scripts['eval:cheap']).toContain(
      'npm run eval:cheap:provider'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      `--slice-root ${proofQualitySliceRoot}`
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--case semantic-authz-cross-file'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--case semantic-authz-defensive-control'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--case semantic-dayjs-slot-boundary'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--case semantic-go-cache-concurrency'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--case semantic-billing-discount-regression'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--review-mode pr --review-depth thorough'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--intent-planning model --judge-findings'
    )
    expect(packageJson.scripts['eval:cheap:provider']).toContain(
      '--semantic-judge --max-concurrent-tasks 1'
    )
    expect(packageJson.scripts['eval:hydrate']).toContain(
      'scripts/hydrate-code-review-benchmark.ts'
    )
    expect(packageJson.scripts['eval:benchmark:prepare']).toContain(
      'scripts/hydrate-code-review-benchmark.ts'
    )
    expect(packageJson.scripts['eval:benchmark']).toContain(
      'scripts/hydrate-code-review-benchmark.ts --quiet'
    )
    expect(packageJson.scripts['eval:benchmark']).toContain(
      `--slice-root ${hydratedBenchmarkSliceRoot}`
    )
    expect(packageJson.scripts['eval:benchmark']).not.toContain(
      `--slice-root ${benchmarkSliceRoot}`
    )
    expect(packageJson.scripts['eval:benchmark']).toContain(
      '--review-mode pr --review-depth thorough'
    )
    expect(packageJson.scripts['eval:benchmark']).toContain(
      '--intent-planning model --judge-findings'
    )
    expect(packageJson.scripts['eval:benchmark']).toContain('--semantic-judge')
    expect(packageJson.scripts['eval:benchmark']).toContain(
      '--max-concurrent-tasks 1'
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      'scripts/hydrate-code-review-benchmark.ts --quiet'
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      `--slice-root ${hydratedBenchmarkSliceRoot}`
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      '--case crb-cal-dot-com-06-advanced-date-override-handling-and-timezone-compatibility-improvement'
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      '--case crb-grafana-10-unified-storage-performance-optimizations'
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      '--case crb-cal-dot-com-02-feat-2fa-backup-codes'
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      '--review-mode pr --review-depth thorough'
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      '--intent-planning model --judge-findings'
    )
    expect(packageJson.scripts['eval:benchmark:smoke']).toContain(
      '--semantic-judge --max-concurrent-tasks 1'
    )
    expect(packageJson.scripts['eval:benchmark:debug']).toContain(
      `--slice-root ${hydratedBenchmarkSliceRoot}`
    )
    expect(packageJson.scripts['eval:benchmark:debug']).toContain(
      '--review-mode pr --review-depth thorough'
    )
    expect(packageJson.scripts['eval:benchmark:debug']).toContain(
      '--intent-planning model --judge-findings'
    )
    expect(packageJson.scripts['eval:benchmark:debug']).toContain(
      '--semantic-judge --max-concurrent-tasks 1 --debug'
    )
    expect(packageJson.scripts['eval:benchmark:debug']).toContain(
      '--log-file .codereviewer/eval/log.log'
    )
    expect(packageJson.scripts['eval:benchmark:baseline']).toContain(
      `--slice-root ${hydratedBenchmarkSliceRoot}`
    )
    expect(packageJson.scripts['eval:benchmark:baseline']).toContain(
      '--semantic-judge --max-concurrent-tasks 1'
    )
    expect(packageJson.scripts['eval:benchmark:baseline']).not.toContain(
      '--review-mode pr --review-depth thorough'
    )
    expect(packageJson.scripts['eval:benchmark:baseline']).not.toContain(
      '--intent-planning model --judge-findings'
    )
    expect(packageJson.scripts['eval:benchmark:agentic']).toBe(
      packageJson.scripts['eval:benchmark:debug']
    )
    expect(packageJson.scripts['eval:benchmark:agentic']).toContain(
      '--semantic-judge --max-concurrent-tasks 1'
    )
    expect(packageJson.scripts['eval:benchmark:deterministic']).toContain(
      `--slice-root ${hydratedBenchmarkSliceRoot}`
    )
    expect(packageJson.scripts['eval:benchmark:deterministic']).not.toContain(
      '--semantic-judge'
    )
    expect(packageJson.scripts['eval:benchmark:deterministic']).not.toContain(
      '--env-file-if-exists=.env'
    )
    expect(packageJson.scripts['eval:benchmark-manifest']).toContain(
      `--slice-root ${hydratedBenchmarkSliceRoot}`
    )
  })
})
