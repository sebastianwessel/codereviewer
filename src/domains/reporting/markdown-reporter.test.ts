import { describe, expect, test } from 'vitest'
import { renderMarkdownReport } from './index.js'
import { createReportFixture } from './reporting-fixture.js'

describe('Markdown reporter', () => {
  test('renders deterministic report sections and escapes user-controlled text', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      refutationResults: [
        {
          id: 'refute_abc123',
          candidateId: 'cand_abc123',
          verdict: 'proved',
          summary: 'No contradiction found.',
          evidenceIds: ['ev_diff1'],
          checks: [
            {
              kind: 'task-evidence',
              result: 'passed',
              summary: 'Evidence exists.',
              evidenceIds: ['ev_diff1']
            }
          ]
        }
      ],
      providerIssues: [
        {
          code: 'provider_error',
          stage: 'refutation-check',
          recovered: true,
          message: 'Provider failed once and the run continued.'
        }
      ],
      admittedFindings: [
        {
          ...report.admittedFindings[0]!,
          title: 'Bad | title <script>alert(1)</script>\n## Forged',
          description:
            'Leaked token sk-proj-abcdefghijklmnopqrstuvwxyz should not appear.\n![secret](https://example.invalid/x.png)'
        },
        {
          ...report.admittedFindings[0]!,
          id: 'find_artifact1',
          title: 'Support signal diagnostic',
          description: 'A deterministic support signal was preserved for audit.',
          proposedBy: 'typescript-support-signal',
          reporterEligibility: 'artifact-only',
          severity: 'medium'
        }
      ]
    })

    expect(rendered).toContain('# Review Report')
    expect(rendered).toContain('Suggested fix')
    expect(rendered).toContain('Return the computed value from the changed branch.')
    expect(rendered).toContain('Fix edits')
    expect(rendered).toContain('## Provider Issues')
    expect(rendered).toContain('provider_error')
    expect(rendered).toContain('## Artifact-only Findings')
    expect(rendered).toContain('find_artifact1')
    expect(rendered).toContain('## Refutation Results')
    expect(rendered).toContain('refute_abc123')
    expect(rendered).toContain('Refutation evidence: ev_diff1')
    expect(rendered).toContain(
      'Refutation check task-evidence: passed - Evidence exists. evidence: ev_diff1'
    )
    expect(rendered).toContain('src/app.ts:4-4')
    expect(rendered).toContain('return computedValue')
    expect(rendered).toContain(
      'Bad \\\\| title &lt;script&gt;alert\\(1\\)&lt;/script&gt; \\#\\# Forged'
    )
    expect(rendered).not.toContain('\n## Forged')
    expect(rendered).not.toContain('![secret]')
    expect(rendered).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz')
    expect(rendered).not.toContain('- medium: 1')
  })

  test('renders missing refutation evidence explicitly', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      refutationResults: [
        {
          id: 'refute_empty',
          candidateId: 'cand_empty',
          verdict: 'needs-more-evidence',
          summary: 'The refuter cited no decisive evidence.',
          evidenceIds: [],
          checks: [
            {
              kind: 'proof-review',
              result: 'unknown',
              summary: 'The proof review cited no evidence.',
              evidenceIds: []
            }
          ]
        }
      ]
    })

    expect(rendered).toContain('Refutation evidence: none cited')
    expect(rendered).toContain(
      'Refutation check proof-review: unknown - The proof review cited no evidence. evidence: none cited'
    )
  })
})
