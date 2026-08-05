// Production wiring for the adjudication model lane: provider resolution, usage
// accounting, and the agent's lifetime.
//
// It exists so `impact check` stays a command — it parses arguments, supplies the
// mediated seams, and prints a report — and so `impact-run.ts` stays drivable with
// a scripted runner, which every hermetic test for this layer depends on.
//
// NOTHING HERE CAN FAIL THE RUN. Spec 22: "Failure MUST be recoverable: a failed
// impact review does not fail the pipeline or the diff review." Adjudication
// disabled, no provider configured, an unresolvable provider, or a provider missing
// object output all resolve to "no lane". The run then reports
// `adjudicationStatus: "no-model"`, emits the findings the deterministic tier
// produced, counts the residue as unadjudicated, and exits 0.

import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import {
  createProviderUsageRecorder,
  summarizeLaneUsage,
  type LaneUsage
} from '../costs/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../provider-resolution/index.js'
import { createHarnessChangeImpactAgents } from './change-impact-agents.js'
import type { RelianceJudgementRunner } from './reliance-judgement.js'

export type ChangeImpactLane = {
  readonly judgeReliance: RelianceJudgementRunner
  // Read once, after the calls have finished. `undefined` when no call reported
  // any tokens, so a report never carries an all-zero usage block that reads as
  // "a provider ran and cost nothing".
  readonly usage: () => LaneUsage | undefined
  readonly shutdown: () => Promise<void>
}

/**
 * Creates the adjudication lane, or `undefined` when it cannot run.
 */
export const createChangeImpactLane = async (input: {
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport | undefined
  readonly logger?: Logger | undefined
}): Promise<ChangeImpactLane | undefined> => {
  // Both switches are checked before a provider is resolved, so a capability that
  // is switched off never imports an adapter or checks credentials. Adjudication
  // has its own switch because it is the only part of this command that spends:
  // turning `changeImpact.enabled` on must not silently start billing a user who
  // asked for the deterministic reference list.
  if (
    !input.config.changeImpact.enabled ||
    !input.config.changeImpact.adjudication.enabled
  ) {
    return undefined
  }

  const providerConfig = input.config.provider

  if (providerConfig === undefined) {
    input.logger?.warn?.(
      'Change-impact adjudication is enabled but no model provider is configured.'
    )

    return undefined
  }

  let modelAlias

  try {
    const resolved = await resolveProviderModelAlias({
      provider: providerConfig,
      environment: input.environment,
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      ...(input.providerImport === undefined
        ? {}
        : { importProvider: input.providerImport })
    })
    modelAlias = resolved.modelAlias
  } catch (error) {
    input.logger?.warn?.(
      'The change-impact provider could not be resolved; dependents needing a model will be reported as unadjudicated.',
      { error_name: error instanceof Error ? error.name : 'unknown' }
    )

    return undefined
  }

  const usageRecorder = createProviderUsageRecorder(modelAlias)
  const agents = createHarnessChangeImpactAgents({
    modelAlias: usageRecorder.modelAlias,
    ...(input.logger === undefined ? {} : { logger: input.logger })
  })

  return {
    judgeReliance: agents.judgeReliance,
    usage: () => {
      const usage = usageRecorder.usage()

      if (usage.inputTokens === 0 && usage.outputTokens === 0) {
        return undefined
      }

      return summarizeLaneUsage({
        usage,
        providerId: providerConfig.id,
        modelName: providerConfig.model,
        prices: input.config.costs
      })
    },
    shutdown: agents.shutdown
  }
}
