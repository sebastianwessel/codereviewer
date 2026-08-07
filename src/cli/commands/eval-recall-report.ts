// `eval recall-report` — renders the per-expectation recall view of one or more
// eval reports that are already on disk. It runs no review and calls no model.
import path from 'node:path'
import { renderEvalRecallReport } from '../../domains/evaluation/index.js'
import { isFileSystemError } from '../../shared/errors/error-normalizer.js'
import { parseOptionValues, unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { readEvalReport } from '../eval-report-files.js'

export const runEvalRecallReport = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, ['--report'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  const reportPaths = parseOptionValues(args, '--report')
  const selectedReportPaths =
    reportPaths.length === 0
      ? [path.posix.join('.codereviewer', 'eval', 'eval-report.json')]
      : reportPaths

  try {
    const reports = await Promise.all(
      selectedReportPaths.map(async (reportPath) => ({
        label: reportPath,
        report: await readEvalReport(options.cwd, reportPath)
      }))
    )

    return {
      exitCode: 0,
      stdout: `${renderEvalRecallReport({ reports })}\n`,
      stderr: ''
    }
  } catch (error) {
    if (isFileSystemError(error)) {
      return usageError(
        `Eval report not found or unreadable: ${selectedReportPaths.join(', ')}`
      )
    }

    return mapErrorResult(error, 'config')
  }
}
