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
// The artifact filenames are the CLI's, imported rather than re-typed: the review
// command writes them and this pipeline reads them, and a third copy of the string
// would break the Impact/Intent sections silently and permanently.
import {
  IMPACT_JSON_ARTIFACT_NAME,
  INTENT_JSON_ARTIFACT_NAME
} from '../../src/cli/run-artifacts.js'
import {
  REVIEW_JSON_ARTIFACT_NAME,
  reviewCommentsArtifactName
} from '../../src/domains/reporting/index.js'
import type { PlatformTarget } from '../../src/shared/contracts/index.js'
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
  ReportShapeError,
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

// The platform whose rendered review comments this pipeline reads back.
//
// It is `github` by construction — this module posts to GitHub — but the FILE is
// named by the producer from the platform the RUN was configured with, and the two
// meet only because the shipped config (`codereviewer.github.json`) pins
// `reporting.reviewComments.platform` to the same value. That was previously a
// hard-coded `review-comments.github.json` here against a
// `review-comments.${platform}.json` there: if the config ever stopped pinning it,
// this read would find nothing, `?? ''` would turn that into an empty comment set,
// and the run would post no inline comments while reporting success. The name now
// comes from the producer's own derivation, and `pipeline.test.ts` asserts the
// shipped config still pins this platform.
export const REVIEW_COMMENT_PLATFORM: PlatformTarget = 'github'

/**
 * Reads one artifact of this run and digests it, or records why it could not.
 *
 * THREE OUTCOMES, AND THEY MUST STAY THREE. An absent file is the ordinary case —
 * a lane that was switched off writes nothing — and renders no section, silently
 * and correctly. A file that IS there and cannot be read is a defect in this
 * integration, and it returns the same `undefined` as far as rendering goes but
 * leaves a note behind. Collapsing the second into the first is what kept the
 * Impact section missing from every comment for months.
 *
 * The digest's own message is the note, verbatim: it is written for the reader of
 * the pull request, and rewording it here would put the sentence a human sees two
 * files away from the check that produces it.
 */
const digestArtifact = async <T>(
  input: {
    readonly readArtifact: (path: string) => Promise<string | undefined>
    readonly path: string
    readonly digest: (raw: string) => T
  },
  notes: string[]
): Promise<T | undefined> => {
  const raw = await input.readArtifact(input.path)

  if (raw === undefined) {
    return undefined
  }

  try {
    return input.digest(raw)
  } catch (error) {
    if (!(error instanceof ReportShapeError)) {
      throw error
    }

    notes.push(error.message)

    return undefined
  }
}

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
  dependencies.log(`stage ${reviewOutcome.id}: ${reviewOutcome.status}`)

  // Present on a successful run (stdout) and on a run that failed after writing
  // partial artifacts (stderr), so a failed review is still summarized from its
  // report rather than reduced to an error code.
  const artifactDirectory = reviewOutcome.artifactDir

  let review: ReviewDigest | undefined
  let intent: IntentDigest | undefined
  let impact: ImpactDigest | undefined
  let renderedComments = ''

  // Notes left by an artifact this run wrote that this build could not read. Kept
  // apart from `notes` while the artifacts are read so the review report's own
  // failure can be recognised below; both end up in the same list.
  const unreadableArtifactNotes: string[] = []
  // The review report is the one artifact whose failure changes more than its own
  // section, so it is recorded as it happens rather than recovered from the notes
  // afterwards. It is read first, which is what makes the check below exact.
  let reviewReportUnreadable = false

  if (artifactDirectory !== undefined) {
    review = await digestArtifact(
      {
        readArtifact: dependencies.readArtifact,
        path: `${artifactDirectory}/${REVIEW_JSON_ARTIFACT_NAME}`,
        digest: digestReviewReport
      },
      unreadableArtifactNotes
    )
    reviewReportUnreadable = unreadableArtifactNotes.length > 0
    renderedComments =
      (await dependencies.readArtifact(
        `${artifactDirectory}/${reviewCommentsArtifactName(REVIEW_COMMENT_PLATFORM)}`
      )) ?? ''

    // Absent exactly when the lane did not run — disabled by config, or
    // guarded off after throwing. Either way `src/cli/advisory-lanes.ts` writes
    // no file, and the throwing case instead leaves a warning on
    // `review.warnings` (rendered from `report.json`, read above). Both cases
    // render no section below, exactly like a stage that produced nothing — and
    // both are distinct from a file that IS there and does not parse, which is
    // reported rather than rendered as absence.
    impact = await digestArtifact(
      {
        readArtifact: dependencies.readArtifact,
        path: `${artifactDirectory}/${IMPACT_JSON_ARTIFACT_NAME}`,
        digest: digestImpactReport
      },
      unreadableArtifactNotes
    )

    intent = await digestArtifact(
      {
        readArtifact: dependencies.readArtifact,
        path: `${artifactDirectory}/${INTENT_JSON_ARTIFACT_NAME}`,
        digest: digestIntentReport
      },
      unreadableArtifactNotes
    )
  }

  notes.push(...unreadableArtifactNotes)

  // A review whose own report cannot be read did not deliver a review, whatever
  // its exit code said, and the headline is where that has to be told: left as a
  // passing stage, the one line every reader is guaranteed to see would say "this
  // search reported nothing" over a run that may have found several defects. The
  // stage is therefore reported as one that could not complete, and the reason
  // travels with it into the stage table.
  //
  // Only the review report does this. An unreadable impact or intent report costs
  // its own section and nothing else: those lanes are advisory, and downgrading
  // the blocking stage on their account would misreport what the review did.
  const outcomes: readonly StageOutcome[] = [
    reviewReportUnreadable
      ? {
          ...reviewOutcome,
          status: 'failed',
          message:
            'The review ran, but the report it wrote could not be read by this workflow.'
        }
      : reviewOutcome
  ]

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

  // An artifact this run wrote that this run cannot read fails the job, and the
  // comment is posted anyway — the same shape as the missing-provider exit above,
  // and for the same reason: the review is not what went wrong, the integration
  // is, and a red check is the only part of this that an operator sees without
  // opening a pull request. It is reported as a configuration error rather than
  // as a gate failure because that is what it is; the gate's own result is in the
  // comment either way.
  //
  // This does not make the advisory lanes blocking. Spec 22 and spec 23 forbid
  // them failing a pipeline ON WHAT THEY FIND, and spec 23 draws the line
  // explicitly: refusing input it cannot fully see "is not failing a pipeline on
  // FULFILMENT grounds; it is the same class as the configuration and repository
  // errors this command already exits on". Nothing here is a judgement about the
  // change. `exitCodeFor` still zeroes it for a review-conversation run, which
  // spec 30 requires be non-blocking through every path.
  const exitCode =
    unreadableArtifactNotes.length > 0
      ? CONFIGURATION_EXIT_CODE
      : jobExitCode(outcomes)

  return {
    exitCode: exitCodeFor(exitCode),
    commentBody: body,
    outcomes,
    notes,
    posted: dependencies.api !== undefined,
    inlineCommentCount
  }
}
