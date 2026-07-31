// The workflow, as one testable function.
//
// Everything that touches the outside world — spawning the CLI, reading an
// artifact, writing the inbox file, calling GitHub — arrives as an injected
// dependency, so the whole pipeline (including the fork path, the missing-key
// path, the provider-error path and the gate-failure path) is exercised by unit
// tests against fixtures without a process, a filesystem or a network.
//
// The YAML that calls this is deliberately almost empty. A workflow whose logic
// lives in inline shell cannot be tested at all, and the failure modes this
// integration has to get right — a fork PR, an unset secret, a provider outage,
// a failing gate — are exactly the ones nobody exercises by hand.
import type { GithubApi } from './github-api.js'
import type { PullRequestContext } from './pull-request-context.js'
import {
  CHANGE_INTENT_FILE_NAME,
  renderChangeIntentDocument
} from './change-intent-inbox.js'
import { checkProviderCredentials } from './provider-credentials.js'
import {
  digestConformanceReport,
  digestImpactReport,
  digestIntentReport,
  digestReviewReport,
  type ConformanceDigest,
  type ImpactDigest,
  type IntentDigest,
  type ReviewDigest
} from './report-digest.js'
import {
  buildInlineComments,
  extractFindingMarkers,
  fingerprintsByFindingId,
  parseRenderedComments
} from './inline-review.js'
import {
  renderSummaryComment,
  selectSummaryComment,
  summaryCommentMarker
} from './summary-comment.js'
import {
  classifyStageOutcome,
  jobExitCode,
  skippedStage,
  stageDefinitions,
  type StageOutcome,
  type StageResult
} from './stage-outcomes.js'

export type PipelineOptions = {
  /** Identifies the comment this workflow owns. One key, one comment. */
  readonly markerKey: string
  /** `--config` passed to every stage, when the workflow pins one. */
  readonly configPath?: string
  readonly maxInlineComments: number
  /** Link to the workflow run, for the comment's artifact pointer. */
  readonly runUrl?: string
  /**
   * Login of the identity the token acts as, used to make sure a previous
   * comment is one of ours before editing it. `github-actions[bot]` for the
   * default token.
   */
  readonly commentAuthorLogin?: string
}

export type PipelineDependencies = {
  readonly context: PullRequestContext
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly options: PipelineOptions
  /** Runs one CLI invocation. Arguments are passed as an array; never a shell string. */
  readonly runStage: (args: readonly string[]) => Promise<StageResult>
  /** Reads a run artifact by repository-relative path. */
  readonly readArtifact: (path: string) => Promise<string | undefined>
  /** Writes the change-intent inbox file. */
  readonly writeChangeIntent: (
    fileName: string,
    content: string
  ) => Promise<void>
  /**
   * The GitHub client, or `undefined` when this run cannot write to the pull
   * request. Absent means the pipeline still produces a body — the caller writes
   * it to the job summary — but posts nothing.
   */
  readonly api?: GithubApi
  readonly log: (message: string) => void
}

export type PipelineResult = {
  readonly exitCode: number
  readonly commentBody: string
  readonly outcomes: readonly StageOutcome[]
  readonly notes: readonly string[]
  readonly posted: boolean
  readonly inlineCommentCount: number
}

const CONFIGURATION_EXIT_CODE = 2

const stageArguments = (
  command: readonly string[],
  context: PullRequestContext,
  options: PipelineOptions
): readonly string[] => [
  ...command,
  '--base-ref',
  `origin/${context.baseRef}`,
  '--head-ref',
  'HEAD',
  ...(options.configPath === undefined ? [] : ['--config', options.configPath])
]

/**
 * Posts the summary comment, creating it on the first run of a pull request and
 * editing the same comment on every run after that.
 */
const upsertSummaryComment = async (
  api: GithubApi,
  input: {
    readonly pullNumber: number
    readonly markerKey: string
    readonly authorLogin?: string
    readonly body: string
  }
): Promise<void> => {
  const marker = summaryCommentMarker(input.markerKey)
  const existing = selectSummaryComment(
    await api.listIssueComments(input.pullNumber),
    marker,
    input.authorLogin
  )

  if (existing === undefined) {
    await api.createIssueComment(input.pullNumber, input.body)
    return
  }

  await api.updateIssueComment(existing.id, input.body)
}

export const runPipeline = async (
  dependencies: PipelineDependencies
): Promise<PipelineResult> => {
  const { context, options } = dependencies
  const notes: string[] = []

  // A fork pull request on a `pull_request` trigger gets no secrets and a
  // read-only token, so neither the provider call nor the comment write can
  // succeed. `pull_request_target` would supply both — and would run the fork's
  // code with them, which is the vulnerability this workflow declines to have.
  // Reported plainly and left green: a fork PR is not a failing PR, it is an
  // unreviewed one, and a maintainer re-runs it from a branch.
  if (context.fromFork) {
    const message =
      'This pull request comes from a fork. GitHub withholds repository secrets and write access from fork pull requests, so the review cannot run and no comment can be posted. Re-run it from a branch in this repository, or review it locally.'
    dependencies.log(message)

    return {
      exitCode: 0,
      commentBody: renderSummaryComment({
        markerKey: options.markerKey,
        outcomes: stageDefinitions.map((stage) =>
          skippedStage(stage, 'fork pull request')
        ),
        headSha: context.headSha,
        ...(options.runUrl === undefined ? {} : { runUrl: options.runUrl }),
        notes: [message]
      }),
      outcomes: [],
      notes: [message],
      posted: false,
      inlineCommentCount: 0
    }
  }

  const credentials = checkProviderCredentials(dependencies.environment)

  if (!credentials.ready) {
    // Not a silent pass. Without a model the engine still exits 0 and reports
    // nothing, so a workflow wired as a required check would go green forever
    // while reviewing nothing at all.
    const message = `The review engine has no usable model provider, so nothing was reviewed. Set: ${credentials.missing.join(', ')}. See docs/04-guides/github-integration.md.`
    const outcomes = stageDefinitions.map((stage) =>
      skippedStage(stage, 'provider not configured')
    )
    const body = renderSummaryComment({
      markerKey: options.markerKey,
      outcomes,
      headSha: context.headSha,
      ...(options.runUrl === undefined ? {} : { runUrl: options.runUrl }),
      notes: [message]
    })

    dependencies.log(message)

    if (dependencies.api !== undefined) {
      await upsertSummaryComment(dependencies.api, {
        pullNumber: context.number,
        markerKey: options.markerKey,
        ...(options.commentAuthorLogin === undefined
          ? {}
          : { authorLogin: options.commentAuthorLogin }),
        body
      })
    }

    return {
      exitCode: CONFIGURATION_EXIT_CODE,
      commentBody: body,
      outcomes,
      notes: [message],
      posted: dependencies.api !== undefined,
      inlineCommentCount: 0
    }
  }

  // The pull-request title and description become the change-intent brief
  // (spec 11). This is the difference between a generic reviewer and one that
  // can check the change against what the author said it would do — and it is
  // what gives `intent check` anything to read.
  const intentDocument = renderChangeIntentDocument({
    number: context.number,
    title: context.title,
    body: context.body,
    url: context.url,
    baseRef: context.baseRef
  })

  if (intentDocument === undefined) {
    notes.push(
      'The pull request has no title or description, so the review ran without stated change intent.'
    )
  } else {
    await dependencies.writeChangeIntent(
      CHANGE_INTENT_FILE_NAME,
      intentDocument
    )
  }

  const outcomes: StageOutcome[] = []

  for (const stage of stageDefinitions) {
    const result = await dependencies.runStage(
      stageArguments(stage.command, context, options)
    )
    const outcome = classifyStageOutcome(stage, result)
    outcomes.push(outcome)
    dependencies.log(`stage ${stage.id}: ${outcome.status}`)
  }

  // Present on a successful run (stdout) and on a run that failed after writing
  // partial artifacts (stderr), so a failed review is still summarized from its
  // report rather than reduced to an error code.
  const artifactDirectory = outcomes.find(
    (outcome) => outcome.id === 'review'
  )?.artifactDir

  let review: ReviewDigest | undefined
  let renderedComments = ''

  if (artifactDirectory !== undefined) {
    const reportJson = await dependencies.readArtifact(
      `${artifactDirectory}/report.json`
    )
    review = reportJson === undefined ? undefined : digestReviewReport(reportJson)
    renderedComments =
      (await dependencies.readArtifact(
        `${artifactDirectory}/review-comments.github.json`
      )) ?? ''
  }

  const digestOf = <T>(
    id: string,
    digest: (raw: string) => T | undefined
  ): T | undefined => {
    const outcome = outcomes.find((entry) => entry.id === id)

    return outcome === undefined || outcome.stdout === undefined
      ? undefined
      : digest(JSON.stringify(outcome.stdout))
  }

  const intent = digestOf<IntentDigest>('intent', digestIntentReport)
  const impact = digestOf<ImpactDigest>('impact', digestImpactReport)
  const conformance = digestOf<ConformanceDigest>(
    'conformance',
    digestConformanceReport
  )

  // Inline comments are best-effort by construction. GitHub rejects a whole
  // review when any one comment does not land on a diff line it recognises, and
  // a summary comment that arrived is worth more than a review that did not, so
  // a failure here degrades to the summary rather than failing the job.
  let inlineCommentCount = 0

  if (
    dependencies.api !== undefined &&
    review !== undefined &&
    renderedComments.length > 0
  ) {
    const rendered = parseRenderedComments(renderedComments)

    if (rendered.length > 0) {
      try {
        const existing = await dependencies.api.listReviewComments(context.number)
        const plan = buildInlineComments({
          rendered,
          fingerprints: fingerprintsByFindingId(review.findings),
          existingMarkers: extractFindingMarkers(
            existing.map((comment) => comment.body)
          ),
          maxComments: options.maxInlineComments
        })

        if (plan.comments.length > 0) {
          await dependencies.api.createReview({
            pullNumber: context.number,
            commitId: context.headSha,
            comments: plan.comments
          })
          inlineCommentCount = plan.comments.length
        }

        if (plan.overCap > 0) {
          notes.push(
            `${plan.overCap} inline comments were not posted because the per-run limit of ${options.maxInlineComments} was reached; they are listed below and in the artifacts.`
          )
        }
      } catch (error) {
        notes.push(
          `Inline comments could not be posted (${error instanceof Error ? error.message : 'unknown error'}). Every finding is listed in this comment instead.`
        )
      }
    }
  }

  const body = renderSummaryComment({
    markerKey: options.markerKey,
    outcomes,
    headSha: context.headSha,
    ...(review === undefined ? {} : { review }),
    ...(intent === undefined ? {} : { intent }),
    ...(impact === undefined ? {} : { impact }),
    ...(conformance === undefined ? {} : { conformance }),
    ...(options.runUrl === undefined ? {} : { runUrl: options.runUrl }),
    inlineCommentCount,
    notes
  })

  if (dependencies.api !== undefined) {
    await upsertSummaryComment(dependencies.api, {
      pullNumber: context.number,
      markerKey: options.markerKey,
      ...(options.commentAuthorLogin === undefined
        ? {}
        : { authorLogin: options.commentAuthorLogin }),
      body
    })
  }

  return {
    exitCode: jobExitCode(outcomes),
    commentBody: body,
    outcomes,
    notes,
    posted: dependencies.api !== undefined,
    inlineCommentCount
  }
}
