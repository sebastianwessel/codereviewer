// The argv half of `eval run`: which options the command accepts, and the typed
// values it reads off them. Parsing only — no IO, no configuration loading — so
// the command handler stays a sequence of stages and every flag's accepted value
// stays beside the schema that validates it.
import {
  EvalRegressionGateProfileSchema,
  ReviewDepthSchema,
  ReviewModeSchema,
  maxConcurrentTasksBounds
} from '../shared/contracts/index.js'
import {
  loggingCliOptions,
  parseEnumOption,
  parseIntegerOption,
  parseLogFileOverride,
  parseLogLevelOverride,
  parseOptionValue,
  parseOptionValues
} from './args.js'
import type { CommandCliConfigOverlay } from './command-config.js'
import { parseEvalCapabilityOverrides } from './eval-capability-overrides.js'

// Everything `eval run` honours. Declared here, beside the parsers that read
// them, so the unknown-option check and the parsing cannot describe different
// command lines: an option accepted by name and read by nobody is the
// accept-and-ignore failure `unknownCliOption` exists to prevent.
export const evalRunCliOptions: readonly string[] = [
  ...loggingCliOptions,
  '--capability',
  '--case',
  '--gate-profile',
  '--max-concurrent-tasks',
  '--review-depth',
  '--review-mode',
  '--slice-root'
]

export type EvalRunOptions = {
  // The arguments with the logging flags removed, which is what every remaining
  // parser and the configuration loader read.
  readonly args: readonly string[]
  readonly logFile?: string
  readonly sliceRoot?: string
  readonly caseFilters: readonly string[]
  readonly capabilityOverrides: ReadonlyMap<string, boolean>
  // The CLI-only overlay handed to the configuration loader. Empty when no flag
  // asked for an override, which is what lets the caller omit `cliConfig`
  // entirely rather than merging an empty object over the loaded config.
  readonly cliConfig: CommandCliConfigOverlay
}

export const parseEvalRunOptions = (
  args: readonly string[]
): EvalRunOptions => {
  const logLevelOverride = parseLogLevelOverride(args)
  const logFileOverride = parseLogFileOverride(logLevelOverride.args)
  const evalArgs = logFileOverride.args
  const sliceRoot = parseOptionValue(evalArgs, '--slice-root')
  const caseFilters = parseOptionValues(evalArgs, '--case')
  // Every accepted value below comes from the config schema that will validate
  // it moments later, so a flag can never accept a value the config rejects.
  const reviewMode = parseEnumOption(
    evalArgs,
    '--review-mode',
    ReviewModeSchema.options
  )
  const reviewDepth = parseEnumOption(
    evalArgs,
    '--review-depth',
    ReviewDepthSchema.options
  )
  const maxConcurrentTasks = parseIntegerOption(
    evalArgs,
    '--max-concurrent-tasks',
    maxConcurrentTasksBounds
  )
  // Overrides `evaluation.regressionGate.profile` for this run only, without
  // touching the committed config's default. See the `stable`/`strict`
  // rationale in `eval-regression-gate-policy.ts`.
  const gateProfile = parseEnumOption(
    evalArgs,
    '--gate-profile',
    EvalRegressionGateProfileSchema.options
  )
  const cliConfig: CommandCliConfigOverlay = {
    ...(logLevelOverride.level === undefined
      ? {}
      : {
          observability: {
            logging: {
              level: logLevelOverride.level
            }
          }
        }),
    ...(reviewMode === undefined &&
    reviewDepth === undefined &&
    maxConcurrentTasks === undefined
      ? {}
      : {
          review: {
            ...(reviewMode === undefined ? {} : { mode: reviewMode }),
            ...(reviewDepth === undefined ? {} : { depth: reviewDepth }),
            ...(maxConcurrentTasks === undefined
              ? {}
              : { maxConcurrentTasks })
          }
        }),
    ...(gateProfile === undefined
      ? {}
      : { evaluation: { regressionGate: { profile: gateProfile } } })
  }

  return {
    args: evalArgs,
    ...(logFileOverride.logFile === undefined
      ? {}
      : { logFile: logFileOverride.logFile }),
    ...(sliceRoot === undefined ? {} : { sliceRoot }),
    caseFilters,
    capabilityOverrides: parseEvalCapabilityOverrides(evalArgs),
    cliConfig
  }
}
