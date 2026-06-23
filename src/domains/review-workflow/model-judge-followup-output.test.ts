import { describe, expect, test } from 'vitest'
import { type ContextRequest } from '../../shared/contracts/index.js'
import { type FindingJudgeOutput } from './model-agent-contracts.js'
import { judgeFollowUpOutputStateWithResult } from './model-judge-followup-output.js'

const contextRequest = (
  path: string,
  query: string
): ContextRequest => ({
  tool: 'grep',
  path,
  query,
  reason: `Check ${query}.`
})

const judgeOutput = (): FindingJudgeOutput => ({
  verdict: 'needs-more-evidence',
  summary: 'The judge needs more context.',
  challengeQuestions: [
    'Can the caller reach this branch?',
    'Does the fallback preserve state?'
  ],
  verificationChecks: [],
  evidenceIds: [],
  contextRequests: [contextRequest('src/app.ts', 'fallback')],
  requestedContext: ['caller path', 'shared helper']
})

describe('model judge follow-up output', () => {
  test('dedupes questions and requested context while preserving request order', () => {
    const existingRequest = contextRequest('src/service.ts', 'call site')
    const nextOutput = judgeOutput()

    expect(
      judgeFollowUpOutputStateWithResult({
        state: {
          challengeQuestions: ['Can the caller reach this branch?'],
          contextRequests: [existingRequest],
          requestedContext: ['caller path']
        },
        output: nextOutput
      })
    ).toEqual({
      challengeQuestions: [
        'Can the caller reach this branch?',
        'Does the fallback preserve state?'
      ],
      contextRequests: [existingRequest, ...nextOutput.contextRequests],
      requestedContext: ['caller path', 'shared helper']
    })
  })
})
