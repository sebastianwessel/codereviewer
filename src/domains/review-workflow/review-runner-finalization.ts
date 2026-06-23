import {
  resolveBaselineFingerprints,
  type BaselineFingerprintRecord
} from '../admission/index.js'
import {
  summarizeRunCost,
  type RunCostSummary,
  type RunTokenUsage
} from '../costs/index.js'
import type { DriftFinding } from '../drift/index.js'
import type {
  AdmittedFinding,
  CodeReviewerConfig,
  FindingFingerprint
} from '../../shared/contracts/index.js'
import { driftWarningsFor } from './review-runner-drift.js'

export const prepareReviewRunFinalization = (
  input: {
    readonly config: CodeReviewerConfig
    readonly configWarnings?: readonly string[] | undefined
    readonly driftFindings: readonly DriftFinding[]
    readonly admissionWarnings: readonly string[]
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[] | undefined
    readonly providerUsage?: RunTokenUsage | undefined
  }
): {
  readonly runCost: RunCostSummary
  readonly warnings: readonly string[]
  readonly resolvedBaselineEntries: readonly FindingFingerprint[]
} => {
  const resolvedBaselineEntries = input.config.baseline.includeResolvedInReport
    ? resolveBaselineFingerprints(
        input.baselineFingerprints ?? [],
        input.admittedFindings
      )
    : []
  const runCost = summarizeRunCost({
    providerConfigured: input.config.provider !== undefined,
    ...(input.config.provider === undefined
      ? {}
      : {
          providerId: input.config.provider.id,
          modelName: input.config.provider.model
        }),
    prices: input.config.costs,
    ...(input.providerUsage === undefined ? {} : { usage: input.providerUsage })
  })
  const warnings = [
    ...(input.configWarnings ?? []),
    ...driftWarningsFor(input.driftFindings),
    ...input.admissionWarnings,
    ...runCost.warnings
  ]

  return {
    runCost,
    warnings,
    resolvedBaselineEntries
  }
}
