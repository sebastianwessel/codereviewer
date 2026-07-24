import { describe, expect, test } from 'vitest'
import { loadEvalSliceCasesFromRoot } from './eval-fixture-loader.js'
import { createEvalSliceManifest } from './eval-slice-manifest.js'

const repositoryRoot = process.cwd()
const benchmarkSliceRoot = 'eval/benchmarks/code-review-bench-style'
const proofQualitySliceRoot = 'eval/fixtures/proof-quality-slices'

const countBy = <T extends string>(
  values: readonly T[]
): Record<T, number> =>
  values.reduce<Record<T, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {} as Record<T, number>)

describe('code review benchmark-style fixture pack', () => {
  test('loads a broad curated PR review case set', async () => {
    const cases = await loadEvalSliceCasesFromRoot(
      repositoryRoot,
      benchmarkSliceRoot
    )
    const tags = new Set(cases.flatMap((evalCase) => evalCase.tags))
    const languageCounts = countBy(cases.map((evalCase) => evalCase.language))
    const expectedFindingCount = cases.reduce(
      (total, evalCase) => total + evalCase.expectedFindings.length,
      0
    )
    const negativeCases = cases.filter(
      (evalCase) => evalCase.expectedFindings.length === 0
    )

    expect(cases).toHaveLength(59)
    expect(languageCounts).toEqual({
      go: 12,
      java: 12,
      python: 11,
      ruby: 12,
      typescript: 12
    })
    expect(new Set(cases.map((evalCase) => evalCase.sourceProfile))).toEqual(
      new Set(['captured-pr'])
    )
    expect(expectedFindingCount).toBeGreaterThanOrEqual(100)
    expect(negativeCases).toHaveLength(10)
    expect(cases.every((evalCase) => evalCase.diff !== undefined)).toBe(true)
    expect(
      cases.every((evalCase) => evalCase.expectedNoFindingZones.length > 0)
    ).toBe(true)
    expect([...tags]).toEqual(
      expect.arrayContaining([
        'code-review-bench-style',
        'curated-pr',
        'semantic',
        'negative',
        'precision',
        'cross-file',
        'local-logic',
        'api-contract',
        'security',
        'performance',
        'concurrency',
        'null-reference'
      ])
    )
  })

  test('labels every committed security finding with a spec-15 mechanism and context depth', async () => {
    const cases = [
      ...(await loadEvalSliceCasesFromRoot(repositoryRoot, benchmarkSliceRoot)),
      ...(await loadEvalSliceCasesFromRoot(repositoryRoot, proofQualitySliceRoot))
    ]
    const expectedFindings = cases.flatMap(
      (evalCase) => evalCase.expectedFindings
    )
    const securityFindings = expectedFindings.filter(
      (finding) => finding.category === 'security'
    )

    // Every security finding carries both labels; no non-security finding does.
    expect(
      securityFindings.every(
        (finding) =>
          finding.securityMechanism !== undefined &&
          finding.contextDepth !== undefined
      )
    ).toBe(true)
    expect(
      expectedFindings
        .filter((finding) => finding.category !== 'security')
        .every(
          (finding) =>
            finding.securityMechanism === undefined &&
            finding.contextDepth === undefined
        )
    ).toBe(true)

    expect(securityFindings).toHaveLength(45)
    expect(
      countBy(
        securityFindings.map((finding) => finding.securityMechanism!)
      )
    ).toEqual({
      authorization: 23,
      'concurrency-resource': 3,
      cryptography: 1,
      deserialization: 1,
      injection: 2,
      'path-traversal': 1,
      'secret-flow': 5,
      ssrf: 2,
      'unsafe-config': 4,
      xss: 3
    })
    expect(
      countBy(securityFindings.map((finding) => finding.contextDepth!))
    ).toEqual({
      'analyzer-path-dependent': 4,
      callee: 3,
      caller: 1,
      'cross-file': 6,
      'cross-function': 5,
      implementation: 4,
      local: 22
    })
    // Obvious (local) vs hard (everything else) ground-truth split.
    const obvious = securityFindings.filter(
      (finding) => finding.contextDepth === 'local'
    )
    expect(obvious).toHaveLength(22)
    expect(securityFindings.length - obvious.length).toBe(23)
  })

  test('manifest captures the benchmark pack without source text', async () => {
    const manifest = await createEvalSliceManifest({
      repositoryRoot,
      sliceRoot: benchmarkSliceRoot,
      generatedAt: '2026-06-21T00:00:00.000Z'
    })

    expect(manifest.caseCount).toBe(59)
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/u)
    expect(
      manifest.cases.every(
        (manifestCase) => manifestCase.sourceProfile === 'captured-pr'
      )
    ).toBe(true)
    expect(
      manifest.cases.reduce(
        (total, manifestCase) => total + manifestCase.expectedFindingCount,
        0
      )
    ).toBeGreaterThanOrEqual(100)
    expect(JSON.stringify(manifest)).not.toContain('Minimal source exists')
  })
})
