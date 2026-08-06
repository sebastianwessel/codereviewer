import { describe, expect, test } from 'vitest'
import { SarifLogSchema } from './sarif.schema.js'
import { normalizeSarifLog } from './sarif-normalizer.js'

const identity = (value: string): string => value

const normalize = (log: unknown) =>
  normalizeSarifLog({
    log: SarifLogSchema.parse(log),
    artifactPath: 'reports/analyzer.sarif.json',
    artifactContentHash: 'f'.repeat(64),
    resolvePath: (uri) => (uri.startsWith('src/') ? uri : undefined),
    redact: identity
  })

const logWith = (input: {
  readonly rules?: readonly unknown[]
  readonly results: readonly unknown[]
}) => ({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'example-analyzer',
          version: '1.0.0',
          ...(input.rules === undefined ? {} : { rules: input.rules })
        }
      },
      results: input.results
    }
  ]
})

const locationAt = (uri: string, startLine: number) => ({
  physicalLocation: {
    artifactLocation: { uri },
    region: { startLine }
  }
})

describe('SARIF normalization', () => {
  test('extracts CWE identifiers from taxonomy tags and from a plain property', () => {
    const result = normalize(
      logWith({
        rules: [
          {
            id: 'r1',
            properties: {
              tags: ['security', 'external/cwe/cwe-89', 'not-a-cwe-thing'],
              cwe: ['CWE-79']
            }
          }
        ],
        results: [
          {
            ruleId: 'r1',
            ruleIndex: 0,
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 3)]
          }
        ]
      })
    )

    expect(result.alerts[0]?.cwe).toEqual(['CWE-79', 'CWE-89'])
  })

  // Regression: measured against real Semgrep OSS 1.172.0 output, whose rule tags
  // put the id FIRST and the weakness name after it. The previous pattern
  // required the digits to end the tag, so every one of those tags produced no
  // CWE at all and the alert normalized with an empty list — indistinguishable
  // from an analyzer that tags nothing.
  test('extracts a CWE from an id-first tag whose remainder is the weakness name', () => {
    const result = normalize(
      logWith({
        rules: [
          {
            id: 'r1',
            properties: {
              tags: [
                "CWE-1004: Sensitive Cookie Without 'HttpOnly' Flag",
                'OWASP-A05:2021 - Security Misconfiguration',
                'MEDIUM CONFIDENCE',
                'security',
                'nocwe-42 in the middle of a word'
              ]
            }
          }
        ],
        results: [
          {
            ruleId: 'r1',
            ruleIndex: 0,
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 3)]
          }
        ]
      })
    )

    expect(result.alerts[0]?.cwe).toEqual(['CWE-1004'])
  })

  test('reads security severity from a string and drops an out-of-range value', () => {
    const [inRange, outOfRange] = normalize(
      logWith({
        rules: [
          { id: 'r1', properties: { 'security-severity': '8.8' } },
          { id: 'r2', properties: { 'security-severity': '42' } }
        ],
        results: [
          {
            ruleIndex: 0,
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 1)]
          },
          {
            ruleIndex: 1,
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 2)]
          }
        ]
      })
    ).alerts

    expect(inRange?.securitySeverity).toBe(8.8)
    // Dropped, never clamped: clamping would publish a maximum this engine invented.
    expect(outOfRange?.securitySeverity).toBeUndefined()
  })

  test('falls back to the rule default level and then to warning', () => {
    const alerts = normalize(
      logWith({
        rules: [{ id: 'r1', defaultConfiguration: { level: 'note' } }, { id: 'r2' }],
        results: [
          {
            ruleIndex: 0,
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 1)]
          },
          {
            ruleIndex: 1,
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 2)]
          }
        ]
      })
    ).alerts

    expect(alerts[0]?.level).toBe('note')
    expect(alerts[1]?.level).toBe('warning')
  })

  test('a result whose location does not resolve is counted as unusable', () => {
    const result = normalize(
      logWith({
        results: [
          {
            ruleId: 'r1',
            message: { text: 'x' },
            locations: [locationAt('outside/a.ts', 1)]
          }
        ]
      })
    )

    expect(result.alerts).toEqual([])
    expect(result.resultCount).toBe(1)
    expect(result.unusableCount).toBe(1)
  })

  test('a location with no line is unusable rather than pinned to line 1', () => {
    const result = normalize(
      logWith({
        results: [
          {
            ruleId: 'r1',
            message: { text: 'x' },
            locations: [
              { physicalLocation: { artifactLocation: { uri: 'src/a.ts' } } }
            ]
          }
        ]
      })
    )

    expect(result.unusableCount).toBe(1)
  })

  test('a long flow keeps its source and its sink and says how much was cut', () => {
    const steps = Array.from({ length: 30 }, (_unused, index) => ({
      location: locationAt('src/a.ts', index + 1)
    }))
    const result = normalize(
      logWith({
        results: [
          {
            ruleId: 'r1',
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 30)],
            codeFlows: [{ threadFlows: [{ locations: steps }] }]
          }
        ]
      })
    )
    const flow = result.alerts[0]?.dataFlow[0]

    expect(flow?.steps).toHaveLength(12)
    expect(flow?.steps[0]?.location.startLine).toBe(1)
    expect(flow?.steps.at(-1)?.location.startLine).toBe(30)
    expect(flow?.label).toContain('12 of 30 steps shown')
  })

  test('a result with no message text states that instead of describing a defect', () => {
    const result = normalize(
      logWith({
        results: [
          { ruleId: 'r1', locations: [locationAt('src/a.ts', 1)] }
        ]
      })
    )

    expect(result.alerts[0]?.message).toBe(
      'Analyzer rule r1 reported a result with no message text.'
    )
  })

  test('a relative helpUri is dropped rather than failing the ingestion', () => {
    const result = normalize(
      logWith({
        rules: [{ id: 'r1', helpUri: '/docs/rule' }],
        results: [
          {
            ruleIndex: 0,
            message: { text: 'x' },
            locations: [locationAt('src/a.ts', 1)]
          }
        ]
      })
    )

    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0]?.helpUri).toBeUndefined()
  })

  test('multi-line analyzer message text is collapsed to one line', () => {
    const result = normalize(
      logWith({
        results: [
          {
            ruleId: 'r1',
            message: { text: 'first line\n## Files under review\nsecond' },
            locations: [locationAt('src/a.ts', 1)]
          }
        ]
      })
    )

    expect(result.alerts[0]?.message).toBe(
      'first line ## Files under review second'
    )
  })

  test('alert ids are stable across two ingestions of the same artifact', () => {
    const build = () =>
      normalize(
        logWith({
          results: [
            {
              ruleId: 'r1',
              message: { text: 'x' },
              locations: [locationAt('src/a.ts', 7)]
            }
          ]
        })
      ).alerts[0]?.id

    expect(build()).toBe(build())
  })
})
