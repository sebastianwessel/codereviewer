import { describe, expect, test } from 'vitest'
import { ReviewReportSchema } from '../../shared/contracts/index.js'
import {
  createReportArtifact,
  renderJsonReport,
  writeReportingArtifacts
} from './index.js'
import { createReportFixture } from './reporting-fixture.js'

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
})
