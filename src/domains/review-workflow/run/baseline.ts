import { readFile } from 'node:fs/promises'
import type { Logger } from '@purista/harness'
import { resolveExistingPathInsideRoot } from '../../../platform/path-service.js'
import type { CodeReviewerConfig } from '../../../shared/contracts/index.js'
import {
  BaselineFileSchema,
  type BaselineFingerprintRecord
} from '../../admission/index.js'
import type { NoContentEventRecorder } from '../../observability/index.js'

export const loadBaselineFingerprints = async (
  repositoryRoot: string,
  config: CodeReviewerConfig
): Promise<readonly BaselineFingerprintRecord[] | undefined> => {
  if (!config.baseline.enabled) {
    return []
  }

  try {
    const baselineText = await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, config.baseline.path),
      'utf8'
    )

    return BaselineFileSchema.parse(JSON.parse(baselineText))
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }

    throw error
  }
}

export type ReviewRunnerBaselineInput = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly baselineExplicitlyConfigured?: boolean | undefined
  readonly observability?: NoContentEventRecorder | undefined
  readonly logger?: Logger | undefined
  readonly loadBaselineFingerprints?: typeof loadBaselineFingerprints | undefined
}

export type ReviewRunnerBaselineMetrics = {
  readonly baselineEntryCount: number
}

export type ReviewRunnerBaselineState = {
  readonly baselineFingerprints: readonly BaselineFingerprintRecord[] | undefined
  readonly baselineConfigured: boolean
  readonly metrics: ReviewRunnerBaselineMetrics
}

export const prepareReviewRunnerBaseline = async (
  input: ReviewRunnerBaselineInput
): Promise<ReviewRunnerBaselineState> => {
  const loadFingerprints =
    input.loadBaselineFingerprints ?? loadBaselineFingerprints
  const baselineStep = input.observability?.startStep('baseline_load')
  input.logger?.debug('Baseline load started.')
  const baselineFingerprints = await loadFingerprints(
    input.repositoryRoot,
    input.config
  )
  const metrics = {
    baselineEntryCount: baselineFingerprints?.length ?? 0
  }

  baselineStep?.end(metrics)
  input.logger?.debug('Baseline load completed.', {
    baseline_entry_count: metrics.baselineEntryCount
  })

  return {
    baselineFingerprints,
    baselineConfigured:
      input.config.baseline.enabled &&
      (input.baselineExplicitlyConfigured ?? false),
    metrics
  }
}
