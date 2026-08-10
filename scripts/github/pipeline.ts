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
  digestImpactReport,
  digestIntentReport,
  digestReviewReport,
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
  reviewStageDefinition,
  skippedStage,
  type StageOutcome,
  type StageResult
} from './stage-outcomes.js'
import {
  resolveNominatedFingerprints,
  resolveReviewConversationOutcomes,
  type ReviewConversationTrigger
} from './review-conversation.js'

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
  /**
   * Present when this run was triggered by a reply to a review comment (spec
   * 30), carrying only the id of the comment being replied to. `undefined` for
   * the ordinary push-triggered path, which behaves exactly as before.
   *
   * Nothing about the reply beyond this one number ever reaches here: not its
   * text, not its author, not its existence past this run. Resolving it
   * (`review-conversation.ts`) already parses only that field out of the
   * triggering event.
   */
  readonly reviewConversation?: ReviewConversationTrigger
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

  // Spec 30 requirement 6: a review-conversation-triggered run "MUST be
  // non-blocking and MUST NOT be configurable to block". Applied at every exit
  // below rather than only the last one, so a re-adjudication can never fail the
  // job through any path the ordinary push-triggered run can — including a
  // missing provider or a failed gate, neither of which the original finding
  // failed on either.
  const exitCodeFor = (exitCode: number): number =>
    dependencies.reviewConversation === undefined ? exitCode : 0

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
      exitCode: exitCodeFor(0),
      commentBody: renderSummaryComment({
        markerKey: options.markerKey,
        outcomes: [skippedStage(reviewStageDefinition, 'fork pull request')],
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
    const outcomes = [
      skippedStage(reviewStageDefinition, 'provider not configured')
    ]
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
      exitCode: exitCodeFor(CONFIGURATION_EXIT_CODE),
      commentBody: body,
      outcomes,
      notes: [message],
      posted: dependencies.api !== undefined,
      inlineCommentCount: 0
    }
  }

  // Spec 30: resolve what a reply nominated before this run does anything that
  // spends. A reply that does not target a finding this engine reported — no API
  // access to check it with, a deleted or unrelated comment, no finding marker on
  // the parent — nominates nothing, and this run has nothing to do. Checked here,
  // before the change-intent write and before any stage runs, so "nominates
  // nothing" costs one read of the pull request's existing comments and not a
  // review.
  let nominatedFingerprints: ReadonlySet<string> | undefined

  if (dependencies.reviewConversation !== undefined) {
    if (dependencies.api === undefined) {
      const message =
        'This run has no access to the pull request, so the reply that triggered it could not be resolved.'
      dependencies.log(message)

      return {
        exitCode: exitCodeFor(0),
        commentBody: '',
        outcomes: [],
        notes: [message],
        posted: false,
        inlineCommentCount: 0
      }
    }

    const { parentCommentId } = dependencies.reviewConversation
    const existingComments = await dependencies.api.listReviewComments(
      context.number
    )
    const parent = existingComments.find(
      (comment) => comment.id === parentCommentId
    )

    nominatedFingerprints = resolveNominatedFingerprints(parent?.body)

    if (nominatedFingerprints.size === 0) {
      const message =
        'This reply does not target a finding this engine reported, so nothing was re-checked.'
      dependencies.log(message)

      return {
        exitCode: exitCodeFor(0),
        commentBody: '',
        outcomes: [],
        notes: [message],
        posted: false,
        inlineCommentCount: 0
      }
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

  // One process for the whole push. `review` now runs the two advisory
  // reference lanes itself, in-process (`src/cli/advisory-lanes.ts`), so there
  // is only ever this one stage left to spawn and classify here.
  const reviewResult = await dependencies.runStage(
    stageArguments(reviewStageDefinition.command, context, options)
  )
  const reviewOutcome = classifyStageOutcome(reviewStageDefinition, reviewResult)
  const outcomes: readonly StageOutcome[] = [reviewOutcome]
  dependencies.log(`stage ${reviewOutcome.id}: ${reviewOutcome.status}`)

  // Present on a successful run (stdout) and on a run that failed after writing
  // partial artifacts (stderr), so a failed review is still summarized from its
  // report rather than reduced to an error code.
  const artifactDirectory = reviewOutcome.artifactDir

  let review: ReviewDigest | undefined
  let intent: IntentDigest | undefined
  let impact: ImpactDigest | undefined
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

    // Absent exactly when the lane did not run — disabled by config, or
    // guarded off after throwing. Either way `src/cli/advisory-lanes.ts` writes
    // no file, and the throwing case instead leaves a warning on
    // `review.warnings` (rendered from `report.json`, read above). Both cases
    // digest to `undefined` here and render no section below, exactly like a
    // stage that produced nothing.
    const impactJson = await dependencies.readArtifact(
      `${artifactDirectory}/impact-report.json`
    )
    impact = impactJson === undefined ? undefined : digestImpactReport(impactJson)

    const intentJson = await dependencies.readArtifact(
      `${artifactDirectory}/intent-report.json`
    )
    intent = intentJson === undefined ? undefined : digestIntentReport(intentJson)
  }

  // Inline comments are best-effort by construction. GitHub rejects a whole
  // review when any one comment does not land on a diff line it recognises, and
  // a summary comment that arrived is worth more than a review that did not, so
  // a failure here degrades to the summary rather than failing the job.
  let inlineCommentCount = 0
  // Findings an earlier push commented on that this run did not report again.
  // Undefined until the comparison is actually made, so it can never be rendered
  // as a computed zero it is not.
  let noLongerReportedCount: number | undefined

  if (dependencies.api !== undefined && review !== undefined) {
    const rendered = parseRenderedComments(renderedComments)

    try {
      // Fetched whether or not there is anything to post. The case this exists
      // for is a run with NOTHING to say — the author fixed everything — and
      // fetching only when there are comments to write would skip exactly that.
      const existing = await dependencies.api.listReviewComments(context.number)
      const existingMarkers = extractFindingMarkers(
        existing.map((comment) => comment.body)
      )
      const current = new Set(
        fingerprintsByFindingId(review.findings).values()
      )
      noLongerReportedCount = [...existingMarkers].filter(
        (marker) => !current.has(marker)
      ).length

      if (rendered.length > 0) {
        const plan = buildInlineComments({
          rendered,
          fingerprints: fingerprintsByFindingId(review.findings),
          existingMarkers,
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
      }
    } catch (error) {
      notes.push(
        `Inline comments could not be posted (${error instanceof Error ? error.message : 'unknown error'}). Every finding is listed in this comment instead.`
      )
    }
  }

  // Spec 30 requirement 3/4: state the outcome for each nominated finding as its
  // own statement. `nominatedFingerprints` is only ever set once it is already
  // non-empty (the early-return above sends the empty case home before this
  // point), so the sole remaining "nothing to report" case is a review that did
  // not complete at all — noted rather than guessed at, since there is no
  // finding data to compare against.
  const reviewConversationOutcomes =
    nominatedFingerprints === undefined
      ? undefined
      : review === undefined
        ? []
        : resolveReviewConversationOutcomes({
            nominatedFingerprints,
            findings: review.findings
          })

  if (nominatedFingerprints !== undefined && review === undefined) {
    notes.push(
      `${nominatedFingerprints.size} nominated finding${nominatedFingerprints.size === 1 ? '' : 's'} could not be re-checked because the review did not complete.`
    )
  }

  const body = renderSummaryComment({
    markerKey: options.markerKey,
    outcomes,
    ...(noLongerReportedCount === undefined
      ? {}
      : { noLongerReportedCount }),
    headSha: context.headSha,
    ...(review === undefined ? {} : { review }),
    ...(intent === undefined ? {} : { intent }),
    ...(impact === undefined ? {} : { impact }),
    ...(options.runUrl === undefined ? {} : { runUrl: options.runUrl }),
    ...(reviewConversationOutcomes === undefined ||
    reviewConversationOutcomes.length === 0
      ? {}
      : { reviewConversation: reviewConversationOutcomes }),
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
    exitCode: exitCodeFor(jobExitCode(outcomes)),
    commentBody: body,
    outcomes,
    notes,
    posted: dependencies.api !== undefined,
    inlineCommentCount
  }
}
