// The one way a CLI command resolves its configuration.
import { loadCodeReviewerConfig } from '../domains/configuration/index.js'
import { parseConfigPath } from './args.js'
import type { CliRunOptions } from './cli-contract.js'

export type LoadedCodeReviewerConfig = Awaited<
  ReturnType<typeof loadCodeReviewerConfig>
>

// The CLI-only configuration overlay a command folds into its load (`eval run`
// builds one out of `--review-mode`, `--gate-profile` and friends). Derived from
// the loader's own parameter rather than restated, so an overlay cannot describe
// a shape the loader does not merge.
export type CommandCliConfigOverlay = NonNullable<
  NonNullable<Parameters<typeof loadConfigForCommand>[2]>['cliConfig']
>

// Every command resolves configuration identically: `--config` when given, the
// discovered file otherwise, always against the process environment. `overrides`
// carries the few command-specific inputs (`cliConfig`, `loadDotEnv`); it is
// spread BEFORE `configPath` so an override can never displace the explicit
// `--config` the user passed.
export const loadConfigForCommand = async (
  args: readonly string[],
  options: CliRunOptions,
  overrides: Omit<
    Parameters<typeof loadCodeReviewerConfig>[0],
    'repositoryRoot' | 'environment' | 'configPath'
  > = {}
): Promise<LoadedCodeReviewerConfig> => {
  const configPath = parseConfigPath(args)

  return loadCodeReviewerConfig({
    repositoryRoot: options.cwd,
    environment: options.environment ?? {},
    ...overrides,
    ...(configPath === undefined ? {} : { configPath })
  })
}
