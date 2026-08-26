import { describe, expect, test } from 'vitest'
import type { AdmittedFinding, FindingProvenance } from '../../../shared/contracts/index.js'
import { parseEvalCases, type EvalCase } from '../corpus/eval-fixture.schema.js'
import {
  createEvalPlausibilityRedactionCache,
  EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP,
  judgeUnmatchedFindingsPlausibility,
  prepareEvalPlausibilitySource,
  type EvalPlausibilityJudge,
  type EvalPlausibilityJudgeInput
} from './eval-plausibility-judge.js'

const hash =
  '2222222222222222222222222222222222222222222222222222222222222222'

const provenance: FindingProvenance = {
  reviewer: 'scripted-reviewer',
  instructionHashes: [],
  skillHashes: [],
  signalVersions: {},
  configHash: hash
}

const finding = (overrides: Partial<AdmittedFinding> = {}): AdmittedFinding => ({
  id: 'find_plaus1',
  taskId: 'task_plaus1',
  category: 'bug',
  severity: 'high',
  title: 'Unmatched finding',
  description: 'An admitted finding that matched no expected finding.',
  location: { path: 'src/app.ts', startLine: 7, side: 'new' },
  evidenceIds: ['ev_plaus1'],
  proposedBy: 'scripted-reviewer',
  fixProposal: {
    summary: 'Fix it.',
    evidenceIds: ['ev_plaus1'],
    safety: 'manual-review'
  },
  admissionStatus: 'admitted',
  admittedAt: '2026-06-20T00:00:00.000Z',
  admissionEvidenceIds: ['ev_plaus1'],
  reporterEligibility: 'inline',
  provenance,
  baselineStatus: 'new',
  fingerprints: [{ algorithm: 'test', value: 'plaus1' }],
  ...overrides
})

const evalCase: EvalCase = parseEvalCases([
  {
    id: 'plausibility-case',
    language: 'typescript',
    repositoryFixture: 'fixtures/typescript/positive',
    changedFiles: ['src/app.ts'],
    expectedFindings: [],
    expectedNoFindingZones: [],
    tags: ['plausibility']
  }
])[0]!

const alwaysReader = async (): Promise<string> => 'const value = compute()\n'

describe('prepareEvalPlausibilitySource', () => {
  // A file of `lineCount` numbered filler lines, each wide enough that a few
  // thousand of them blow past the byte cap.
  const wideFile = (lineCount: number): string =>
    Array.from(
      { length: lineCount },
      (_unused, index) => `line ${index + 1} ${'x'.repeat(200)}`
    ).join('\n')

  test('redacts secrets in the new-side source before it reaches the judge', () => {
    const prepared = prepareEvalPlausibilitySource({
      content: 'const key = "sk-abcdefghijklmnop0123456789"\n',
      line: 1
    })

    expect(prepared.text).not.toContain('sk-abcdefghijklmnop0123456789')
    expect(prepared.text).toContain('[REDACTED]')
  })

  test('bounds oversized source, disclosure included, to the byte cap', () => {
    const prepared = prepareEvalPlausibilitySource({
      content: wideFile(2000),
      line: 1000
    })

    expect(Buffer.byteLength(prepared.text, 'utf8')).toBeLessThanOrEqual(
      EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP
    )
  })

  test('leaves small clean source unchanged apart from an explicit completeness line', () => {
    const source = 'export const add = (a: number, b: number) => a + b\n'
    const prepared = prepareEvalPlausibilitySource({ content: source, line: 1 })

    expect(prepared.partial).toBe(false)
    expect(prepared.findingLineOmittedByCap).toBe(false)
    // Stated even when nothing was cut, so the judge never has to guess whether
    // a short section means a short file or an omission.
    expect(prepared.text).toContain('[FILE CONTENT COMPLETE: all 1 lines')
    expect(prepared.text).toContain(source)
  })

  // The defect this fixes: the cut used to be a blind PREFIX, so a finding at a
  // line past the cap was judged against code that could not contain it, and the
  // judge answered plausible=false with confidence -- corrupting adjustedPrecision.
  test('centres the window on the finding line instead of taking a blind prefix', () => {
    const prepared = prepareEvalPlausibilitySource({
      content: wideFile(2000),
      line: 1900
    })

    expect(prepared.partial).toBe(true)
    expect(prepared.findingLineOmittedByCap).toBe(false)
    expect(prepared.text).toContain('line 1900 ')
    // Content around the finding on BOTH sides, and none of the far-away prefix.
    expect(prepared.text).toContain('line 1899 ')
    expect(prepared.text).toContain('line 1901 ')
    expect(prepared.text).not.toContain('line 1 x')
  })

  test('discloses a cut in the text the judge reads, naming the covered range', () => {
    const prepared = prepareEvalPlausibilitySource({
      content: wideFile(2000),
      line: 1900
    })

    expect(prepared.text).toMatch(
      /^\[FILE CONTENT PARTIAL: lines \d+-\d+ of 2000 are shown\./
    )
    expect(prepared.text).toContain("centred on the finding's location line 1900")
    // The judge must not read the omission as evidence, and must not be left to
    // discover the omission only if it happens to re-read the header.
    expect(prepared.text).toContain('is NOT evidence that the finding is wrong')
    expect(prepared.text.trimEnd()).toMatch(
      /\[END OF PARTIAL FILE CONTENT: lines \d+-\d+ of 2000\..*]$/
    )
  })

  test('reports a finding line the cap could not keep', () => {
    const prepared = prepareEvalPlausibilitySource({
      content: wideFile(2000),
      line: 999_999
    })

    expect(prepared.partial).toBe(true)
    expect(prepared.findingLineOmittedByCap).toBe(true)
  })

  // A location past the end of a file we handed over IN FULL is a bad line
  // number, not a loss this module caused: the judge sees everything there is.
  test('does not blame the cap for a bad line number in a complete file', () => {
    const prepared = prepareEvalPlausibilitySource({
      content: 'const value = compute()\n',
      line: 900
    })

    expect(prepared.partial).toBe(false)
    expect(prepared.findingLineOmittedByCap).toBe(false)
  })

  // A minified or generated file can be one enormous line. Nothing can be
  // centred, but the cut must still be bounded and disclosed rather than silent.
  test('bounds and discloses a single line larger than the whole budget', () => {
    const prepared = prepareEvalPlausibilitySource({
      content: 'x'.repeat(EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP * 2),
      line: 1
    })

    expect(prepared.partial).toBe(true)
    expect(prepared.findingLineOmittedByCap).toBe(false)
    expect(prepared.text).toContain('[FILE CONTENT PARTIAL: lines 1-1 of 1')
    expect(Buffer.byteLength(prepared.text, 'utf8')).toBeLessThanOrEqual(
      EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP
    )
  })

  // The same enormous single line, but built from characters outside the BMP. The
  // local binary search this module used to cut with searched UTF-16 CODE-UNIT
  // indices, so it could stop between the halves of a surrogate pair and hand the
  // judge a lone surrogate — not a character, and the byte the pair would have
  // cost is not what a lone half costs, so even the budget arithmetic was off.
  //
  // The padding is deliberate, not decoration: with a bare run of 4-byte emoji the
  // budget happens to fall on a pair boundary and the old code got away with it.
  // One leading ASCII byte shifts the parity so the largest fitting code-unit index
  // lands INSIDE a pair, which is the case that shipped broken.
  test('never cuts a surrogate pair in half on a single oversized line', () => {
    const budget = EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP - 1_024
    const prepared = prepareEvalPlausibilitySource({
      content: `x${'\u{1F600}'.repeat(EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP / 4)}`,
      line: 1
    })

    expect(prepared.partial).toBe(true)
    // The whole point: no unpaired surrogate anywhere in what the judge is sent.
    expect(prepared.text.isWellFormed()).toBe(true)
    expect(prepared.text).not.toMatch(/�/u)
    expect(
      Buffer.byteLength(prepared.text, 'utf8')
    ).toBeLessThanOrEqual(EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP)
    // And the cut is still a whole number of characters at the budget: one leading
    // 'x' plus as many 4-byte emoji as fit.
    expect(
      [...(prepared.text.split('\n')[1] ?? '')].length - 1
    ).toBe(Math.floor((budget - 1) / 4))
  })

  // The redaction is the same 13-sweep pass for every finding in a file; the
  // WINDOW is not — it is centred on each finding's own line. The cache holds the
  // first and must never hold the second.
  describe('the redaction cache', () => {
    test('still centres a different window on each finding line', () => {
      const content = wideFile(2000)
      const redactionCache = createEvalPlausibilityRedactionCache()

      const early = prepareEvalPlausibilitySource({
        content,
        line: 100,
        redactionCache
      })
      const late = prepareEvalPlausibilitySource({
        content,
        line: 1900,
        redactionCache
      })

      expect(early.text).toContain('line 100 ')
      expect(early.text).not.toContain('line 1900 ')
      expect(late.text).toContain('line 1900 ')
      expect(late.text).not.toContain('line 100 ')
      // ...and both are what an uncached call would have produced.
      expect(early).toEqual(
        prepareEvalPlausibilitySource({ content, line: 100 })
      )
      expect(late).toEqual(prepareEvalPlausibilitySource({ content, line: 1900 }))
    })

    test('serves redacted text on the cached path too', () => {
      const content = 'const key = "sk-abcdefghijklmnop0123456789"\n'
      const redactionCache = createEvalPlausibilityRedactionCache()

      prepareEvalPlausibilitySource({ content, line: 1, redactionCache })
      const second = prepareEvalPlausibilitySource({
        content,
        line: 1,
        redactionCache
      })

      expect(second.text).not.toContain('sk-abcdefghijklmnop0123456789')
      expect(second.text).toContain('[REDACTED]')
    })

    test('never answers for bytes it was not built from', () => {
      const redactionCache = createEvalPlausibilityRedactionCache()

      prepareEvalPlausibilitySource({
        content: 'const clean = 1\n',
        line: 1,
        redactionCache
      })
      const other = prepareEvalPlausibilitySource({
        content: 'const key = "sk-abcdefghijklmnop0123456789"\n',
        line: 1,
        redactionCache
      })

      expect(other.text).toContain('[REDACTED]')
      expect(other.text).not.toContain('const clean')
    })
  })
})

describe('judgeUnmatchedFindingsPlausibility', () => {
  test('returns an empty result when no plausibility judge is available', async () => {
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge: undefined,
      readFileContent: alwaysReader
    })

    expect(result).toEqual({
      outcomes: [],
      unlistedRealFindingIds: [],
      failClosedFindingIds: [],
      providerIssues: []
    })
  })

  test('returns an empty result when no source reader is available', async () => {
    const judge: EvalPlausibilityJudge = async () => ({
      plausible: true,
      reason: 'genuine'
    })
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: undefined
    })

    expect(result.outcomes).toEqual([])
  })

  test('credits a finding the judge deems genuine as an unlisted real defect', async () => {
    const seen: EvalPlausibilityJudgeInput[] = []
    const judge: EvalPlausibilityJudge = async (input) => {
      seen.push(input)

      return { plausible: true, reason: 'The bug is present in the shown code.' }
    }
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: alwaysReader
    })

    expect(result.unlistedRealFindingIds).toEqual(['find_plaus1'])
    expect(result.failClosedFindingIds).toEqual([])
    expect(result.providerIssues).toEqual([])
    expect(result.outcomes[0]).toMatchObject({
      findingId: 'find_plaus1',
      plausible: true,
      judged: true
    })
    // The judge saw the redacted/bounded file content, not an empty window.
    expect(seen[0]?.fileContent).toContain('compute()')
  })

  test('leaves a finding the judge deems spurious as a genuine false positive', async () => {
    const judge: EvalPlausibilityJudge = async () => ({
      plausible: false,
      reason: 'The finding misreads the code.'
    })
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: alwaysReader
    })

    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.failClosedFindingIds).toEqual([])
    expect(result.outcomes[0]).toMatchObject({ plausible: false, judged: true })
  })

  test('fails closed when the judge call throws after retries', async () => {
    const judge: EvalPlausibilityJudge = async () => {
      throw new Error('plausibility provider exploded')
    }
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: alwaysReader
    })

    // Never credited as real; stays a genuine false positive and is surfaced.
    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.failClosedFindingIds).toEqual(['find_plaus1'])
    expect(result.providerIssues[0]).toMatchObject({
      stage: 'eval_plausibility_judge',
      recovered: false
    })
    expect(result.outcomes[0]).toMatchObject({ plausible: false, judged: false })
  })

  test('fails closed when the finding source cannot be read', async () => {
    const judge: EvalPlausibilityJudge = async () => ({
      plausible: true,
      reason: 'would say genuine'
    })
    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: async () => undefined
    })

    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.failClosedFindingIds).toEqual(['find_plaus1'])
    expect(result.providerIssues[0]).toMatchObject({
      code: 'plausibility_source_unavailable',
      stage: 'eval_plausibility_judge'
    })
  })

  test('tells the judge the file content is complete when nothing was cut', async () => {
    const seen: EvalPlausibilityJudgeInput[] = []
    const judge: EvalPlausibilityJudge = async (input) => {
      seen.push(input)

      return { plausible: true, reason: 'genuine' }
    }
    await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [finding()],
      matchedFindings: [],
      judge,
      readFileContent: alwaysReader
    })

    expect(seen[0]?.fileContent).toContain('[FILE CONTENT COMPLETE')
  })

  // Before this fix the judge was handed a blind prefix of an oversized file with
  // no marker at all, so it scored a finding whose supporting code had been cut
  // away as implausible -- and that verdict feeds adjustedPrecision.
  test('hands the judge a finding-centred window and an explicit partial marker', async () => {
    const seen: EvalPlausibilityJudgeInput[] = []
    const judge: EvalPlausibilityJudge = async (input) => {
      seen.push(input)

      return { plausible: true, reason: 'genuine' }
    }
    const huge = Array.from(
      { length: 2000 },
      (_unused, index) => `line ${index + 1} ${'x'.repeat(200)}`
    ).join('\n')

    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [
        finding({ location: { path: 'src/app.ts', startLine: 1900, side: 'new' } })
      ],
      matchedFindings: [],
      judge,
      readFileContent: async () => huge
    })

    expect(result.unlistedRealFindingIds).toEqual(['find_plaus1'])
    expect(seen[0]?.fileContent).toContain('[FILE CONTENT PARTIAL')
    expect(seen[0]?.fileContent).toContain('line 1900 ')
    expect(seen[0]?.fileContent).not.toContain('line 1 x')
  })

  test('fails closed instead of judging when the cap cannot keep the finding line', async () => {
    let judgeCalls = 0
    const judge: EvalPlausibilityJudge = async () => {
      judgeCalls += 1

      return { plausible: true, reason: 'would say genuine' }
    }
    const huge = Array.from(
      { length: 2000 },
      (_unused, index) => `line ${index + 1} ${'x'.repeat(200)}`
    ).join('\n')

    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [
        finding({ location: { path: 'src/app.ts', startLine: 999_999, side: 'new' } })
      ],
      matchedFindings: [],
      judge,
      readFileContent: async () => huge
    })

    // Never asked, therefore never credited: a cut of ours must not be able to
    // move adjustedPrecision in either direction without saying so.
    expect(judgeCalls).toBe(0)
    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.failClosedFindingIds).toEqual(['find_plaus1'])
    expect(result.outcomes[0]).toMatchObject({ plausible: false, judged: false })
    expect(result.providerIssues[0]).toMatchObject({
      code: 'plausibility_source_line_omitted',
      stage: 'eval_plausibility_judge',
      recovered: false
    })
  })
})

// Reproduces the traefik shape from the precision audit: a nil-dereference finding
// matched at kubernetes_http.go:592, and the SAME defect restated by the reviewer
// three more times at :593. Before this fix, each restatement was judged alone
// (never shown the matched finding), so all three were individually confirmed
// "plausible" and separately credited as unlisted-real defects -- turning one real
// bug into four counted defects and pinning adjustedPrecision at 100% while raw
// precision collapsed. This test fails against the pre-fix matcher/judge because
// `judgeUnmatchedFindingsPlausibility` had no `matchedFindings` parameter at all
// and credited every plausible finding, restatement or not.
describe('judgeUnmatchedFindingsPlausibility restatement collapsing', () => {
  const nilDerefTitle = 'Nil pointer dereference on cfg after failed load'
  const nilDerefDescription =
    'cfg is dereferenced without checking the error returned by loadConfig, ' +
    'so a missing config file causes a nil pointer dereference.'

  const matchedNilDeref = finding({
    id: 'find_matched_592',
    location: { path: 'src/kubernetes_http.go', startLine: 592, side: 'new' },
    title: nilDerefTitle,
    description: nilDerefDescription
  })

  const restatementAt593 = (id: string): AdmittedFinding =>
    finding({
      id,
      location: { path: 'src/kubernetes_http.go', startLine: 593, side: 'new' },
      title: nilDerefTitle,
      description: nilDerefDescription
    })

  // Models a judge that correctly implements the new contract: it recognizes a
  // restatement only when the finding under review names the SAME defect as one
  // it was shown as already counted, and never invents sameness on its own.
  const restatementAwareJudge: EvalPlausibilityJudge = async (input) => {
    const alreadyCounted = input.alreadyCountedFindings ?? []
    const isSameDefect = alreadyCounted.some(
      (counted) => counted.title === input.findingTitle
    )

    return {
      plausible: true,
      reason: isSameDefect
        ? 'Same defect already credited at a nearby line in this file; not a further defect.'
        : 'A genuine defect the fixture never listed.',
      restatesAlreadyCounted: isSameDefect
    }
  }

  test('does not credit a restatement of an already-matched finding as unlisted-real', async () => {
    const restatements = ['find_restate_a', 'find_restate_b', 'find_restate_c'].map(
      restatementAt593
    )

    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: restatements,
      matchedFindings: [matchedNilDeref],
      judge: restatementAwareJudge,
      readFileContent: alwaysReader
    })

    // The defect is already counted once (as a match). Restating it three more
    // times at an adjacent line must not manufacture three additional real
    // defects: adjustedPrecision would otherwise absorb pure verbosity.
    expect(result.unlistedRealFindingIds).toEqual([])
    expect(result.outcomes.every((outcome) => outcome.plausible)).toBe(true)
    expect(
      result.outcomes.every((outcome) => outcome.restatesAlreadyCounted)
    ).toBe(true)
  })

  test('collapses repeated restatements of a defect the fixture never listed at all', async () => {
    // None of these three match an expected finding, so the FIRST occurrence is
    // the one genuine credit; the second and third restate it and must not add
    // further credit, exactly as if the fixture HAD listed the defect and these
    // were restatements of a matched finding.
    const first = restatementAt593('find_first')
    const second = finding({
      id: 'find_second',
      location: { path: 'src/kubernetes_http.go', startLine: 594, side: 'new' },
      title: nilDerefTitle,
      description: nilDerefDescription
    })
    const third = finding({
      id: 'find_third',
      location: { path: 'src/kubernetes_http.go', startLine: 595, side: 'new' },
      title: nilDerefTitle,
      description: nilDerefDescription
    })

    const result = await judgeUnmatchedFindingsPlausibility({
      evalCase,
      unmatchedFindings: [first, second, third],
      matchedFindings: [],
      judge: restatementAwareJudge,
      readFileContent: alwaysReader
    })

    expect(result.unlistedRealFindingIds).toEqual(['find_first'])
  })
})
