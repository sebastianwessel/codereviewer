// The `adjudicate_conformance` harness agent (spec 24, design step 4). One session
// per divergence, one step, NO TOOLS.
//
// The absence of tools is the requirement, not an economy. Spec 24: "The model MUST
// receive a divergence to judge, never a repository to search. Unbounded search is
// forbidden — it measured net-negative here twice." So there is no `.tools(...)`
// call on this harness at all, `builtinTools: false` keeps the harness's own
// sandbox tools (`read`/`list`/`grep`/...) off the agent, and `maxSteps: 1` leaves
// no second turn in which a tool could be requested. Three independent reasons the
// same thing cannot happen, because "we did not attach one" is not a property a
// future edit preserves on its own.
//
// The pattern is `verification/investigate-claim-agent.ts`, reused deliberately
// rather than extracted into a shared factory: that agent is a bounded tool LOOP
// over a mediated repository and this one is a single tool-free judgement, so a
// shared factory would have to be configurable in exactly the dimension that makes
// this agent safe.
//
// The packet is untrusted data, and the instructions say so. Telemetry is
// NO_CONTENT: the packet carries declaration names, paths and call symbols, and
// none of it belongs in a log by default.

import { defineHarness, type Logger, type ModelAlias } from '@purista/harness'
import { createNoopReviewLogger } from '../observability/index.js'
import { modelConformanceAdjudicationInstructions } from './adjudication-instructions.js'
import {
  ConformanceAdjudicationInputSchema,
  ModelConformanceAdjudicationSchema,
  normalizeConformanceAdjudication,
  type ConformanceAdjudicationRunner
} from './conformance-adjudication.js'

const buildConformanceAdjudicationHarness = (input: {
  readonly modelAlias: ModelAlias
  readonly logger: Logger
}) =>
  defineHarness({ name: 'codereviewer-conformance-adjudication' })
    .logger(input.logger)
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .models({ adjudicator: input.modelAlias })
    .agents(({ agent }) => ({
      adjudicate_conformance: agent({
        model: 'adjudicator',
        input: ConformanceAdjudicationInputSchema,
        output: ModelConformanceAdjudicationSchema,
        builtinTools: false,
        maxSteps: 1,
        instructions: modelConformanceAdjudicationInstructions
      })
    }))
    .build()

export type HarnessConformanceAdjudicator = {
  readonly adjudicate: ConformanceAdjudicationRunner
  readonly shutdown: () => Promise<void>
}

/**
 * Wires the agent into the `ConformanceAdjudicationRunner` seam the run consumes.
 *
 * Each divergence runs in its own session, so no call opens holding the packet or
 * the answer of the one before it: a verdict must follow from the divergence in
 * front of the model, and a conversation carrying eleven previous "convention"
 * answers is a reason to give a twelfth.
 *
 * Token usage accumulates in the usage-recorder-wrapped `modelAlias` the caller
 * passes, exactly as the investigation agent does, so this adjudicator reports no
 * per-call usage of its own.
 */
export const createHarnessConformanceAdjudicator = (input: {
  readonly modelAlias: ModelAlias
  readonly logger?: Logger | undefined
}): HarnessConformanceAdjudicator => {
  const harness = buildConformanceAdjudicationHarness({
    modelAlias: input.modelAlias,
    logger: input.logger ?? createNoopReviewLogger()
  })
  let sessionSeq = 0

  const adjudicate: ConformanceAdjudicationRunner = async (
    adjudicationInput,
    signal
  ) => {
    const sessionId = `conformance-adjudication-${sessionSeq}`
    sessionSeq += 1

    const session = await harness.getSession(sessionId)

    try {
      // Normalized here rather than by the caller so every consumer of this seam
      // gets the same one-way valve: only an explicit `convention` with a reason
      // survives, and everything else is `undetermined`.
      return normalizeConformanceAdjudication(
        await session.agents.adjudicate_conformance.prompt(
          adjudicationInput,
          signal === undefined ? {} : { signal }
        )
      )
    } finally {
      await session.close()
    }
  }

  return {
    adjudicate,
    shutdown: async () => {
      await harness.shutdown()
    }
  }
}
