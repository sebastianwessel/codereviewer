import { describe, expect, test } from 'vitest'
import { createReportFixture } from './reporting-fixture.js'
import { renderGithubReviewComments } from './github-review-comments.js'

describe('GitHub review comment renderer', () => {
  test('renders inline new-side findings with a safe single-edit suggestion', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const comments = renderGithubReviewComments({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: {
            path: 'src/app.ts',
            startLine: 12,
            endLine: 13,
            side: 'new'
          },
          fixProposal: {
            summary: 'Guard the nullable order before reading items.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                replacement:
                  'if (order === null) {\n  return []\n}\nreturn order.items',
                description: 'Handle the missing order case explicitly.'
              }
            ]
          }
        }
      ]
    })

    expect(JSON.parse(comments)).toEqual([
      {
        path: 'src/app.ts',
        line: 13,
        side: 'RIGHT',
        startLine: 12,
        startSide: 'RIGHT',
        findingId: finding.id,
        severity: finding.severity,
        category: finding.category,
        body: expect.stringContaining('```suggestion')
      }
    ])
    expect(comments).toContain('Guard the nullable order')
  })

  test('skips summary-only findings and unsafe multi-edit suggestions', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const comments = renderGithubReviewComments({
      ...report,
      admittedFindings: [
        {
          ...finding,
          id: 'find_summary1',
          reporterEligibility: 'summary-only'
        },
        {
          ...finding,
          id: 'find_old1',
          reporterEligibility: 'inline',
          location: {
            path: 'src/app.ts',
            startLine: 10,
            side: 'old'
          }
        },
        {
          ...finding,
          id: 'find_multi1',
          reporterEligibility: 'inline',
          fixProposal: {
            summary: 'Two edits need human review.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: finding.location.path,
                startLine: finding.location.startLine,
                endLine: finding.location.startLine,
                replacement: 'first'
              },
              {
                path: finding.location.path,
                startLine: finding.location.startLine + 1,
                endLine: finding.location.startLine + 1,
                replacement: 'second'
              }
            ]
          }
        }
      ]
    })

    const parsed = JSON.parse(comments)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].findingId).toBe('find_multi1')
    expect(parsed[0].body).not.toContain('```suggestion')
  })

  test('escapes Markdown in the body and drops fence-breaking suggestions', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const comments = renderGithubReviewComments({
      ...report,
      admittedFindings: [
        {
          ...finding,
          title: 'Bug ```injected``` [x](javascript:alert(1))',
          description: 'See ```suggestion\nmalicious()\n``` here.',
          location: {
            path: 'src/app.ts',
            startLine: 12,
            endLine: 13,
            side: 'new'
          },
          fixProposal: {
            summary: 'Fix it.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                // Replacement contains a code fence -> suggestion must be dropped.
                replacement: 'const x = `template`\n```\nbreakout'
              }
            ]
          }
        }
      ]
    })

    const body = JSON.parse(comments)[0].body as string
    // No raw code fence survives: injected fences are escaped and the
    // fence-breaking suggestion replacement is dropped entirely.
    expect(body).not.toContain('```')
    // Link/markup metacharacters in untrusted text are escaped, not rendered.
    expect(body).not.toContain('](javascript:')
  })
})
