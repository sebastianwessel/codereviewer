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
import {
  createStructuredError,
  isFileNotFoundError,
  isFileSystemError,
  normalizeError
} from '../shared/errors/error-normalizer.js'

export type BaselineSourceInput = {
  readonly repositoryRoot: string
  readonly artifactDir: string
  readonly explicitReportPath: string | undefined
}

export type BaselineSourceReport = {
  readonly reportPath: string
  readonly report: ReviewReport
}

// Why the read did not happen, in terms the caller can act on.
//
// The four ways this fails need four different actions — fix the path, fix the
// permissions, point at the file inside the directory, pass a path inside the
// repository — and one message covered all of them: "could not be read", with
// the path and nothing else. That is a report of an absence with its cause
// discarded, which is the same shape the JSON branch below was already fixed
// out of; this now answers the same question the same way.
const unreadableSourceCause = (
  error: unknown
): {
  // The normalized errno (`ENOENT`) or error code, carried in `details` so a
  // machine reader can branch on the cause the message states in prose.
  readonly cause: string
  readonly explanation: string
} => {
  // Raised by the path service BEFORE the filesystem is touched, so it carries
  // no errno: the path is absolute, or it resolves outside the repository root.
  if (error instanceof TypeError) {
    return {
      cause: 'path_outside_repository',
      explanation:
        'is not a repository-relative path inside the repository, so it was refused before it was read. Pass a path inside the repository.'
    }
  }

  // The errno itself when the filesystem answered, so the cause is reported as
  // the code it really was even where there is no tailored sentence for it. A
  // failure that never reached the filesystem has none, and normalizes instead.
  const errno = isFileSystemError(error)
    ? (error as { readonly code: string }).code
    : undefined

  if (isFileNotFoundError(error)) {
    return {
      cause: 'ENOENT',
      explanation:
        "does not exist. Point --report at a run's report.json, or omit --report to use the newest completed run."
    }
  }

  if (errno === 'EACCES' || errno === 'EPERM') {
    return {
      cause: errno,
      explanation:
        'cannot be read: permission denied. Grant read access to the file, or point --report at a report this user can read.'
    }
  }

  if (errno === 'EISDIR') {
    return {
      cause: errno,
      explanation:
        "is a directory, not a file. Point --report at the run's report.json inside it."
    }
  }

  return {
    cause: errno ?? normalizeError(error, { source: 'repository' }).code,
    explanation: 'could not be read.'
  }
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
  } catch (error) {
    const { cause, explanation } = unreadableSourceCause(error)

    throw createStructuredError({
      code: 'baseline_source_unavailable',
      message: `The review report to build a baseline from, "${reportPath}", ${explanation}`,
      category: 'repository',
      details: { reportPath, cause }
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
