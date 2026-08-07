// Where a command's log lines go, and who writes them: the sink (`--log-file`
// or the injected one) and the logger bound to the command's name.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import {
  createReviewLogger,
  type Logger,
  type ReviewLogSink
} from '../domains/observability/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'
import type { CliRunOptions } from './cli-contract.js'
import { ensureDirectory, resolveArtifactWritePath } from './run-artifacts.js'

export const resolveLogSink = async (
  options: CliRunOptions,
  logFile: string | undefined
): Promise<ReviewLogSink | undefined> => {
  if (logFile === undefined) {
    return options.logSink
  }

  const logPath = await resolveArtifactWritePath(options.cwd, logFile)
  await ensureDirectory(path.dirname(logPath))
  // Append a per-run header instead of truncating so earlier runs survive and a
  // failed run's log is not destroyed by the next invocation. The header is a
  // JSON line so the file stays valid JSONL.
  appendFileSync(
    logPath,
    `${JSON.stringify({ event: 'log-run-start', at: new Date().toISOString() })}\n`,
    'utf8'
  )

  return {
    write: (chunk) => {
      appendFileSync(logPath, chunk, 'utf8')
    }
  }
}

export const createCliLogger = (
  input: {
    readonly config: CodeReviewerConfig
    readonly command: string
    readonly sink: ReviewLogSink | undefined
  }
): Logger =>
  createReviewLogger({
    level: input.config.observability.logging.level,
    ...(input.sink === undefined ? {} : { out: input.sink }),
    bindings: {
      component: 'cli',
      command: input.command
    }
  })
