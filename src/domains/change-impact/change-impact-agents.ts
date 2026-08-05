// The one change-impact harness agent. NO TOOLS, one step.
//
// The absence of tools is a requirement, not an economy. Spec 22 forbids unbounded
// repository search — "added context measured net-negative here twice" — and this
// call is handed exactly the sites the bounded, diff-seeded search already located.
// `builtinTools: false` keeps the harness sandbox tools off the agent and
// `maxSteps: 1` leaves no second turn in which a tool could be requested.
//
// SEPARATE SESSION PER CALL. Each pair is judged on its own. Sharing a session
// would let one dependent's verdict prime the next, and a conversation carrying six
// previous "relies" answers is a reason to give a seventh — on a task whose correct
// answer is "does-not-rely" for roughly nine dependents in ten.
//
// Telemetry is NO_CONTENT: the packets carry source lines and repository paths, and
// none of it belongs in a log by default.

import { defineHarness, type Logger, type ModelAlias } from '@purista/harness'
import { createNoopReviewLogger } from '../observability/index.js'
import { modelRelianceJudgementInstructions } from './instructions.js'
import {
  ModelRelianceJudgementSchema,
  RelianceJudgementInputSchema,
  normalizeRelianceJudgement,
  type RelianceJudgementRunner
} from './reliance-judgement.js'

const buildChangeImpactHarness = (input: {
  readonly modelAlias: ModelAlias
  readonly logger: Logger
}) =>
  defineHarness({ name: 'codereviewer-change-impact' })
    .logger(input.logger)
    // NO FORWARDED CONVERSATION, STATED RATHER THAN INHERITED. The harness treats
    // an absent `historyWindow` as "keep ALL history". Today no history reaches
    // this agent anyway, because `nextSessionId` opens a fresh session per call —
    // but that makes the guarantee an accident of a counter rather than a setting,
    // and reusing one session (an obvious future economy) would silently restore
    // the priming the per-call session exists to prevent.
    .defaults({ historyWindow: 0 })
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .models({ impact: input.modelAlias })
    .agents(({ agent }) => ({
      judge_reliance: agent({
        model: 'impact',
        input: RelianceJudgementInputSchema,
        output: ModelRelianceJudgementSchema,
        builtinTools: false,
        maxSteps: 1,
        instructions: modelRelianceJudgementInstructions
      })
    }))
    .build()

export type HarnessChangeImpactAgents = {
  readonly judgeReliance: RelianceJudgementRunner
  readonly shutdown: () => Promise<void>
}

/**
 * Wires the agent into the seam the run consumes.
 *
 * Token usage accumulates in the usage-recorder-wrapped `modelAlias` the caller
 * passes, so this runner reports no per-call usage of its own.
 */
export const createHarnessChangeImpactAgents = (input: {
  readonly modelAlias: ModelAlias
  readonly logger?: Logger | undefined
}): HarnessChangeImpactAgents => {
  const harness = buildChangeImpactHarness({
    modelAlias: input.modelAlias,
    logger: input.logger ?? createNoopReviewLogger()
  })
  let sessionSeq = 0

  const judgeReliance: RelianceJudgementRunner = async (
    judgementInput,
    signal
  ) => {
    sessionSeq += 1

    const session = await harness.getSession(
      `change-impact-reliance-${sessionSeq}`
    )

    try {
      return normalizeRelianceJudgement(
        await session.agents.judge_reliance.prompt(
          judgementInput,
          signal === undefined ? {} : { signal }
        )
      )
    } finally {
      await session.close()
    }
  }

  return {
    judgeReliance,
    shutdown: async () => {
      await harness.shutdown()
    }
  }
}
