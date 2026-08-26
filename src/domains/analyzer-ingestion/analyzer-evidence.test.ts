import { describe, expect, test } from 'vitest'
import { EvidenceRecordSchema } from '../../shared/contracts/index.js'
import { analyzerEvidenceFor } from './analyzer-evidence.js'
import {
  AttributedAnalyzerAlertSchema,
  type AttributedAnalyzerAlert
} from './contracts.js'

const attributed: AttributedAnalyzerAlert =
  AttributedAnalyzerAlertSchema.parse({
    alert: {
      id: 'alert_0123456789abcdef01234567',
      artifact: {
        path: 'reports/analyzer.sarif.json',
        contentHash: 'f'.repeat(64)
      },
      analyzer: { name: 'example-analyzer', version: '3.4.5' },
      ruleId: 'security/query-injection',
      ruleName: 'QueryInjection',
      helpUri: 'https://example.invalid/rules/query-injection',
      cwe: ['CWE-89'],
      level: 'error',
      securitySeverity: 8.8,
      message: 'Untrusted request value is concatenated into a query.',
      location: { path: 'src/service/orders.ts', startLine: 42, side: 'new' },
      relatedLocations: [
        {
          id: 'alert_0123456789abcdef01234567_related0',
          location: { path: 'src/service/orders.ts', startLine: 40, side: 'new' },
          message: 'Value enters here.'
        }
      ],
      dataFlow: [
        {
          id: 'alert_0123456789abcdef01234567_flow0',
          label: 'request value to query',
          steps: [
            {
              id: 'alert_0123456789abcdef01234567_flow0_step0',
              location: { path: 'src/service/orders.ts', startLine: 40, side: 'new' },
              message: 'Source.'
            },
            {
              id: 'alert_0123456789abcdef01234567_flow0_step1',
              location: { path: 'src/service/orders.ts', startLine: 42, side: 'new' },
              message: 'Sink.'
            }
          ]
        }
      ]
    },
    attribution: 'changed-line',
    attributedPath: 'src/service/orders.ts',
    attributedLine: 42
  })

describe('analyzer evidence', () => {
  test('populates the security evidence fields that previously had no producer', () => {
    const evidence = analyzerEvidenceFor(attributed)

    // The four fields spec 15 records as defined-but-unpopulated, plus the related
    // locations that carry the rest of the observation.
    expect(evidence.ruleId).toBe('security/query-injection')
    expect(evidence.cwe).toEqual(['CWE-89'])
    expect(evidence.securitySeverity).toBe(8.8)
    expect(evidence.dataFlow?.[0]?.steps.map((step) => step.location.startLine)).toEqual([
      40, 42
    ])
    expect(evidence.helpUri).toBe(
      'https://example.invalid/rules/query-injection'
    )
    expect(evidence.relatedLocations).toHaveLength(1)
  })

  test('records the producing analyzer and its version as provenance', () => {
    const evidence = analyzerEvidenceFor(attributed)

    expect(evidence.source).toBe('analyzer:example-analyzer')
    expect(evidence.sourceVersion).toBe('3.4.5')
    expect(evidence.kind).toBe('diagnostic')
    expect(evidence.redactionApplied).toBe(true)
  })

  test('the produced record validates against the shared evidence contract', () => {
    expect(() =>
      EvidenceRecordSchema.parse(analyzerEvidenceFor(attributed))
    ).not.toThrow()
  })

  test('records the artifact that made the claim', () => {
    const evidence = analyzerEvidenceFor(attributed)

    expect(evidence.contentHash).toBe('f'.repeat(64))
    expect(evidence.rawContentRef).toBe('reports/analyzer.sarif.json')
  })

  test('the summary names where the attribution came from', () => {
    expect(analyzerEvidenceFor(attributed).summary).toContain(
      'reported on a changed line (src/service/orders.ts:42)'
    )
  })

  test('an alert with no CWE or severity yields a record without those fields', () => {
    const bare = AttributedAnalyzerAlertSchema.parse({
      ...attributed,
      alert: {
        ...attributed.alert,
        cwe: [],
        securitySeverity: undefined,
        helpUri: undefined,
        relatedLocations: [],
        dataFlow: []
      }
    })
    const evidence = analyzerEvidenceFor(bare)

    // Absent in the artifact stays absent here: nothing is invented.
    expect(evidence.cwe).toBeUndefined()
    expect(evidence.securitySeverity).toBeUndefined()
    expect(evidence.dataFlow).toBeUndefined()
    expect(evidence.relatedLocations).toBeUndefined()
  })
})
