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
    readonly logger: Pick<Logger, 'debug' | 'warn'>
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
    // What this actually did, said plainly, because the previous line said
    // "setup completed" and meant something much smaller.
    //
    // `configureOpenTelemetry` imports the two OpenTelemetry packages to prove
    // they are installed, and returns. NOTHING in this codebase creates a span --
    // there is no `getTracer`, no `startSpan`, anywhere -- so no trace is ever
    // exported to the configured endpoint. Logging "setup completed" told an
    // operator their telemetry was working when the only thing that had happened
    // was a dependency check.
    telemetryStep.end({ dependenciesPresent: true, spansExported: false })
    input.logger.warn(
      'OpenTelemetry dependencies are present and the endpoint is configured, but this engine emits no spans yet, so nothing will arrive at the collector.',
      { endpoint_configured: true, spans_exported: false }
    )
  }

  return { drift }
}
