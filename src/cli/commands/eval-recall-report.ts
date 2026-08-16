// `eval recall-report` — renders the per-expectation recall view of one or more
// eval reports that are already on disk. It runs no review and calls no model.
import path from 'node:path'
import {
  poolIdentityRefusals,
  poolIdentityWarnings,
  renderEvalRecallReport
} from '../../domains/evaluation/index.js'
import { isFileSystemError } from '../../shared/errors/error-normalizer.js'
import { parseOptionValues, unknownCliOption } from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { readEvalRecallView } from '../eval-report-files.js'

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
        report: await readEvalRecallView(options.cwd, reportPath)
      }))
    )

    // `--report` is repeatable, and several reports are POOLED: the `Rate`
    // column is `k/n` over the runs and the summary counts an expectation as
    // always/never/flaky across them. That is the same merge the significance
    // module performs on an arm, and until now this command performed it on
    // whatever files it was handed — it read no provenance at all, so two runs
    // scored against different answer keys, by different rules, or by different
    // judges pooled into one table with nothing saying so.
    //
    // The rule and its wording are `eval-pool-identity.ts`'s, deliberately not a
    // second copy here: this repository has already paid for one predicate
    // restated in eight places. Refusing at the CLI rather than in the renderer
    // mirrors `eval compare`, whose arm-level refusals also live in its command.
    //
    // A single report is untouched — nothing is merged, so nothing can disagree,
    // and every archive too old to state its identity still opens on its own.
    const poolCandidates = reports.map(({ label, report }) => ({
      label,
      metricsVersion: report.metricsVersion,
      provenance: report.provenance
    }))
    const refusals = poolIdentityRefusals(poolCandidates)

    if (refusals.length > 0) {
      return usageError(refusals.join(' '))
    }

    return {
      exitCode: 0,
      stdout: `${renderEvalRecallReport({ reports })}\n`,
      // Not a refusal: reports that ALL fail to state an identity agree on
      // `unrecorded` and pool, which keeps the pre-provenance archives readable
      // together. The warning is what stops that permissiveness being silent.
      stderr: poolIdentityWarnings(poolCandidates).join('\n')
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
