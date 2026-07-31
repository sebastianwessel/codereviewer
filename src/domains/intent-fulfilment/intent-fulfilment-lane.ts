// Production wiring for the model lane: provider resolution, usage accounting,
// and the agents' lifetime.
//
// It exists so `intent check` stays a command — it parses arguments, supplies the
// mediated seams, and prints a report — and so `intent-fulfilment-run.ts` stays
// drivable with scripted runners, which every control test for this layer depends
// on.
//
// Nothing here can fail the run. A capability enabled with no provider, an
// unresolvable provider, or a provider missing object output all resolve to "no
// lane", and the run reports `provider-unavailable` with a warning and exits 0.
// Spec 23 requires absent or unusable intent to be reported plainly and exited
// successfully; a capability that cannot read the intent it did gather is the same
// situation from the reader's point of view.

import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import type { CitationAptnessRunner } from './aptness.js'
import {
  createProviderUsageRecorder,
  summarizeLaneUsage,
  type LaneUsage
} from '../costs/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../provider-resolution/index.js'
import type { FulfilmentExplanationRunner } from './explanation.js'
import { createHarnessIntentFulfilmentAgents } from './intent-fulfilment-agents.js'
import type { FulfilmentJudgementRunner } from './judgement.js'
import type { ObligationExtractionRunner } from './obligation-extraction.js'

export type IntentFulfilmentLane = {
  readonly extractObligations: ObligationExtractionRunner
  readonly judge: FulfilmentJudgementRunner
  readonly checkAptness: CitationAptnessRunner
  readonly explain: FulfilmentExplanationRunner
  // Read once, after the calls have finished. `undefined` when no call reported
  // any tokens, so a report never carries an all-zero usage block that reads as
  // "a provider ran and cost nothing".
  readonly usage: () => LaneUsage | undefined
  readonly shutdown: () => Promise<void>
}

/**
 * Creates the model lane, or `undefined` when it cannot run.
 */
export const createIntentFulfilmentLane = async (input: {
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport | undefined
  readonly logger?: Logger | undefined
}): Promise<IntentFulfilmentLane | undefined> => {
  // Checked first, because resolving a provider for a capability that is switched
  // off would import an adapter and check credentials for a run that returns the
  // disabled report.
  if (!input.config.intentFulfilment.enabled) {
    return undefined
  }

  const providerConfig = input.config.provider

  if (providerConfig === undefined) {
    input.logger?.warn?.(
      'Intent-fulfilment review is enabled but no model provider is configured.'
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
      'The intent-fulfilment provider could not be resolved; no obligations will be extracted.',
      { error_name: error instanceof Error ? error.name : 'unknown' }
    )

    return undefined
  }

  const usageRecorder = createProviderUsageRecorder(modelAlias)
  const agents = createHarnessIntentFulfilmentAgents({
    modelAlias: usageRecorder.modelAlias,
    ...(input.logger === undefined ? {} : { logger: input.logger })
  })

  return {
    extractObligations: agents.extractObligations,
    judge: agents.judge,
    checkAptness: agents.checkAptness,
    explain: agents.explain,
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
