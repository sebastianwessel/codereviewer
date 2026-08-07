import { describe, expect, test } from 'vitest'
import { loadEvalCasesFromFixtures } from './eval-fixture-loader.js'
import { parseGitDiffMaps } from '../../repository-intake/index.js'

const repositoryRoot = process.cwd()

const lineRangeOverlapsHunk = (
  lineRange: readonly [number, number],
  hunk: { readonly newStartLine: number; readonly newLineCount: number }
): boolean => {
  const hunkStart = hunk.newStartLine
  const hunkEnd = hunk.newStartLine + Math.max(1, hunk.newLineCount) - 1

  return lineRange[0] <= hunkEnd && lineRange[1] >= hunkStart
}

describe('eval fixture loader', () => {
  test('includes project-owned semantic proof-quality slices in default evals', async () => {
    const cases = await loadEvalCasesFromFixtures(repositoryRoot, {
      sliceRoot: 'eval/fixtures/proof-quality-slices'
    })
    const proofQualityCases = cases.filter((evalCase) =>
      evalCase.tags.includes('proof-quality')
    )

    expect(proofQualityCases.map((evalCase) => evalCase.id).sort()).toEqual([
      'semantic-authz-cross-file',
      'semantic-authz-defensive-control',
      'semantic-billing-discount-regression',
      'semantic-command-injection-shell',
      'semantic-dayjs-slot-boundary',
      'semantic-endpoint-null-deref',
      'semantic-file-handle-leak',
      'semantic-go-cache-concurrency',
      'semantic-idfor-check-then-act',
      'semantic-lastn-index-overflow',
      'semantic-pagination-boundary-control',
      'semantic-parameterized-query-control',
      'semantic-path-traversal-resolve',
      'semantic-percentage-integer-truncation',
      'semantic-sql-injection-concat'
    ])
    expect(
      proofQualityCases.every(
        (evalCase) => evalCase.sourceProfile === 'project'
      )
    ).toBe(true)
    expect(
      proofQualityCases.filter((evalCase) => evalCase.expectedFindings.length === 0)
    ).toHaveLength(3)
    expect(
      proofQualityCases.reduce(
        (total, evalCase) => total + evalCase.expectedFindings.length,
        0
      )
    ).toBe(14)
    expect(
      proofQualityCases.map((evalCase) => [evalCase.id, evalCase.diff !== undefined])
    ).toEqual([
      ['semantic-authz-cross-file', true],
      ['semantic-authz-defensive-control', true],
      ['semantic-billing-discount-regression', true],
      ['semantic-command-injection-shell', true],
      ['semantic-dayjs-slot-boundary', true],
      ['semantic-endpoint-null-deref', true],
      ['semantic-file-handle-leak', true],
      ['semantic-go-cache-concurrency', true],
      ['semantic-idfor-check-then-act', true],
      ['semantic-lastn-index-overflow', true],
      ['semantic-pagination-boundary-control', true],
      ['semantic-parameterized-query-control', true],
      ['semantic-path-traversal-resolve', true],
      ['semantic-percentage-integer-truncation', true],
      ['semantic-sql-injection-concat', true]
    ])
  })

  test('keeps path-line expectations inside their slice diff hunks', async () => {
    const cases = await loadEvalCasesFromFixtures(repositoryRoot, {
      sliceRoot: 'eval/fixtures/proof-quality-slices'
    })

    for (const evalCase of cases) {
      if (evalCase.diff === undefined) {
        continue
      }

      const diffMaps = parseGitDiffMaps(evalCase.diff)

      for (const expectedFinding of evalCase.expectedFindings) {
        if (
          expectedFinding.path === undefined ||
          expectedFinding.lineRange === undefined
        ) {
          continue
        }

        const lineRange = expectedFinding.lineRange
        const diffMap = diffMaps.find(
          (candidate) => candidate.path === expectedFinding.path
        )

        expect(
          diffMap?.hunks.some((hunk) =>
            lineRangeOverlapsHunk(lineRange, hunk)
          ),
          `${evalCase.id} expected finding on ${expectedFinding.path}:${lineRange.join('-')} must overlap the slice diff`
        ).toBe(true)
      }
    }
  })
})
