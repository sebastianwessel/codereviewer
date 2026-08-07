import { describe, expect, test } from 'vitest'
import { ReviewReportSchema } from '../../shared/contracts/index.js'
import {
  createReportArtifact,
  renderJsonReport,
  writeReportingArtifacts
} from './index.js'
import { createReportFixture } from '../../shared/testing/report-fixture.js'

describe('JSON reporter', () => {
  test('renders canonical JSON that validates against the report schema', () => {
    const rendered = renderJsonReport(createReportFixture())
    const parsed = ReviewReportSchema.parse(JSON.parse(rendered))

    expect(parsed.schemaVersion).toBe('1.0')
    expect(rendered.endsWith('\n')).toBe(true)
  })

  test('redacts sensitive text in canonical JSON output', () => {
    const report = createReportFixture()
    const rendered = renderJsonReport({
      ...report,
      admittedFindings: [
        {
          ...report.admittedFindings[0]!,
          title: 'Leaked sk-proj-abcdefghijklmnopqrstuvwxyz123456',
          description: 'Authorization: Bearer very-secret-token-value'
        }
      ],
      evidence: [
        {
          ...report.evidence[0]!,
          summary: 'Token sk-proj-abcdefghijklmnopqrstuvwxyz123456'
        }
      ]
    })

    expect(rendered).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(rendered).not.toContain('very-secret-token-value')
    expect(rendered).toContain('[REDACTED]')
    expect(() => ReviewReportSchema.parse(JSON.parse(rendered))).not.toThrow()
  })

  // Spec 29. The JSON report is the machine-readable contract, so the signal has
  // to arrive there whole rather than only in the rendered Markdown.
  test('carries the test-adequacy signal through to the JSON contract', () => {
    const testAdequacy = {
      consideredFileCount: 2,
      pairedFileCount: 1,
      unpairedPaths: ['src/alpha.ts'],
      changedTestFileCount: 1,
      unknown: { unsupportedLanguageFileCount: 2, notAnalysedFileCount: 0 }
    }
    const rendered = renderJsonReport({
      ...createReportFixture(),
      testAdequacy
    })

    expect(ReviewReportSchema.parse(JSON.parse(rendered)).testAdequacy).toEqual(
      testAdequacy
    )
  })

  // Spec 29. SARIF is a DEFECT interchange format and review comments are inline
  // annotations on a diff; the signal is neither a defect nor tied to a line, and a
  // reviewer must never receive it as one. Asserted over the artifacts the writer
  // actually produces rather than trusted to the renderers.
  test('the test-adequacy signal reaches neither SARIF nor the review-comment drafts', async () => {
    const writes = new Map<string, string>()
    await writeReportingArtifacts({
      report: {
        ...createReportFixture(),
        testAdequacy: {
          consideredFileCount: 1,
          pairedFileCount: 0,
          unpairedPaths: ['src/untested-by-this-change.ts'],
          changedTestFileCount: 0,
          unknown: { unsupportedLanguageFileCount: 0, notAnalysedFileCount: 0 }
        }
      },
      formats: ['json', 'sarif'],
      reviewComments: { platform: 'github' },
      writer: async (artifactPath, content) => {
        writes.set(artifactPath, content)
      }
    })

    for (const artifactPath of [
      'report.sarif',
      'review-comments.json',
      'review-comments.github.json'
    ]) {
      expect(writes.get(artifactPath)).not.toContain(
        'src/untested-by-this-change.ts'
      )
      expect(writes.get(artifactPath)).not.toContain('testAdequacy')
    }

    // And it is present where it belongs.
    expect(writes.get('report.json')).toContain('testAdequacy')
  })

  test('creates deterministic artifact records with hashes', () => {
    const artifact = createReportArtifact('json', 'report.json', '{"ok":true}\n')

    expect(artifact).toEqual({
      format: 'json',
      path: 'report.json',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      containsSensitiveContent: false
    })
  })

  test('surfaces artifact write failures', async () => {
    await expect(
      writeReportingArtifacts({
        report: createReportFixture(),
        writer: async () => {
          throw new Error('disk full')
        }
      })
    ).rejects.toMatchObject({
      code: 'report_error',
      category: 'report',
      exitCode: 5
    })
  })

  test('writes neutral and rendered review-comment artifacts when enabled', async () => {
    const writes = new Map<string, string>()
    const artifacts = await writeReportingArtifacts({
      report: createReportFixture(),
      formats: ['json'],
      reviewComments: { platform: 'github' },
      writer: async (artifactPath, content) => {
        writes.set(artifactPath, content)
      }
    })

    // Both review-comment files record under the `json` report format.
    expect(artifacts.map((artifact) => artifact.artifact.format)).toEqual([
      'json',
      'json',
      'json'
    ])
    expect(artifacts.map((artifact) => artifact.artifact.path)).toEqual([
      'report.json',
      'review-comments.json',
      'review-comments.github.json'
    ])

    expect(writes.has('review-comments.json')).toBe(true)
    expect(JSON.parse(writes.get('review-comments.json') ?? '[]')).toEqual([
      expect.objectContaining({
        path: 'src/app.ts',
        targetRange: { startLine: 4, endLine: 4 },
        findingId: 'find_abc123',
        suggestion: { replacement: 'return computedValue' }
      })
    ])

    expect(JSON.parse(writes.get('review-comments.github.json') ?? '[]')).toEqual([
      expect.objectContaining({
        path: 'src/app.ts',
        line: 4,
        side: 'RIGHT',
        findingId: 'find_abc123'
      })
    ])
  })
})
