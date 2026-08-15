// Where one `eval run` lands on disk: the report, the summary and the recall
// report, written both to the eval root (the latest run, which every comparison
// script reads) and to the per-run archive (the run that produced it, kept).
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalRecallReport,
  renderEvalSummary,
  type EvalCase,
  type EvalReport
} from '../domains/evaluation/index.js'
import {
  ensureDirectory,
  jsonResult,
  resolveArtifactWritePath
} from './run-artifacts.js'

export const writeEvalRunArtifacts = async (
  input: {
    readonly repositoryRoot: string
    // The eval root, holding the latest run's artifacts.
    readonly artifactRoot: string
    // The already-resolved filesystem path of `artifactRoot`. Resolved by the
    // caller BEFORE the cases run, so an unwritable eval root is refused before
    // a run spends anything on a model, and passed in rather than re-resolved so
    // that ordering is not quietly undone here.
    readonly artifactDirectory: string
    // The per-run archive, holding the same three artifacts under a run id.
    readonly archiveRoot: string
    readonly cases: readonly EvalCase[]
    readonly artifactName: string
    readonly report: EvalReport
  }
  // The summary rendered against the eval root, which is also this command's
  // stdout.
): Promise<string> => {
  await ensureDirectory(input.artifactDirectory)
  await ensureDirectory(
    await resolveArtifactWritePath(input.repositoryRoot, input.archiveRoot)
  )
  const reportJson = jsonResult(input.report)
  await writeFile(
    await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.artifactRoot, input.artifactName)
    ),
    reportJson
  )
  await writeFile(
    await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.archiveRoot, input.artifactName)
    ),
    reportJson
  )
  // Rendered twice, once per root: the summary quotes the paths of the
  // artifacts beside it, and an archived copy pointing at the eval root would
  // send a reader to whichever run happened to finish last.
  const summary = renderEvalSummary({
    cases: input.cases,
    report: input.report,
    artifactRoot: input.artifactRoot
  })

  await writeFile(
    await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.artifactRoot, EVAL_SUMMARY_ARTIFACT_NAME)
    ),
    summary
  )
  await writeFile(
    await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.archiveRoot, EVAL_SUMMARY_ARTIFACT_NAME)
    ),
    renderEvalSummary({
      cases: input.cases,
      report: input.report,
      artifactRoot: input.archiveRoot
    })
  )
  const recallReport = renderEvalRecallReport({
    reports: [
      {
        label: input.artifactName,
        report: input.report
      }
    ]
  })

  await writeFile(
    await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.artifactRoot, EVAL_RECALL_REPORT_ARTIFACT_NAME)
    ),
    recallReport
  )
  await writeFile(
    await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.archiveRoot, EVAL_RECALL_REPORT_ARTIFACT_NAME)
    ),
    recallReport
  )

  return summary
}
