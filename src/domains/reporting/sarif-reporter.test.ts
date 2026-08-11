import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { renderSarifReport } from './index.js'
import {
  NO_MODEL_SEARCH_NOTIFICATION_ID,
  SARIF_INFORMATION_URI
} from './sarif-reporter.js'
import { validateSarifDocument } from './sarif-validation.js'
import { createReportFixture } from '../../shared/testing/report-fixture.js'

// A security finding carrying every field the SARIF reporter has to project:
// a stable rule id, CWE classification, a CVSS-like score, a help URL and a
// multi-line span.
const securityFinding = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => {
  const { fixProposal: _dropped, ...base } = createReportFixture()
    .admittedFindings[0]!

  return {
    ...base,
    category: 'security',
    severity: 'critical',
    title: 'User input reaches a SQL query unparameterized',
    description: 'The request query string is concatenated into the statement.',
    ruleId: 'security/sql-injection',
    cwe: ['CWE-89'],
    securitySeverity: 9.1,
    helpUri: 'https://cwe.mitre.org/data/definitions/89.html',
    location: {
      path: 'src/app.ts',
      startLine: 12,
      endLine: 20,
      side: 'new'
    },
    ...overrides
  }
}

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

  test('projects CWE, security severity and help URI onto the rule GitHub reads', () => {
    const report = createReportFixture()
    const sarif = JSON.parse(
      renderSarifReport(
        { ...report, admittedFindings: [securityFinding()] },
        { category: 'codereviewer', maxResults: 25, target: 'github' }
      )
    )

    const rule = sarif.runs[0].tool.driver.rules[0]

    expect(rule.helpUri).toBe('https://cwe.mitre.org/data/definitions/89.html')
    // GitHub only honours `security-severity` on rules tagged `security`, and
    // reads it as a STRING it bands (above 9.0 is critical).
    expect(rule.properties.tags).toEqual([
      'security',
      'external/cwe/cwe-89'
    ])
    expect(rule.properties['security-severity']).toBe('9.1')
    expect(typeof rule.properties['security-severity']).toBe('string')

    // The finding's own values stay exact on the result.
    const result = sarif.runs[0].results[0]

    expect(result.properties.cwe).toEqual(['CWE-89'])
    expect(result.properties.securitySeverity).toBe(9.1)
  })

  test('renders the whole line span a finding claims', () => {
    const report = createReportFixture()
    const sarif = JSON.parse(
      renderSarifReport(
        { ...report, admittedFindings: [securityFinding()] },
        { category: 'codereviewer', maxResults: 25, target: 'generic' }
      )
    )

    expect(
      sarif.runs[0].results[0].locations[0].physicalLocation.region
    ).toEqual({ startLine: 12, endLine: 20 })
  })

  test('omits security metadata and endLine when the finding carries none', () => {
    // The fixture finding is a `bug` with no CWE, no score, no help URL and a
    // single-line location, so every field above must be absent rather than
    // defaulted or synthesised from `severity`.
    const sarif = JSON.parse(
      renderSarifReport(createReportFixture(), {
        category: 'codereviewer',
        maxResults: 25,
        target: 'github'
      })
    )

    const rule = sarif.runs[0].tool.driver.rules[0]
    const result = sarif.runs[0].results[0]

    expect(rule.helpUri).toBeUndefined()
    expect(rule.properties).toBeUndefined()
    expect(result.properties.cwe).toBeUndefined()
    expect(result.properties.securitySeverity).toBeUndefined()
    expect(
      result.locations[0].physicalLocation.region.endLine
    ).toBeUndefined()
  })

  test('unions CWEs and keeps the highest score when findings share a rule', () => {
    const report = createReportFixture()
    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          admittedFindings: [
            securityFinding(),
            securityFinding({
              id: 'find_second',
              title: 'A second injection sink under the same rule',
              cwe: ['CWE-564'],
              securitySeverity: 4.2,
              helpUri: undefined,
              fingerprints: [{ algorithm: 'v1', value: 'second' }]
            })
          ]
        },
        { category: 'codereviewer', maxResults: 25, target: 'github' }
      )
    )

    expect(sarif.runs[0].tool.driver.rules).toHaveLength(1)

    const rule = sarif.runs[0].tool.driver.rules[0]

    expect(rule.properties.tags).toEqual([
      'security',
      'external/cwe/cwe-564',
      'external/cwe/cwe-89'
    ])
    // The maximum, never the last-seen: GitHub shows one severity per rule and
    // understating a security score is the direction that costs.
    expect(rule.properties['security-severity']).toBe('9.1')
    expect(rule.helpUri).toBe('https://cwe.mitre.org/data/definitions/89.html')
  })

  test('advertises the published home page as informationUri', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    )

    // The constant is not read from the manifest at runtime (the published
    // package ships `dist/` alone), so this is what stops the two drifting.
    expect(SARIF_INFORMATION_URI).toBe(manifest.homepage)

    const sarif = JSON.parse(
      renderSarifReport(createReportFixture(), {
        category: 'codereviewer',
        maxResults: 25,
        target: 'generic'
      })
    )

    expect(sarif.runs[0].tool.driver.informationUri).toBe(manifest.homepage)
    expect(JSON.stringify(sarif)).not.toContain('example.invalid')
  })

  test('caps SARIF results deterministically and says what the cap withheld', () => {
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

    // A result absent from a run reads as RESOLVED to a code-scanning consumer,
    // so the cut has to announce itself in SARIF's own channel rather than only
    // shortening the list.
    const invocation = sarif.runs[0].invocations[0]

    expect(invocation.executionSuccessful).toBe(true)

    const notification = invocation.toolExecutionNotifications[0]

    expect(notification.level).toBe('warning')
    expect(notification.message.text).toContain('1 of 3 findings are withheld')
    expect(notification.message.text).toContain(
      'reporting.sarif.maxResults is 2'
    )
    // The descriptor reference resolves against the driver instead of dangling.
    expect(sarif.runs[0].tool.driver.notifications).toEqual([
      expect.objectContaining({ id: notification.descriptor.id })
    ])
  })

  // An empty SARIF run is the strongest clean bill of health this project emits:
  // code scanning shows no alert at all, and nothing in the document says whether
  // anything was searched for. A run with the model-backed review switched off
  // has to say so in the one channel a consumer of this file reads.
  test('a run that performed no model search says so in the SARIF run itself', () => {
    const report = createReportFixture()
    const { provider: _provider, model: _model, ...run } = report.run
    const sarif = JSON.parse(
      renderSarifReport(
        {
          ...report,
          run: { ...run, modelSearch: 'not-performed' },
          admittedFindings: []
        },
        {
          category: 'codereviewer',
          maxResults: 25,
          target: 'github'
        }
      )
    )
    const notification =
      sarif.runs[0].invocations[0].toolExecutionNotifications[0]

    expect(notification.descriptor.id).toBe(NO_MODEL_SEARCH_NOTIFICATION_ID)
    expect(notification.message.text).toContain('no model search')
    expect(sarif.runs[0].tool.driver.notifications).toEqual([
      expect.objectContaining({ id: NO_MODEL_SEARCH_NOTIFICATION_ID })
    ])
  })

  test('emits no withheld-results notification when every finding is reported', () => {
    const sarif = JSON.parse(
      renderSarifReport(createReportFixture(), {
        category: 'codereviewer',
        maxResults: 25,
        target: 'github'
      })
    )

    // A notification on every run would train consumers to ignore it.
    expect(sarif.runs[0].invocations).toBeUndefined()
    expect(sarif.runs[0].tool.driver.notifications).toBeUndefined()
  })
})

// Spec 03 requires related locations and data flow to be mapped into SARIF
// locations and code flows. The reporter carried neither: it read only `cwe`,
// `securitySeverity`, `helpUri` and `ruleId` off a finding, so a taint trace that
// reached the finding contract stopped at `report.json`.
describe('related locations and code flows', () => {
  const withTrace = (report: ReturnType<typeof createReportFixture>) => ({
    ...report,
    admittedFindings: [
      securityFinding({
        relatedLocations: [
          {
            id: 'rel_sink',
            location: { path: 'src/db/query.ts', startLine: 30, side: 'new' },
            message: 'The statement is executed here.'
          }
        ],
        dataFlow: [
          {
            id: 'flow_taint',
            label: 'request query string to SQL statement',
            steps: [
              {
                id: 'step_source',
                location: { path: 'src/app.ts', startLine: 12, side: 'new' },
                message: 'Untrusted request field read.'
              },
              {
                id: 'step_sink',
                location: { path: 'src/db/query.ts', startLine: 30, side: 'new' },
                message: 'Concatenated into the statement.'
              }
            ]
          }
        ]
      })
    ]
  })

  test('projects both into the result', () => {
    const sarif = JSON.parse(
      renderSarifReport(withTrace(createReportFixture()), {
        category: 'codereviewer',
        maxResults: 50,
        target: 'github'
      })
    )
    const result = sarif.runs[0].results[0]

    expect(result.relatedLocations).toHaveLength(1)
    expect(
      result.relatedLocations[0].physicalLocation.artifactLocation.uri
    ).toBe('src/db/query.ts')
    expect(result.relatedLocations[0].message.text).toBe(
      'The statement is executed here.'
    )

    expect(result.codeFlows).toHaveLength(1)
    expect(result.codeFlows[0].message.text).toBe(
      'request query string to SQL statement'
    )

    const steps = result.codeFlows[0].threadFlows[0].locations

    expect(steps).toHaveLength(2)
    expect(steps[0].location.physicalLocation.region.startLine).toBe(12)
    expect(steps[1].location.physicalLocation.artifactLocation.uri).toBe(
      'src/db/query.ts'
    )
  })

  // Absent, not empty: an empty `codeFlows` array reads to a viewer as "a flow was
  // computed and it has no steps".
  test('omits both when the finding carries neither', () => {
    const sarif = JSON.parse(
      renderSarifReport(createReportFixture(), {
        category: 'codereviewer',
        maxResults: 50,
        target: 'github'
      })
    )

    expect(sarif.runs[0].results[0]).not.toHaveProperty('relatedLocations')
    expect(sarif.runs[0].results[0]).not.toHaveProperty('codeFlows')
  })

  test('redacts the messages a trace carries', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE'
    const sarif = renderSarifReport(
      {
        ...createReportFixture(),
        admittedFindings: [
          securityFinding({
            relatedLocations: [
              {
                id: 'rel_sink',
                location: {
                  path: 'src/db/query.ts',
                  startLine: 30,
                  side: 'new'
                },
                message: `Executed with ${secret}.`
              }
            ]
          })
        ]
      },
      { category: 'codereviewer', maxResults: 50, target: 'github' }
    )

    expect(sarif).not.toContain(secret)
    // Non-vacuous: the location is still rendered, with the rest of its message.
    expect(sarif).toContain('Executed with')
  })
})
