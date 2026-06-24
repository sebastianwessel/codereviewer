import type { Logger } from '@purista/harness'
import type { NoContentEventRecorder } from '../observability/index.js'
import {
  collectReviewRunnerRepositoryIntake,
  readReviewRunnerSourceInput,
  type ReviewRunnerRepositoryInputOptions,
  type ReviewRunnerRepositoryInputState
} from './review-runner-repository-input.js'

type CollectRepositoryIntake = typeof collectReviewRunnerRepositoryIntake
type ReadSourceInput = typeof readReviewRunnerSourceInput

export type PrepareReviewRunnerSourceStateOptions =
  ReviewRunnerRepositoryInputOptions & {
    readonly observability: NoContentEventRecorder
    readonly logger: Logger
    readonly collectRepositoryIntake?: CollectRepositoryIntake
    readonly readSourceInput?: ReadSourceInput
  }

export const prepareReviewRunnerSourceState = async (
  options: PrepareReviewRunnerSourceStateOptions
): Promise<ReviewRunnerRepositoryInputState> => {
  const collectRepositoryIntake =
    options.collectRepositoryIntake ?? collectReviewRunnerRepositoryIntake
  const readSourceInput = options.readSourceInput ?? readReviewRunnerSourceInput

  const intakeStep = options.observability.startStep('repository_intake')
  options.logger.debug('Repository intake started.', {
    explicit_file_count: options.explicitFiles?.length ?? 0,
    max_files: options.config.review.maxFiles,
    max_file_bytes: options.config.review.maxFileBytes
  })
  const repositoryIntake = await collectRepositoryIntake({
    repositoryRoot: options.repositoryRoot,
    config: options.config,
    ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
    ...(options.headRef === undefined ? {} : { headRef: options.headRef }),
    ...(options.reviewDiffMaps === undefined
      ? {}
      : { reviewDiffMaps: options.reviewDiffMaps }),
    ...(options.reviewRawDiff === undefined
      ? {}
      : { reviewRawDiff: options.reviewRawDiff }),
    ...(options.explicitFiles === undefined
      ? {}
      : { explicitFiles: options.explicitFiles }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  })
  intakeStep.end(repositoryIntake.intakeMetrics)
  options.logger.debug('Repository intake completed.', {
    changed_file_count: repositoryIntake.intakeMetrics.changedFileCount,
    skipped_file_count: repositoryIntake.intakeMetrics.skippedFileCount
  })

  const sourceReadStep = options.observability.startStep('source_read', {
    fileCount: repositoryIntake.intake.changedFiles.length
  })
  options.logger.debug('Source read started.', {
    file_count: repositoryIntake.intake.changedFiles.length
  })
  const sourceInput = await readSourceInput({
    repositoryRoot: options.repositoryRoot,
    intake: repositoryIntake.intake
  })
  sourceReadStep.end(sourceInput.sourceReadMetrics)
  options.logger.debug('Source read completed.', {
    file_count: sourceInput.sourceReadMetrics.fileCount
  })

  return {
    ...repositoryIntake,
    ...sourceInput
  }
}
