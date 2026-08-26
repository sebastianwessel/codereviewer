import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../../shared/contracts/index.js'
import {
  createStructuredError,
  type StructuredError
} from '../../../shared/errors/error-normalizer.js'
import {
  configureOpenTelemetry as defaultConfigureOpenTelemetry,
  type NoContentEventRecorder
} from '../../observability/index.js'
import {
  runDriftCheck as defaultRunDriftCheck,
  type DriftCheckResult
} from '../../drift/index.js'
import { createDriftGateError } from './drift.js'

/**
 * The run was asked for a model review and has no model.
 *
 * `aiReview.enabled` defaults to `true` and `provider` defaults to `undefined`,
 * so this is the SHIPPED DEFAULT: `codereviewer review` in a repository nobody
 * had configured yet produced zero findings, a passing quality gate and exit 0 —
 * a clean bill of health for a search that never happened. The report no longer
 * claims a model produced it, but disclosure arrives after the fact and only to
 * whoever opens the report; the run itself is the thing that has to refuse.
 *
 * The message names both remedies because the contradiction has two honest
 * resolutions and nothing in the configuration says which one the operator
 * meant.
 */
const createModelReviewProviderMissingError = (): StructuredError =>
  createStructuredError({
    code: 'model_review_provider_missing',
    message:
      'aiReview.enabled is true but no provider is configured, so this run was asked for a model review it has no model to perform. Configure `provider` (id, model, and the credentials it names), or set `aiReview.enabled: false` to run deterministic-only on purpose — a review that searched nothing must not report as one that found nothing.',
    category: 'config'
  })

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

  // FIRST, ahead of the drift check and of every step this preflight records.
  //
  // It reads configuration and nothing else, so refusing here costs no drift
  // scan, no repository intake and no provider call, and it fires before any
  // artifact, step or partial report exists to be read as a review that ran.
  // Preflight is where it belongs for the same reason the drift gate is here:
  // this stage exists to refuse a run that cannot do what it was asked, and
  // every entry point — the `review` command, the library's `runReview`, and
  // `eval run` — reaches the pipeline through it, so one check covers all three
  // instead of three checks drifting apart.
  //
  // `aiReview.enabled: false` is deliberately NOT this case. That operator
  // switched the model review off and cannot be surprised by its absence; the
  // run completes at exit 0 and the report discloses that no model searched.
  // Only the contradiction — asked for, unavailable — is refused.
  if (input.config.aiReview.enabled && input.config.provider === undefined) {
    throw createModelReviewProviderMissingError()
  }

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
