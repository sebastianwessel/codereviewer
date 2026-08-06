import { describe, expect, test } from 'vitest'
import {
  buildChangeImpactEvalReport,
  parseChangeImpactEvalReport,
  ChangeImpactEvalReportSchema,
  CHANGE_IMPACT_EVAL_ARTIFACT_ROOT,
  CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME,
  CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME
} from './change-impact-eval-report.js'
import { CHANGE_IMPACT_METRICS_VERSION } from './change-impact-metrics-versions.js'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME
} from './eval-summary-report-rendering.js'
import { EVAL_METRICS_VERSION } from './eval-metrics-versions.js'
import { EvalReportSchema } from './eval-report-contracts.js'
import {
  changeImpactUnmeasuredReasons,
  corpusSplits,
  impactReachabilityClasses,
  scoreChangeImpactCases
} from './change-impact-scoring.js'
import {
  corpusCaseFixture,
  impactReportFixture
} from './change-impact-fixture.js'

const reportFor = (input: {
  readonly adjudicationStatus?: 'disabled' | 'no-model' | 'completed'
}) =>
  buildChangeImpactEvalReport({
    score: scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'case-a',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'scored',
          report: impactReportFixture({
            referenceFiles: ['src/a.py'],
            findingFiles: ['src/a.py'],
            ...(input.adjudicationStatus === undefined
              ? {}
              : { adjudicationStatus: input.adjudicationStatus })
          })
        }
      }
    ]),
    generatedAt: new Date('2026-08-06T09:00:00.000Z'),
    datasetId: 'change-impact-dependents',
    selection: {
      manifestPath: 'eval/corpora/change-impact-dependents/manifest.json',
      caseRoot: '.codereviewer/eval/change-impact-cases/change-impact-dependents',
      caseFilters: [],
      selectedCaseIds: ['case-a']
    },
    engine: {
      commit: 'c3c0c3d0000000000000000000000000000000ab',
      workingTreeClean: true,
      adjudicationRequested: true
    },
    provenance: {
      answerKeyDigest: 'digest',
      answerKeyDigestByCase: { 'case-a': 'digest' },
      configHash: 'config',
      providerId: 'openai',
      modelName: 'gpt-5.3-codex'
    },
    warnings: []
  })

describe('change-impact eval report: it cannot be pooled with the eval report', () => {
  // Spec 22 forbids pooling this corpus with spec 17's. A shared report shape is
  // one of the ways two corpora get pooled by accident, so the two contracts
  // reject each other outright.
  test('an eval report does not parse as a change-impact eval report', () => {
    const notThisReport = {
      schemaVersion: '1.0',
      generatedAt: '2026-08-06T09:00:00.000Z',
      fixtureCount: 3,
      metrics: { recall: 0.5 }
    }

    expect(
      ChangeImpactEvalReportSchema.safeParse(notThisReport).success
    ).toBe(false)
  })

  test('a change-impact eval report does not parse as an eval report', () => {
    expect(EvalReportSchema.safeParse(reportFor({})).success).toBe(false)
  })

  test('its artefact names and root are distinct from the eval run artefacts', () => {
    for (const name of [
      CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME,
      CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME
    ]) {
      expect(name).not.toBe(EVAL_SUMMARY_ARTIFACT_NAME)
      expect(name).not.toBe(EVAL_RECALL_REPORT_ARTIFACT_NAME)
      expect(name).toContain('change-impact')
    }

    expect(CHANGE_IMPACT_EVAL_ARTIFACT_ROOT).toContain('change-impact')
  })

  test('it carries the change-impact metrics version, never the diff reviewer one', () => {
    const report = reportFor({})

    expect(report.metricsVersion).toBe(CHANGE_IMPACT_METRICS_VERSION)
    expect(report.metricsVersion).not.toBe(EVAL_METRICS_VERSION)
  })

  test('the report kind is a literal nothing else writes', () => {
    expect(reportFor({}).reportKind).toBe('change-impact-dependents')
    expect(
      ChangeImpactEvalReportSchema.safeParse({
        ...reportFor({}),
        reportKind: 'real-repo-cross-file'
      }).success
    ).toBe(false)
  })
})

describe('change-impact eval report: the schema keys track the vocabularies', () => {
  // The schema spells the dimensions out for readability; these pin them to the
  // exported vocabularies so the two cannot drift.
  test('recall is keyed by every reachability class and nothing else', () => {
    const report = reportFor({})

    expect(Object.keys(report.arms.reference.byReachability).sort()).toEqual(
      [...impactReachabilityClasses].sort()
    )
    expect(Object.keys(report.arms.adjudicated.byReachability).sort()).toEqual(
      [...impactReachabilityClasses].sort()
    )
  })

  test('recall is keyed by every contamination split and nothing else', () => {
    expect(Object.keys(reportFor({}).arms.reference.bySplit).sort()).toEqual(
      [...corpusSplits].sort()
    )
  })

  test('coverage counts every unmeasured reason and nothing else', () => {
    expect(
      Object.keys(reportFor({}).coverage.unmeasuredByReason).sort()
    ).toEqual([...changeImpactUnmeasuredReasons].sort())
  })
})

describe('change-impact eval report: absence survives serialisation', () => {
  // The scorer's `undefined` must not come back as `false` after a JSON round
  // trip, or "we did not check" would be indistinguishable from "we checked and
  // it is not there" in the artefact everyone actually reads.
  test('an unadjudicated expectation is ABSENT, not false, in the saved artefact', () => {
    const report = reportFor({ adjudicationStatus: 'no-model' })
    const roundTripped = parseChangeImpactEvalReport(
      JSON.parse(JSON.stringify(report))
    )
    const [caseResult] = roundTripped.caseResults

    expect(caseResult?.status).toBe('scored')

    if (caseResult?.status !== 'scored') {
      throw new Error('expected a scored case result')
    }

    expect(caseResult.expectations[0]).not.toHaveProperty('inAdjudicatedList')
    expect(caseResult).not.toHaveProperty('adjudicatedFileCount')
    expect(roundTripped.arms.adjudicated.directlyReachable.measured.status).toBe(
      'not-measured'
    )
  })

  test('a not-measured rate carries no rate field to misread', () => {
    const report = reportFor({ adjudicationStatus: 'no-model' })
    const cell = report.arms.adjudicated.byReachability['attribute-owner']

    expect(cell.measured.status).toBe('not-measured')
    expect(cell.measured).not.toHaveProperty('rate')
  })
})
