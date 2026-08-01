// Filesystem plumbing for writing a run's artifacts and maintaining the run
// index. Every path resolves through path-service under the repository root; the
// run index is best-effort bookkeeping that never fails a review whose artifacts
// are already durable.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot
} from '../platform/path-service.js'
import {
  detectPlatformTarget,
  parseRunIndex,
  readOriginRemoteUrl,
  renderRunIndexJson,
  renderRunSummaryJson,
  runIndexFileName,
  upsertRunIndexEntry,
  writeReportingArtifacts,
  type RunIndexEntry
} from '../domains/reporting/index.js'
import {
  runReview as runReviewPipeline,
  type PartialReviewRunState
} from '../domains/review-workflow/index.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'

/** Pretty-print a value as a trailing-newline JSON document for CLI output. */
export const jsonResult = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`

export const ensureDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true })
}

export const resolveArtifactWritePath = (
  repositoryRoot: string,
  artifactPath: string
): Promise<string> => resolveWritePathInsideRoot(repositoryRoot, artifactPath)

export const writeRunArtifact = async (
  repositoryRoot: string,
  artifactRoot: string,
  name: string,
  content: string
): Promise<void> => {
  await writeFile(
    await resolveArtifactWritePath(
      repositoryRoot,
      path.posix.join(artifactRoot, name)
    ),
    content
  )
}

export const readRunIndex = async (
  repositoryRoot: string,
  artifactDir: string
): Promise<string | undefined> => {
  try {
    return await readFile(
      await resolveExistingPathInsideRoot(
        repositoryRoot,
        path.posix.join(artifactDir, runIndexFileName)
      ),
      'utf8'
    )
  } catch {
    return undefined
  }
}

// Run directories are otherwise opaque and unenumerated, so nothing downstream
// can find the newest report. The index is bookkeeping: a failure to record a
// run must never fail a review that already produced its artifacts.
export const recordRunInIndex = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactDir: string
    readonly entry: RunIndexEntry
  }
): Promise<void> => {
  try {
    const index = parseRunIndex(
      await readRunIndex(input.repositoryRoot, input.artifactDir)
    )
    const indexPath = await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.artifactDir, runIndexFileName)
    )

    await ensureDirectory(path.dirname(indexPath))
    await writeFile(
      indexPath,
      renderRunIndexJson(upsertRunIndexEntry(index, input.entry))
    )
  } catch {
    // Bookkeeping only; the run's own artifacts are already durable.
  }
}

export const writeReviewArtifacts = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactRoot: string
    readonly report: Awaited<ReturnType<typeof runReviewPipeline>>['report']
    readonly contextLedger: Awaited<ReturnType<typeof runReviewPipeline>>['contextLedger']
    readonly sharedContext: Awaited<ReturnType<typeof runReviewPipeline>>['sharedContext']
    readonly observability: Awaited<ReturnType<typeof runReviewPipeline>>['observability']
    readonly config: CodeReviewerConfig
  }
): Promise<void> => {
  const runDirectory = await resolveArtifactWritePath(
    input.repositoryRoot,
    input.artifactRoot
  )
  await ensureDirectory(runDirectory)
  const reviewCommentsConfig = input.config.reporting.reviewComments
  // Platform detection reads env + the git origin remote only (no network). A
  // missing remote resolves to `generic`, which is normal, not an error.
  const reviewComments = reviewCommentsConfig.enabled
    ? {
        platform: detectPlatformTarget({
          configured: reviewCommentsConfig.platform,
          env: process.env,
          originRemoteUrl: await readOriginRemoteUrl(input.repositoryRoot)
        }).platform
      }
    : undefined
  await writeReportingArtifacts({
    report: input.report,
    formats: input.config.reporting.formats,
    sarif: input.config.reporting.sarif,
    ...(reviewComments === undefined ? {} : { reviewComments }),
    writer: (artifactPath, content) =>
      writeRunArtifact(
        input.repositoryRoot,
        input.artifactRoot,
        artifactPath,
        content
      )
  })
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'run-summary.json',
    renderRunSummaryJson(input.report.run)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'context-ledger.json',
    jsonResult(input.contextLedger)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'shared-context.json',
    jsonResult(input.sharedContext)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'observability.json',
    jsonResult(input.observability)
  )
}

// Artifact names for one `impact check` run. Prefixed rather than named
// `report.md`/`report.json` so a run directory can never present a reference
// report under the name every consumer here reads as a REVIEW report — the two
// are different schemas answering different questions, and `latestRunWithReport`
// resolves baselines from the latter.
export const IMPACT_MARKDOWN_ARTIFACT_NAME = 'impact-report.md'
export const IMPACT_JSON_ARTIFACT_NAME = 'impact-report.json'

// `impact check` is advisory and MUST exit 0 whatever it reports (spec 22), so
// this deliberately reuses the review writer's machinery and adds no failure path
// of its own: the caller treats a write failure as a note to the reader rather
// than as a result. The run is NOT recorded in the run index — the index feeds
// baseline resolution, which expects a review report, and an entry pointing at a
// reference report would hand `baseline write` a document of the wrong shape.
export const writeChangeImpactArtifacts = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactRoot: string
    readonly reportJson: string
    readonly reportMarkdown: string
  }
): Promise<void> => {
  await ensureDirectory(
    await resolveArtifactWritePath(input.repositoryRoot, input.artifactRoot)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    IMPACT_JSON_ARTIFACT_NAME,
    input.reportJson
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    IMPACT_MARKDOWN_ARTIFACT_NAME,
    input.reportMarkdown
  )
}

export const writePartialReviewArtifacts = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactRoot: string
    readonly partialState: PartialReviewRunState
  }
): Promise<void> => {
  const runDirectory = await resolveArtifactWritePath(
    input.repositoryRoot,
    input.artifactRoot
  )
  await ensureDirectory(runDirectory)
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'run-summary.json',
    renderRunSummaryJson(input.partialState.runSummary)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'context-ledger.json',
    jsonResult(input.partialState.contextLedger)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'shared-context.json',
    jsonResult(input.partialState.sharedContext)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'observability.json',
    jsonResult(input.partialState.observability)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'error.json',
    jsonResult({
      code: input.partialState.error.code,
      message: input.partialState.error.message,
      category: input.partialState.error.category,
      recoverable: input.partialState.error.recoverable
    })
  )
}
