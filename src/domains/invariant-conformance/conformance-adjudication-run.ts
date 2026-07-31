// Production wiring for the adjudicated arm: provider resolution, usage
// accounting, and the adjudicator's lifetime.
//
// It exists so the `conformance check` command stays a command — it parses
// arguments, supplies the mediated seams, and prints a report — and so
// `conformance-run.ts` stays drivable with a scripted adjudicator, which every
// control test for this layer depends on.
//
// Nothing here can fail the run. A capability configured for adjudication with no
// provider, an unresolvable provider, or a provider missing object output all
// resolve to "no lane", and the run falls back to spec 24's deterministic baseline
// arm with a warning in the report. That is spec 24's "Failure MUST be recoverable
// and MUST NOT affect the diff review" applied to its own most expensive step.

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
import { createHarnessConformanceAdjudicator } from './conformance-adjudication-agent.js'
import type { ConformanceAdjudicationRunner } from './conformance-adjudication.js'

export type ConformanceAdjudicationLane = {
  readonly adjudicate: ConformanceAdjudicationRunner
  // Read once, after the adjudication calls have finished. `undefined` when no
  // call reported any tokens, so a report never carries an all-zero usage block
  // that reads as "a provider ran and cost nothing".
  readonly usage: () => LaneUsage | undefined
  readonly shutdown: () => Promise<void>
}

/**
 * Creates the adjudication lane, or `undefined` when the adjudicated arm cannot
 * run.
 */
export const createConformanceAdjudicationLane = async (input: {
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport | undefined
  readonly logger?: Logger | undefined
}): Promise<ConformanceAdjudicationLane | undefined> => {
  // Both switches, because resolving a provider for a capability that is switched
  // off would import an adapter and check credentials for a run that returns the
  // disabled report.
  if (
    !input.config.invariantConformance.enabled ||
    !input.config.invariantConformance.adjudication.enabled
  ) {
    return undefined
  }

  const providerConfig = input.config.provider

  if (providerConfig === undefined) {
    input.logger?.warn?.(
      'Conformance adjudication is enabled but no model provider is configured; running the deterministic arm.'
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
      'The conformance adjudication provider could not be resolved; running the deterministic arm.',
      { error_name: error instanceof Error ? error.name : 'unknown' }
    )

    return undefined
  }

  const usageRecorder = createProviderUsageRecorder(modelAlias)
  const adjudicator = createHarnessConformanceAdjudicator({
    modelAlias: usageRecorder.modelAlias,
    ...(input.logger === undefined ? {} : { logger: input.logger })
  })

  return {
    adjudicate: adjudicator.adjudicate,
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
    shutdown: adjudicator.shutdown
  }
}
