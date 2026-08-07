// `baseline write` — turns a completed run's admitted findings into the
// baseline file later runs suppress against.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildBaselineEntries,
  renderBaselineJson
} from '../../domains/admission/index.js'
import { parseOptionValue, unknownCliOption } from '../args.js'
import { resolveBaselineSourceReport } from '../baseline-source.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { loadConfigForCommand } from '../command-config.js'
import {
  ensureDirectory,
  jsonResult,
  resolveArtifactWritePath
} from '../run-artifacts.js'

export const runBaselineWrite = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, ['--report'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const loadedConfig = await loadConfigForCommand(args, options)
    const source = await resolveBaselineSourceReport({
      repositoryRoot: options.cwd,
      artifactDir: loadedConfig.config.paths.artifactDir,
      explicitReportPath: parseOptionValue(args, '--report')
    })
    const entries = buildBaselineEntries(source.report.admittedFindings)
    const baselinePath = await resolveArtifactWritePath(
      options.cwd,
      loadedConfig.config.baseline.path
    )

    await ensureDirectory(path.dirname(baselinePath))
    await writeFile(baselinePath, renderBaselineJson(entries))

    return {
      exitCode: 0,
      stdout: jsonResult({
        baselinePath: loadedConfig.config.baseline.path,
        sourceReportPath: source.reportPath,
        entryCount: entries.length
      }),
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'repository')
  }
}
