import { describe, expect, test } from 'vitest'
import { renderChangeImpactEvalSummary } from './change-impact-eval-rendering.js'
import { buildChangeImpactEvalReport } from './change-impact-eval-report.js'
import { scoreChangeImpactCases } from './change-impact-scoring.js'
import {
  corpusCaseFixture,
  impactReportFixture
} from './change-impact-fixture.js'
import type { ChangeImpactCaseInput } from './change-impact-scoring.js'

const render = (input: {
  readonly cases: readonly ChangeImpactCaseInput[]
  readonly providerConfigured?: boolean
  readonly adjudicationRequested?: boolean
  readonly warnings?: readonly string[]
}): string =>
  renderChangeImpactEvalSummary(
    buildChangeImpactEvalReport({
      score: scoreChangeImpactCases(input.cases),
      generatedAt: new Date('2026-08-06T09:00:00.000Z'),
      datasetId: 'change-impact-dependents',
      selection: {
        manifestPath: 'eval/corpora/change-impact-dependents/manifest.json',
        caseRoot:
          '.codereviewer/eval/change-impact-cases/change-impact-dependents',
        caseFilters: [],
        selectedCaseIds: input.cases.map((entry) => entry.corpusCase.id)
      },
      engine: {
        commit: 'c3c0c3d0000000000000000000000000000000ab',
        workingTreeClean: true,
        adjudicationRequested: input.adjudicationRequested ?? true
      },
      provenance: {
        answerKeyDigest: 'aaaaaaaaaaaaaaaa',
        answerKeyDigestByCase: {},
        configHash: 'bbbbbbbbbbbbbbbb',
        ...(input.providerConfigured === false
          ? {}
          : { providerId: 'openai', modelName: 'gpt-5.3-codex' })
      },
      warnings: [...(input.warnings ?? [])]
    })
  )

const scoredCase = (input: {
  readonly id: string
  readonly adjudicationStatus?: 'disabled' | 'no-model' | 'completed'
}): ChangeImpactCaseInput => ({
  corpusCase: corpusCaseFixture({
    id: input.id,
    expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }]
  }),
  outcome: {
    status: 'scored',
    report: impactReportFixture({
      referenceFiles: ['src/a.py', 'src/noise.py'],
      findingFiles: ['src/a.py'],
      ...(input.adjudicationStatus === undefined
        ? {}
        : { adjudicationStatus: input.adjudicationStatus })
    })
  }
})

describe('change-impact eval summary', () => {
  test('renders all three arms, so no one can be read without the others', () => {
    const markdown = render({ cases: [scoredCase({ id: 'case-a' })] })

    expect(markdown).toContain('Arm 1 — deterministic reference list')
    expect(markdown).toContain('Arm 2 — after adjudication')
    expect(markdown).toContain('Arm 3 — what adjudication removed, by tier')
  })

  // THE VOIDED RUN, AT THE SURFACE A HUMAN READS. Spec 22's first adjudication
  // measurement was read as a judge that rejected everything; the judge had been
  // called zero times, and the document said nothing about that.
  test('refuses to present a zero-call run as what the judge removed', () => {
    const markdown = render({
      cases: [
        {
          corpusCase: corpusCaseFixture({
            id: 'swept',
            expected: [
              { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
            ]
          }),
          outcome: {
            status: 'scored',
            report: impactReportFixture({
              referenceFiles: ['src/a.py', 'src/noise.py'],
              findingFiles: [],
              deterministicNoImpactPairCount: 2,
              adjudicationCallCount: 0
            })
          }
        }
      ]
    })

    // The arm is split, and the model-tier half says outright that it is empty.
    expect(markdown).toContain(
      '### Deterministic tier only — the model was never called'
    )
    expect(markdown).toContain(
      '**No fully adjudicated case spent a single model call.**'
    )
    expect(markdown).toContain('nothing here is evidence about the judge')
    // The call count is on the page, per case and in aggregate.
    expect(markdown).toContain('| **model calls spent** | 0 |')
    expect(markdown).toContain(
      '| — adjudicated cases in which the model was NEVER called | 1 |'
    )
    expect(markdown).toContain('**none — judge never ran**')
  })

  test('shows the verdict distribution the model returned', () => {
    const markdown = render({ cases: [scoredCase({ id: 'case-a' })] })

    expect(markdown).toContain('| — verdict `relies` | 1 |')
    expect(markdown).toContain('| — verdict `does-not-rely` | 1 |')
    expect(markdown).toContain('| — verdict `undetermined` | 0 |')
    expect(markdown).toContain('| **model calls spent** | 2 |')
  })

  test('names the provider and model the numbers belong to', () => {
    expect(render({ cases: [scoredCase({ id: 'case-a' })] })).toContain(
      'openai/gpt-5.3-codex'
    )
    expect(
      render({ cases: [scoredCase({ id: 'case-a' })], providerConfigured: false })
    ).toContain('no provider configured')
  })

  test('names the engine commit and says when the working tree was dirty', () => {
    const markdown = render({ cases: [scoredCase({ id: 'case-a' })] })

    expect(markdown).toContain('c3c0c3d0000000000000000000000000000000ab')
    expect(markdown).toContain('clean')
  })

  // A not-measured cell that printed a percentage would be read as a result.
  test('never prints a percentage for a dimension nothing measured', () => {
    const markdown = render({
      cases: [
        {
          corpusCase: corpusCaseFixture({
            id: 'not-hydrated',
            expected: [
              { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
            ]
          }),
          outcome: {
            status: 'unmeasured',
            reason: 'not-hydrated',
            detail: 'no hydrated checkout'
          }
        }
      ]
    })

    expect(markdown).not.toMatch(/\d+\.\d%/u)
    expect(markdown).toContain('not measured')
    expect(markdown).toContain('unmeasured: not-hydrated')
  })

  test('renders the adjudicated arm as not measured when no model ran', () => {
    const markdown = render({
      cases: [scoredCase({ id: 'case-a', adjudicationStatus: 'no-model' })]
    })

    // The reference arm still has a real number.
    expect(markdown).toContain('50.0%')
    expect(markdown).toContain(
      'No case produced an adjudicated answer'
    )
  })

  test('prints precision as two bounds, with the upper one refused for this corpus', () => {
    const markdown = render({ cases: [scoredCase({ id: 'case-a' })] })

    expect(markdown).toContain('lower bound')
    expect(markdown).toContain(
      'upper bound not measurable on this corpus'
    )
  })

  // A reader must not take a low arm-2 number at face value when the run simply
  // ran out of calls.
  test('discloses pairs nothing adjudicated, and says they are undetermined', () => {
    const markdown = render({
      cases: [
        {
          corpusCase: corpusCaseFixture({
            id: 'capped',
            expected: [
              { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
            ]
          }),
          outcome: {
            status: 'scored',
            report: impactReportFixture({
              referenceFiles: ['src/a.py', 'src/noise.py'],
              findingFiles: ['src/noise.py'],
              unadjudicatedPairCount: 3,
              adjudicationCallsTruncated: true
            })
          }
        }
      ]
    })

    expect(markdown).toContain('pairs no adjudicator settled')
    expect(markdown).toContain('UNDETERMINED')
    expect(markdown).toContain('maxCalls')
  })

  test('states that there is no correct-removals count and why', () => {
    expect(render({ cases: [scoredCase({ id: 'case-a' })] })).toContain(
      'There is no "correct removals" count'
    )
  })

  test('says outright that no figure here settles anything on its own', () => {
    const markdown = render({ cases: [scoredCase({ id: 'case-a' })] })

    expect(markdown).toContain('A single run decides nothing.')
    expect(markdown).toContain('What this cannot tell you')
  })

  test('renders run warnings rather than dropping them', () => {
    expect(
      render({
        cases: [scoredCase({ id: 'case-a' })],
        warnings: ['Adjudication was requested but no model lane could be created']
      })
    ).toContain('no model lane could be created')
  })
})
