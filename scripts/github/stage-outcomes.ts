// The one CLI stage this workflow spawns, and the exit-code contract that
// decides what it is allowed to do to the job.
//
// A push used to spawn three subprocesses — `review`, `intent check`, `impact
// check` — one per stage. `review` now runs the two advisory reference lanes
// itself, in-process, over the run context it already built for its own intake
// (`src/cli/advisory-lanes.ts`), and writes their reports beside its own inside
// the one run directory it names on stdout. There is only one process left to
// spawn and classify, so this file now describes one stage rather than three.
//
// `review` is the only stage that can fail the job. Specs 22 and 23 require the
// advisory lanes to never fail a pipeline on what they find — spec 23 states
// outright that `intent check` "MUST NOT be able to fail a pipeline on
// fulfilment grounds. This is not configurable", and spec 22 says the same of
// `impact check`. `src/cli/advisory-lanes.ts` enforces that guarantee at the
// source now: a lane that throws becomes a warning on the review report and an
// absent report file, never a non-zero exit from `review` itself. `jobExitCode`
// below still reads only the blocking stage's status rather than assuming the
// one outcome it is ever handed is that stage — kept structural, not collapsed
// to a single comparison, so the guarantee does not have to be remembered by
// habit if a second spawned stage is ever reintroduced.
//
// `review` CAN still exit non-zero for reasons that have nothing to do with
// what it found: a malformed config file (2) or an unresolvable merge base
// (3). That is reported in the comment as a stage that could not run.

export type StageId = 'review'

// Only one member survives the move above: nothing constructs an 'advisory'
// StageDefinition or StageOutcome any more, because the advisory lanes no
// longer produce a stage result of their own to classify.
export type StageKind = 'blocking'

export type StageDefinition = {
  readonly id: StageId
  readonly kind: StageKind
  /** Human label used in the comment and the job summary. */
  readonly label: string
  /** What this stage contributes, one line, for the comment's stage table. */
  readonly contribution: string
  /** CLI arguments before the shared `--base-ref`/`--head-ref` pair. */
  readonly command: readonly string[]
}

export const reviewStageDefinition: StageDefinition = {
  id: 'review',
  kind: 'blocking',
  label: 'Review',
  contribution:
    'Evidence-backed defects in the changed code. Blocks on the quality gate.',
  command: ['review']
}

export type StageStatus =
  // Ran, and reported nothing that blocks.
  | 'passed'
  // `review` only: the run completed and the quality gate failed.
  | 'gate-failed'
  // The command itself failed (configuration, repository, provider, internal).
  | 'failed'
  // Not attempted. The reason is carried in `message`.
  | 'skipped'

export type StageResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type StageOutcome = {
  readonly id: StageId
  readonly kind: StageKind
  readonly status: StageStatus
  /** Structured error code from the CLI's stderr JSON, when there was one. */
  readonly errorCode?: string
  readonly message?: string
  /** Parsed stdout, when the command produced JSON. */
  readonly stdout?: unknown
  /**
   * Where the run's artifacts landed. A successful run reports it on stdout; a
   * run that failed after writing partial artifacts reports it on stderr beside
   * the error. Read from both, so a failed review still has its report read and
   * summarized instead of being reduced to an error code.
   */
  readonly artifactDir?: string
}

// Exit codes are the CLI's documented contract
// (docs/06-reference/exit-codes-and-error-codes.md). Branching on them rather
// than on stdout text is what keeps this integration from breaking when a
// message is reworded.
const exitCodeMeanings: Readonly<Record<number, string>> = {
  2: 'configuration or usage error',
  3: 'repository error (usually a shallow checkout or a missing merge base)',
  4: 'provider error (auth, rate limit, context length, timeout)',
  5: 'internal error'
}

export const describeExitCode = (exitCode: number): string =>
  exitCodeMeanings[exitCode] ?? `unexpected exit code ${exitCode}`

/**
 * The `{ code, message, artifactDir? }` object every failing command writes to
 * stderr, or `undefined` when stderr held something else. Never throws: a stage
 * that crashed hard is exactly the case where this must still produce a comment.
 */
export const parseCliError = (
  stderr: string
):
  | {
      readonly code: string
      readonly message: string
      readonly artifactDir?: string
    }
  | undefined => {
  const trimmed = stderr.trim()

  if (trimmed.length === 0) {
    return undefined
  }

  // A failing run writes its JSON object last, after any log lines the sink
  // emitted, so parse from the final `{` that yields a valid object.
  const start = trimmed.lastIndexOf('{')

  if (start < 0) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start))

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('code' in parsed) ||
      typeof parsed.code !== 'string'
    ) {
      return undefined
    }

    const artifactDir =
      'artifactDir' in parsed && typeof parsed.artifactDir === 'string'
        ? parsed.artifactDir
        : undefined

    return {
      code: parsed.code,
      message:
        'message' in parsed && typeof parsed.message === 'string'
          ? parsed.message
          : '',
      ...(artifactDir === undefined ? {} : { artifactDir })
    }
  } catch {
    return undefined
  }
}

const artifactDirectoryFromJson = (value: unknown): string | undefined =>
  typeof value === 'object' &&
  value !== null &&
  'artifactDir' in value &&
  typeof value.artifactDir === 'string'
    ? value.artifactDir
    : undefined

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

export const classifyStageOutcome = (
  stage: StageDefinition,
  result: StageResult
): StageOutcome => {
  const stdout = parseJson(result.stdout)
  const error = parseCliError(result.stderr)
  const artifactDir =
    artifactDirectoryFromJson(stdout) ?? error?.artifactDir

  if (result.exitCode === 0) {
    return {
      id: stage.id,
      kind: stage.kind,
      status: 'passed',
      ...(stdout === undefined ? {} : { stdout }),
      ...(artifactDir === undefined ? {} : { artifactDir })
    }
  }

  const message =
    error !== undefined && error.message.length > 0
      ? error.message
      : describeExitCode(result.exitCode)

  return {
    id: stage.id,
    kind: stage.kind,
    status:
      stage.kind === 'blocking' && result.exitCode === 1
        ? 'gate-failed'
        : 'failed',
    ...(stdout === undefined ? {} : { stdout }),
    ...(artifactDir === undefined ? {} : { artifactDir }),
    ...(error === undefined ? {} : { errorCode: error.code }),
    message
  }
}

export const skippedStage = (
  stage: StageDefinition,
  message: string
): StageOutcome => ({
  id: stage.id,
  kind: stage.kind,
  status: 'skipped',
  message
})

/**
 * The job's exit code. Only the blocking stage is consulted, which is what makes
 * the advisory guarantee structural rather than a habit: an advisory outcome has
 * no representation here at all.
 */
export const jobExitCode = (outcomes: readonly StageOutcome[]): number => {
  const blocking = outcomes.filter((outcome) => outcome.kind === 'blocking')

  return blocking.some(
    (outcome) => outcome.status === 'gate-failed' || outcome.status === 'failed'
  )
    ? 1
    : 0
}
