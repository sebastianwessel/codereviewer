import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const hydratedBenchmarkSliceRoot =
  '.codereviewer/eval/benchmark-slices/code-review-bench-style'

describe('evaluation package scripts', () => {
  test('exposes only the three kept eval scripts with correct shape', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      readonly scripts: Record<string, string>
    }

    // eval:hydrate — hydrates the benchmark slice pack, no provider call
    expect(packageJson.scripts['eval:hydrate']).toContain(
      'scripts/hydrate-code-review-benchmark.ts'
    )
    expect(packageJson.scripts['eval:hydrate']).not.toContain('--quiet')

    // eval:benchmark — full agentic PR-review posture on the hydrated slice root
    expect(packageJson.scripts['eval:benchmark']).toContain(
      'scripts/hydrate-code-review-benchmark.ts --quiet'
    )
    expect(packageJson.scripts['eval:benchmark']).toContain(
      `--slice-root ${hydratedBenchmarkSliceRoot}`
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
    expect(packageJson.scripts['eval:benchmark']).not.toContain('--debug')
    expect(packageJson.scripts['eval:benchmark']).not.toContain('--log-file')

    // eval:benchmark:debug — same agentic posture plus debug log
    expect(packageJson.scripts['eval:benchmark:debug']).toContain(
      'scripts/hydrate-code-review-benchmark.ts --quiet'
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
      '--semantic-judge --max-concurrent-tasks 1'
    )
    expect(packageJson.scripts['eval:benchmark:debug']).toContain('--debug')
    expect(packageJson.scripts['eval:benchmark:debug']).toContain(
      '--log-file .codereviewer/eval/log.log'
    )

    // removed scripts must not exist
    const removed = [
      'eval',
      'eval:with-env',
      'eval:cheap:refutation',
      'eval:cheap:provider',
      'eval:cheap',
      'eval:semantic',
      'eval:benchmark:prepare',
      'eval:benchmark:smoke',
      'eval:benchmark:agentic',
      'eval:benchmark:baseline',
      'eval:benchmark:deterministic',
      'eval:slice-manifest',
      'eval:benchmark-manifest'
    ]
    for (const script of removed) {
      expect(packageJson.scripts[script]).toBeUndefined()
    }
  })
})
