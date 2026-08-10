import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import type {
  DiffMap,
  GitCommandRunner,
  RepositoryIntake
} from '../../../repository-intake/index.js'
import { collectRepositoryIntake } from '../../../repository-intake/index.js'
import { redactText } from '../../../../shared/redaction/redactor.js'
import type { SupportSignalSourceFile } from '../../../deterministic-signals/index.js'
import type { ReviewedDiffRange } from '../../../admission/index.js'
import {
  readChangedSourceFiles,
  reviewedDiffRangesForDiffMaps
} from '../context/context.js'

export type ReviewRunnerRepositoryInputOptions = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly explicitFiles?: readonly string[] | undefined
  readonly reviewDiffMaps?: readonly DiffMap[] | undefined
  // Raw unified diff text provided by the caller (e.g. eval slices). When unset,
  // the intake-computed raw diff is used.
  readonly reviewRawDiff?: string | undefined
  readonly baseRef?: string | undefined
  readonly headRef?: string | undefined
  readonly signal?: AbortSignal | undefined
  // The run's shared git runner, when the review is one stage of a run that has
  // one. Absent for a review run on its own, where intake's default applies.
  readonly runGit?: GitCommandRunner | undefined
}

export type ReviewRunnerRepositoryIntakeMetrics = {
  readonly changedFileCount: number
  readonly skippedFileCount: number
}

export type ReviewRunnerSourceReadMetrics = {
  readonly fileCount: number
}

export type ReviewRunnerRepositoryIntakeState = {
  readonly intake: RepositoryIntake
  readonly effectiveDiffMaps: readonly DiffMap[]
  readonly effectiveDiffRanges: readonly ReviewedDiffRange[]
  readonly effectiveRawDiff: string
  readonly intakeMetrics: ReviewRunnerRepositoryIntakeMetrics
}

export type ReviewRunnerSourceReadState = {
  readonly sourceFiles: readonly SupportSignalSourceFile[]
  readonly sourceReadMetrics: ReviewRunnerSourceReadMetrics
}

export type ReviewRunnerRepositoryInputState =
  ReviewRunnerRepositoryIntakeState & ReviewRunnerSourceReadState

export const collectReviewRunnerRepositoryIntake = async (
  options: ReviewRunnerRepositoryInputOptions
): Promise<ReviewRunnerRepositoryIntakeState> => {
  const intake = await collectRepositoryIntake({
    repositoryRoot: options.repositoryRoot,
    baseRef: options.baseRef ?? options.config.review.baseRef,
    headRef: options.headRef ?? options.config.review.headRef,
    includePatterns: options.config.paths.include,
    excludePatterns: options.config.paths.exclude,
    maxFiles: options.config.review.maxFiles,
    maxFileBytes: options.config.review.maxFileBytes,
    ...(options.explicitFiles === undefined
      ? {}
      : { explicitFiles: options.explicitFiles }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.runGit === undefined ? {} : { runGit: options.runGit })
  })
  const effectiveDiffMaps = options.reviewDiffMaps ?? intake.diffMaps
  // REDACTED HERE, once, at the single point the reviewed diff enters the run.
  //
  // Every changed FILE's content is redacted before it reaches a packet
  // (`assembleContext`), and the diff was not — so a credential committed inside a
  // changed hunk was sent to the provider verbatim in the "What this change
  // modified" section, while the identical string in the surrounding file body
  // came out `[REDACTED]`. Two paths carrying the same bytes to the same model,
  // one of them redacting, is exactly the shape this repository keeps finding.
  //
  // Redacting at the source rather than at each consumer is what keeps the
  // context ledger honest too: the ledger measures this same string, so what is
  // accounted for stays what is sent.
  const effectiveRawDiff = redactText(options.reviewRawDiff ?? intake.rawDiff)

  return {
    intake,
    effectiveDiffMaps,
    effectiveDiffRanges: reviewedDiffRangesForDiffMaps(effectiveDiffMaps),
    effectiveRawDiff,
    intakeMetrics: {
      changedFileCount: intake.changedFiles.length,
      skippedFileCount: intake.skippedFiles.length
    }
  }
}

export const readReviewRunnerSourceInput = async (
  input: {
    readonly repositoryRoot: string
    readonly intake: RepositoryIntake
  }
): Promise<ReviewRunnerSourceReadState> => {
  const sourceFiles = await readChangedSourceFiles({
    repositoryRoot: input.repositoryRoot,
    changedFiles: input.intake.changedFiles
  })

  return {
    sourceFiles,
    sourceReadMetrics: {
      fileCount: sourceFiles.length
    }
  }
}
