import { describe, expect, test } from 'vitest'
import { renderSarifReport } from './index.js'
import { validateSarifDocument } from './sarif-reporter.js'
import { createReportFixture } from './reporting-fixture.js'

describe('SARIF reporter', () => {
  test('renders SARIF 2.1.0 with repository-relative locations and fingerprints', () => {
    const sarif = JSON.parse(
      renderSarifReport(createReportFixture(), {
        category: 'codereviewer',
        maxResults: 25,
        target: 'generic'
      })
    )

    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs[0].automationDetails.id).toBe('codereviewer')
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      'src/app.ts'
    )
    expect(sarif.runs[0].results[0].partialFingerprints).toEqual({
      'v1-category-rule-path-location-title-evidence': 'abc123'
    })
    expect(sarif.runs[0].results[0].properties.fixProposal).toEqual({
      summary: 'Return the computed value from the changed branch.',
      evidenceIds: ['ev_diff1'],
      safety: 'manual-review',
      edits: [
        {
          path: 'src/app.ts',
          startLine: 4,
          endLine: 4,
          replacement: 'return computedValue',
          description: 'Replace the incorrect return value.'
        }
      ]
    })
    expect(JSON.stringify(sarif)).not.toContain('Changed branch can return an incorrect value.')
  })

  test('emits plain, unescaped message text and defines referenced rules', () => {
    const report = createReportFixture()
    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          admittedFindings: [
            {
              ...report.admittedFindings[0]!,
              ruleId: 'bug/return-branch',
              title: 'Bug in foo() with <T> & arr[i]',
              description: 'Use a.b(c) here.'
            }
          ]
        },
        { category: 'codereviewer', maxResults: 25, target: 'generic' }
      )
    )

    const result = sarif.runs[0].results[0]
    // SARIF consumers render message.text literally, so it must NOT be
    // Markdown/HTML escaped.
    expect(result.message.text).toBe(
      'Bug in foo() with <T> & arr[i]. Use a.b(c) here.'
    )
    expect(result.message.text).not.toContain('\\(')
    expect(result.message.text).not.toContain('&lt;')

    // Each referenced rule is defined in the driver.
    expect(sarif.runs[0].tool.driver.rules).toEqual([
      expect.objectContaining({ id: 'bug/return-branch' })
    ])
  })

  test('encodes artifact location URIs with forward-slash separators', () => {
    const report = createReportFixture()
    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          admittedFindings: [
            {
              ...report.admittedFindings[0]!,
              location: {
                path: 'src/my folder/a file.ts',
                startLine: 1,
                side: 'new'
              }
            }
          ]
        },
        { category: 'codereviewer', maxResults: 25, target: 'generic' }
      )
    )

    expect(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri
    ).toBe('src/my%20folder/a%20file.ts')
  })

  test('rejects absolute paths through report schema validation', () => {
    const report = createReportFixture()

    expect(() =>
      renderSarifReport(
        {
          ...report,
          admittedFindings: [
            {
              ...report.admittedFindings[0]!,
              location: {
                path: '/tmp/source.ts',
                startLine: 1,
                side: 'new'
              }
            }
          ]
        },
        {
          category: 'codereviewer',
          maxResults: 25,
          target: 'generic'
        }
      )
    ).toThrow()
  })

  test('renders a valid document for the github target', () => {
    const sarif = JSON.parse(
      renderSarifReport(createReportFixture(), {
        category: 'codereviewer',
        maxResults: 25,
        target: 'github'
      })
    )

    // github render must define rules referenced by results and carry fingerprints.
    expect(sarif.runs[0].tool.driver.rules.length).toBeGreaterThan(0)
    expect(
      Object.keys(sarif.runs[0].results[0].partialFingerprints).length
    ).toBeGreaterThan(0)
  })

  test('renders provider issues as redacted run metadata', () => {
    const report = createReportFixture()
    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          providerIssues: [
            {
              code: 'provider_timeout',
              stage: 'investigation',
              recovered: true,
              message:
                'Timed out while using sk-proj-abcdefghijklmnopqrstuvwxyz.'
            }
          ]
        },
        { category: 'codereviewer', maxResults: 25, target: 'github' }
      )
    )

    expect(sarif.runs[0].properties.providerIssues).toEqual([
      {
        code: 'provider_timeout',
        stage: 'investigation',
        recovered: true,
        message: 'Timed out while using [REDACTED].'
      }
    ])
    expect(sarif.runs[0].results).toHaveLength(report.admittedFindings.length)
    expect(JSON.stringify(sarif)).not.toContain(
      'sk-proj-abcdefghijklmnopqrstuvwxyz'
    )
  })

  test('excludes artifact-only admitted findings from SARIF results', () => {
    const report = createReportFixture()
    const actionable = {
      ...report.admittedFindings[0]!,
      id: 'find_actionable',
      title: 'Actionable finding',
      ruleId: 'bug/actionable'
    }
    const artifactOnly = {
      ...report.admittedFindings[0]!,
      id: 'find_artifact',
      title: 'Artifact-only diagnostic',
      ruleId: 'bug/artifact-only',
      reporterEligibility: 'artifact-only' as const,
      fingerprints: [
        {
          algorithm: 'v1',
          value: 'artifactonly'
        }
      ]
    }

    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          admittedFindings: [actionable, artifactOnly]
        },
        { category: 'codereviewer', maxResults: 25, target: 'github' }
      )
    )

    expect(sarif.runs[0].results).toHaveLength(1)
    expect(sarif.runs[0].results[0].ruleId).toBe('bug/actionable')
    expect(sarif.runs[0].tool.driver.rules).toEqual([
      expect.objectContaining({ id: 'bug/actionable' })
    ])
    expect(JSON.stringify(sarif)).not.toContain('Artifact-only diagnostic')
    expect(JSON.stringify(sarif)).not.toContain('bug/artifact-only')
  })

  test('rejects malformed SARIF documents', () => {
    const validBase = {
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'codereviewer', rules: [{ id: 'bug' }] } },
          results: [
            {
              ruleId: 'bug',
              level: 'error' as const,
              message: { text: 'x' },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/app.ts' },
                    region: { startLine: 1 }
                  }
                }
              ],
              partialFingerprints: { v1: 'abc' } as Record<string, string>,
              properties: { category: 'bug', baselineStatus: 'new' }
            }
          ]
        }
      ]
    }

    expect(() => validateSarifDocument(validBase, 'github')).not.toThrow()

    expect(() =>
      validateSarifDocument({ ...validBase, version: '2.0.0' }, 'generic')
    ).toThrow(/2\.1\.0/u)

    const noFingerprints = structuredClone(validBase)
    noFingerprints.runs[0]!.results[0]!.partialFingerprints = {}
    expect(() => validateSarifDocument(noFingerprints, 'github')).toThrow(
      /fingerprints/u
    )

    const badUri = structuredClone(validBase)
    badUri.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri =
      '/abs/path.ts'
    expect(() => validateSarifDocument(badUri, 'generic')).toThrow(
      /repository-relative/u
    )
  })

  test('encodes fix-edit paths and preserves duplicate-algorithm fingerprints', () => {
    const report = createReportFixture()
    const base = report.admittedFindings[0]!
    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          admittedFindings: [
            {
              ...base,
              fingerprints: [
                { algorithm: 'v1', value: 'aaa' },
                { algorithm: 'v1', value: 'bbb' }
              ],
              fixProposal: {
                ...base.fixProposal!,
                edits: [
                  {
                    path: 'src/my folder/a file.ts',
                    startLine: 1,
                    endLine: 1,
                    replacement: 'return x'
                  }
                ]
              }
            }
          ]
        },
        { category: 'codereviewer', maxResults: 25, target: 'generic' }
      )
    )

    const result = sarif.runs[0].results[0]
    // Both fingerprints survive (no silent collapse to the last value).
    expect(result.partialFingerprints).toEqual({ v1: 'aaa', 'v1/1': 'bbb' })
    // Edit paths are URI-encoded just like the primary location.
    expect(result.properties.fixProposal.edits[0].path).toBe(
      'src/my%20folder/a%20file.ts'
    )
  })

  test('caps SARIF results deterministically', () => {
    const report = createReportFixture()
    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          admittedFindings: Array.from({ length: 3 }, (_, index) => ({
            ...report.admittedFindings[0]!,
            id: `find_${index}`,
            title: `Finding ${index}`,
            fingerprints: [
              {
                algorithm: 'v1',
                value: `${index}`
              }
            ]
          }))
        },
        {
          category: 'codereviewer',
          maxResults: 2,
          target: 'github'
        }
      )
    )

    expect(sarif.runs[0].results).toHaveLength(2)
  })
})
