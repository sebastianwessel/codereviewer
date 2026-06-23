import { describe, expect, test } from 'vitest'
import { providerIssueForError } from './model-provider-issues.js'

describe('model provider issues', () => {
  test('normalizes provider errors into report-safe provider issues', () => {
    const issue = providerIssueForError({
      error: new Error(`timeout while calling model ${'x'.repeat(600)}`),
      stage: 'judge-finding',
      recovered: true
    })

    expect(issue).toEqual({
      code: 'provider_timeout',
      stage: 'judge-finding',
      recovered: true,
      message: expect.stringContaining('timeout while calling model')
    })
    expect(issue.message).toBeDefined()
    expect(issue.message?.length).toBeLessThanOrEqual(500)
  })
})
