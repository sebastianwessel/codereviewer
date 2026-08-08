// Resolving the review report that `baseline write` builds from.
//
// The report is an EXTERNAL input: a file on disk, optionally named by the
// caller with `--report`. Anything can be at that path — a run-summary, an eval
// report, a half-written file, an unrelated JSON document. So unlike a missing
// quality gate (an internal inconsistency, see `review-completion.ts`), a report
// that is absent or unusable here is an input-validation failure and stays a
// `repository` error.
//
// What it must not do is succeed anyway. Reading the file with a bare
// `JSON.parse` into a hand-written shape made every wrong-shaped document look
// like a report with no admitted findings, and `admittedFindings ?? []` turned
// that into a zero-entry baseline written to disk with exit code 0. The caller
// would have been told the baseline was built. The contract schema is the only
// thing that can tell a report from a document that merely parses.
import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../platform/path-service.js'
import {
  latestRunWithReport,
  parseRunIndex
} from '../domains/reporting/index.js'
import { readRunIndex } from './run-artifacts.js'
import {
  ReviewReportSchema,
  type ReviewReport
} from '../shared/contracts/index.js'
import { createStructuredError } from '../shared/errors/error-normalizer.js'

export type BaselineSourceInput = {
  readonly repositoryRoot: string
  readonly artifactDir: string
  readonly explicitReportPath: string | undefined
}

export type BaselineSourceReport = {
  readonly reportPath: string
  readonly report: ReviewReport
}

const readSourceContent = async (
  repositoryRoot: string,
  reportPath: string
): Promise<string> => {
  try {
    return await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, reportPath),
      'utf8'
    )
  } catch {
    throw createStructuredError({
      code: 'baseline_source_unavailable',
      message: 'The review report to build a baseline from could not be read.',
      category: 'repository',
      details: { reportPath }
    })
  }
}

const reportFromSourceContent = (
  content: string,
  reportPath: string
): ReviewReport => {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw createStructuredError({
      code: 'baseline_source_invalid',
      message: `The file at "${reportPath}" is not valid JSON, so it cannot be a review report. Point --report at a run's report.json.`,
      category: 'repository',
      details: { reportPath }
    })
  }

  const report = ReviewReportSchema.safeParse(parsed)

  if (!report.success) {
    throw createStructuredError({
      code: 'baseline_source_invalid',
      message: `The file at "${reportPath}" is valid JSON but is not a review report, so no baseline can be built from it. Point --report at a run's report.json.`,
      category: 'repository',
      details: {
        reportPath,
        // The first issue names the field that decided it — enough to tell a
        // wrong-file mistake from a corrupted report without dumping the file.
        firstSchemaIssue: report.error.issues[0]?.path.join('.') ?? ''
      }
    })
  }

  return report.data
}

/**
 * Resolves and validates the report `baseline write` builds from: the one named
 * by `--report`, or the newest completed run in the run index.
 *
 * Returns a report that satisfies the contract, or throws. There is no third
 * outcome — in particular, no empty-but-successful one.
 */
export const resolveBaselineSourceReport = async (
  input: BaselineSourceInput
): Promise<BaselineSourceReport> => {
  const reportPath =
    input.explicitReportPath ??
    latestRunWithReport(
      parseRunIndex(await readRunIndex(input.repositoryRoot, input.artifactDir))
    )?.reportPath

  if (reportPath === undefined) {
    throw createStructuredError({
      code: 'baseline_source_unavailable',
      message:
        'No completed review report was found to build a baseline from. Run a review first, or pass --report <path>.',
      category: 'repository',
      details: { artifactDir: input.artifactDir }
    })
  }

  return {
    reportPath,
    report: reportFromSourceContent(
      await readSourceContent(input.repositoryRoot, reportPath),
      reportPath
    )
  }
}
