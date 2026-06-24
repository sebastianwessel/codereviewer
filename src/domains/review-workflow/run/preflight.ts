import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../../shared/contracts/index.js'
import {
  configureOpenTelemetry as defaultConfigureOpenTelemetry,
  type NoContentEventRecorder
} from '../../observability/index.js'
import {
  runDriftCheck as defaultRunDriftCheck,
  type DriftCheckResult
} from '../../drift/index.js'
import { createDriftGateError } from './drift.js'

export const runReviewRunnerPreflight = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly observability: NoContentEventRecorder
    readonly logger: Pick<Logger, 'debug'>
    readonly runDriftCheck?: (
      options: {
        readonly repositoryRoot: string
        readonly config: CodeReviewerConfig
      }
    ) => Promise<DriftCheckResult>
    readonly configureOpenTelemetry?: typeof defaultConfigureOpenTelemetry
  }
): Promise<{
  readonly drift: DriftCheckResult
}> => {
  const runDriftCheck = input.runDriftCheck ?? defaultRunDriftCheck
  const configureOpenTelemetry =
    input.configureOpenTelemetry ?? defaultConfigureOpenTelemetry
  const driftStep = input.observability.startStep('drift_check')

  input.logger.debug('Drift check started.')
  const drift = await runDriftCheck({
    repositoryRoot: input.repositoryRoot,
    config: input.config
  })

  driftStep.end({
    passed: drift.passed,
    errorCount: drift.errorCount,
    warningCount: drift.warningCount
  })
  input.logger.debug('Drift check completed.', {
    passed: drift.passed,
    error_count: drift.errorCount,
    warning_count: drift.warningCount
  })

  if (!drift.passed) {
    throw createDriftGateError(drift)
  }

  if (input.config.observability.openTelemetry.enabled) {
    const telemetryStep = input.observability.startStep('opentelemetry_setup')

    input.logger.debug('OpenTelemetry setup started.')
    await configureOpenTelemetry({
      config: input.config.observability.openTelemetry
    })
    telemetryStep.end({ enabled: true })
    input.logger.debug('OpenTelemetry setup completed.', { enabled: true })
  }

  return { drift }
}
