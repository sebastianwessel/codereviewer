// The three intent-fulfilment harness agents. NO TOOLS, one step each.
//
// THREE AGENTS, NOT ONE. Spec 23: "Judgement, explanation, and any suggested
// follow-up MUST NOT share one model call. The measured over-rejection above is
// specifically what happens when they do." Distinct agents with distinct output
// schemas is how that is made structural rather than remembered — the judgement
// agent's schema (`ModelFulfilmentJudgementSchema`) has no field an explanation
// could be written into, and the explanation agent's has no field a status could.
//
// SEPARATE SESSIONS, NOT JUST SEPARATE AGENTS. Each call below opens its own
// session. Sharing one would put the judgement and its explanation in a single
// conversation, which is the mechanism the split exists to break: a model that has
// just written a justification is answering with it in context. It also stops one
// obligation's verdict from priming the next.
//
// The absence of tools is a requirement, not an economy. This capability judges a
// change it was handed; it does not search a repository. `builtinTools: false`
// keeps the harness sandbox tools off the agents and `maxSteps: 1` leaves no
// second turn in which a tool could be requested.
//
// Telemetry is NO_CONTENT: the packets carry ticket text, source lines and paths,
// and none of it belongs in a log by default.
//
// No suggested-follow-up agent exists. Spec 23 permits one only if it does not
// share a call with judgement; the cheapest way to satisfy that is not to have one.

import { defineHarness, type Logger, type ModelAlias } from '@purista/harness'
import { createNoopReviewLogger } from '../observability/index.js'
import {
  FulfilmentExplanationInputSchema,
  ModelFulfilmentExplanationSchema,
  normalizeFulfilmentExplanation,
  type FulfilmentExplanationRunner
} from './explanation.js'
import {
  modelFulfilmentExplanationInstructions,
  modelFulfilmentJudgementInstructions,
  modelObligationExtractionInstructions
} from './instructions.js'
import {
  FulfilmentJudgementInputSchema,
  ModelFulfilmentJudgementSchema,
  normalizeFulfilmentJudgement,
  type FulfilmentJudgementRunner
} from './judgement.js'
import {
  ModelObligationExtractionSchema,
  ObligationExtractionInputSchema,
  normalizeObligationExtraction,
  type ObligationExtractionRunner
} from './obligation-extraction.js'

const buildIntentFulfilmentHarness = (input: {
  readonly modelAlias: ModelAlias
  readonly logger: Logger
}) =>
  defineHarness({ name: 'codereviewer-intent-fulfilment' })
    .logger(input.logger)
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .models({ intent: input.modelAlias })
    .agents(({ agent }) => ({
      extract_obligations: agent({
        model: 'intent',
        input: ObligationExtractionInputSchema,
        output: ModelObligationExtractionSchema,
        builtinTools: false,
        maxSteps: 1,
        instructions: modelObligationExtractionInstructions
      }),
      judge_obligation: agent({
        model: 'intent',
        input: FulfilmentJudgementInputSchema,
        output: ModelFulfilmentJudgementSchema,
        builtinTools: false,
        maxSteps: 1,
        instructions: modelFulfilmentJudgementInstructions
      }),
      explain_fulfilment: agent({
        model: 'intent',
        input: FulfilmentExplanationInputSchema,
        output: ModelFulfilmentExplanationSchema,
        builtinTools: false,
        maxSteps: 1,
        instructions: modelFulfilmentExplanationInstructions
      })
    }))
    .build()

export type HarnessIntentFulfilmentAgents = {
  readonly extractObligations: ObligationExtractionRunner
  readonly judge: FulfilmentJudgementRunner
  readonly explain: FulfilmentExplanationRunner
  readonly shutdown: () => Promise<void>
}

/**
 * Wires the three agents into the seams the run consumes.
 *
 * Token usage accumulates in the usage-recorder-wrapped `modelAlias` the caller
 * passes, so these runners report no per-call usage of their own.
 */
export const createHarnessIntentFulfilmentAgents = (input: {
  readonly modelAlias: ModelAlias
  readonly logger?: Logger | undefined
}): HarnessIntentFulfilmentAgents => {
  const harness = buildIntentFulfilmentHarness({
    modelAlias: input.modelAlias,
    logger: input.logger ?? createNoopReviewLogger()
  })
  let sessionSeq = 0

  const nextSessionId = (kind: string): string => {
    sessionSeq += 1

    return `intent-fulfilment-${kind}-${sessionSeq}`
  }

  const extractObligations: ObligationExtractionRunner = async (
    extractionInput,
    signal
  ) => {
    const session = await harness.getSession(nextSessionId('extract'))

    try {
      return [
        ...normalizeObligationExtraction(
          await session.agents.extract_obligations.prompt(
            extractionInput,
            signal === undefined ? {} : { signal }
          )
        )
      ]
    } finally {
      await session.close()
    }
  }

  const judge: FulfilmentJudgementRunner = async (judgementInput, signal) => {
    const session = await harness.getSession(nextSessionId('judge'))

    try {
      return normalizeFulfilmentJudgement(
        await session.agents.judge_obligation.prompt(
          judgementInput,
          signal === undefined ? {} : { signal }
        )
      )
    } finally {
      await session.close()
    }
  }

  const explain: FulfilmentExplanationRunner = async (
    explanationInput,
    signal
  ) => {
    const session = await harness.getSession(nextSessionId('explain'))

    try {
      return normalizeFulfilmentExplanation(
        await session.agents.explain_fulfilment.prompt(
          explanationInput,
          signal === undefined ? {} : { signal }
        )
      )
    } finally {
      await session.close()
    }
  }

  return {
    extractObligations,
    judge,
    explain,
    shutdown: async () => {
      await harness.shutdown()
    }
  }
}
