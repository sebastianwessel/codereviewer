import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import type {
  DiffMap,
  RepositoryIntake
} from '../../../repository-intake/index.js'
import { collectRepositoryIntake } from '../../../repository-intake/index.js'
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
    ...(options.signal === undefined ? {} : { signal: options.signal })
  })
  const effectiveDiffMaps = options.reviewDiffMaps ?? intake.diffMaps
  const effectiveRawDiff = options.reviewRawDiff ?? intake.rawDiff

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
