import { type ContextRequest } from '../../shared/contracts/index.js'
import { type FindingJudgeOutput } from './model-agent-contracts.js'

export type JudgeFollowUpOutputState = {
  readonly challengeQuestions: readonly string[]
  readonly contextRequests: readonly ContextRequest[]
  readonly requestedContext: readonly string[]
}

export const judgeFollowUpOutputStateWithResult = (
  input: {
    readonly state: JudgeFollowUpOutputState
    readonly output: FindingJudgeOutput
  }
): JudgeFollowUpOutputState => ({
  challengeQuestions: [
    ...new Set([
      ...input.state.challengeQuestions,
      ...input.output.challengeQuestions
    ])
  ],
  contextRequests: [
    ...input.state.contextRequests,
    ...input.output.contextRequests
  ],
  requestedContext: [
    ...new Set([
      ...input.state.requestedContext,
      ...input.output.requestedContext
    ])
  ]
})
