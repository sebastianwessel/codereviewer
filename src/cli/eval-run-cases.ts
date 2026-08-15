// Which cases one `eval run` scores, and running them. Selection and execution
// only: whether an empty selection is a usage error, and whether the selected
// corpus is hydrated, are decisions the command keeps.
import {
  loadEvalCasesFromFixtures,
  type EvalCase
} from '../domains/evaluation/index.js'
// By path rather than through the evaluation barrel, deliberately: `runEvalCase`
// imports `review-workflow`, and re-exporting it from `evaluation/index.ts`
// would close an import cycle back through `drift`. Its own header says so.
import { runEvalCase } from '../domains/evaluation/run/eval-case-runner.js'
import type { Logger } from '../domains/observability/index.js'
import type { ProviderImport } from '../domains/provider-resolution/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'
import type { LoadedCodeReviewerConfig } from './command-config.js'

export type EvalCaseOutputs = readonly Awaited<ReturnType<typeof runEvalCase>>[]

export const selectEvalRunCases = async (
  input: {
    readonly repositoryRoot: string
    readonly sliceRoot?: string
    readonly caseFilters: readonly string[]
  }
): Promise<readonly EvalCase[]> => {
  const loadedEvalCases = await loadEvalCasesFromFixtures(input.repositoryRoot, {
    ...(input.sliceRoot === undefined ? {} : { sliceRoot: input.sliceRoot })
  })

  return input.caseFilters.length === 0
    ? loadedEvalCases
    : loadedEvalCases.filter((evalCase) =>
        input.caseFilters.includes(evalCase.id)
      )
}

export const runSelectedEvalCases = async (
  input: {
    readonly repositoryRoot: string
    // The effective configuration — pins applied — every case reviews under.
    readonly config: CodeReviewerConfig
    // The load the effective configuration came from, for the warnings and the
    // environment each case's review carries through unchanged.
    readonly loadedConfig: LoadedCodeReviewerConfig
    readonly cases: readonly EvalCase[]
    readonly logger: Logger
    readonly providerImport?: ProviderImport
  }
): Promise<EvalCaseOutputs> =>
  Promise.all(
    input.cases.map((evalCase) =>
      runEvalCase({
        root: input.repositoryRoot,
        config: input.config,
        configWarnings: input.loadedConfig.warnings,
        baselineExplicitlyConfigured:
          input.loadedConfig.baselineExplicitlyConfigured,
        environment: input.loadedConfig.environment,
        evalCase,
        logger: input.logger.child({
          eval_case_id: evalCase.id
        }),
        ...(input.providerImport === undefined
          ? {}
          : { providerImport: input.providerImport })
      })
    )
  )
