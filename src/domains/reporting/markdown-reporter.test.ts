import { describe, expect, test } from 'vitest'
import { renderMarkdownReport } from './index.js'
import { createReportFixture } from './reporting-fixture.js'

describe('Markdown reporter', () => {
  test('renders deterministic report sections and escapes user-controlled text', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      admittedFindings: [
        {
          ...report.admittedFindings[0]!,
          title: 'Bad | title <script>alert(1)</script>\n## Forged',
          description:
            'Leaked token sk-proj-abcdefghijklmnopqrstuvwxyz should not appear.\n![secret](https://example.invalid/x.png)'
        }
      ]
    })

    expect(rendered).toContain('# Review Report')
    expect(rendered).toContain('Suggested fix')
    expect(rendered).toContain('Return the computed value from the changed branch.')
    expect(rendered).toContain('Fix edits')
    expect(rendered).toContain('src/app.ts:4-4')
    expect(rendered).toContain('return computedValue')
    expect(rendered).toContain(
      'Bad \\\\| title &lt;script&gt;alert\\(1\\)&lt;/script&gt; \\#\\# Forged'
    )
    expect(rendered).not.toContain('\n## Forged')
    expect(rendered).not.toContain('![secret]')
    expect(rendered).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz')
    expect(rendered).toMatchSnapshot()
  })
})
