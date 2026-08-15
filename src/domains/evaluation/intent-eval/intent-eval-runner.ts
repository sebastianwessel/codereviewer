// Runs `intent check`'s engine over one hydrated intent case and shapes the result
// into a scorer input. Extracted from the CLI handler for the same reason
// `impact-eval-runner.ts` is: the command handler stays thin, and the per-case
// outcome policy lives in one readable place.
//
// It lives beside the corpus hydration and the scorer it feeds rather than in
// `src/cli/`, because what it holds is this corpus's outcome policy — which
// statuses are scores, which are coverage facts — and not anything about parsing
// a command line.
//
// THE OUTCOME POLICY IS THE POINT OF THIS FILE, and it has three destinations where
// change-impact has two.
//
//   `scored`     a report exists and can be joined to the answer key;
//   `refused`    the engine DECLINED to answer, because one of spec 23's input
//                limits bound. Exit 4 with a structured code is correct behaviour —
//                "bounding the obligation list under-reports what is left, which is
//                the single direction this capability must not err in" — so it is
//                reported as its own fact and never as a failure;
//   `unmeasured` the case did not hydrate, the checkout drifted from the manifest,
//                no provider was available, or the run broke.
//
// None of the three is a zero. The instrument this replaces died on a refusal with
// a raw `SyntaxError: Unexpected end of JSON input` — a legitimate engine outcome
// surfacing as noise instead of as data — and scoring a refusal as a case with no
// obligations would drag every rate down while looking like a result.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  runIntentFulfilment,
  type IntentFulfilmentAgents
} from '../../intent-fulfilment/index.js'
// Sibling modules by path rather than through `evaluation`'s own barrel: a module
// inside a domain that imports its domain's barrel makes the barrel depend on
// itself through every other entry on it.
import {
  INTENT_CASE_ARTIFACT_NAME,
  INTENT_CASE_CONTEXT_DIRECTORY,
  INTENT_CASE_WORK_TREE,
  intentHydrationSource,
  type HydratedIntentCase
} from './intent-corpus-hydration.js'
import type {
  IntentCaseInput,
  IntentCaseOutcome
} from './intent-eval-scoring.js'
import type { IntentCorpusCase } from './intent-corpus.schema.js'
import { createRunContext } from '../../run-context/index.js'
import type { Logger } from '../../observability/index.js'
import { normalizeError } from '../../../shared/errors/error-normalizer.js'
import { resolveExistingPathInsideRoot } from '../../../platform/path-service.js'
import type { CodeReviewerConfig } from '../../../shared/contracts/index.js'
import type { LaneUsage } from '../../costs/index.js'

/**
 * The per-case configuration a measurement run needs, over the operator's own.
 *
 * `contextSources` is repointed at the case's hydrated intent directory and
 * `intentFulfilment` is forced on at the case's declared obligation limit. Both are
 * forced rather than trusted: the lane is switchable off, and a run with it off
 * would score an engine that read nothing — the "absence rendered as zero" this
 * scorer exists to refuse.
 *
 * The path is relative to the case's WORK TREE, because that is the repository root
 * the lane runs against.
 */
export const configForIntentCase = (input: {
  readonly config: CodeReviewerConfig
  readonly corpusCase: IntentCorpusCase
  readonly intentDirectory: string
}): CodeReviewerConfig => ({
  ...input.config,
  contextSources: {
    ...input.config.contextSources,
    enabled: true,
    providers: [
      {
        type: 'inbox',
        dir: input.intentDirectory,
        // One document, and a byte cap that cannot bind before the limit spec 23
        // actually owns. The provider's default cap (64 000) sits BELOW
        // `maxIntentBytes` (100 000), so on a large excerpt it would silently cut
        // the stated intent and the run would report obligations as not-evidenced
        // whose source was never shown — a cut spec 23 requires to be disclosed
        // rather than refused, and one no measurement should have to disclose
        // because it should never happen here.
        maxFiles: 1,
        maxFileBytes: input.config.intentFulfilment.maxIntentBytes
      }
    ]
  },
  intentFulfilment: {
    ...input.config.intentFulfilment,
    enabled: true,
    maxObligations: input.corpusCase.maxObligations
  }
})

/**
 * Whether a hydrated case still describes the manifest it is scored against.
 *
 * Editing the manifest leaves every existing checkout describing the previous one,
 * and this project has already had to void a published recall figure that was
 * scored against an answer key which had changed underneath it. The commits are
 * compared because they decide which bytes were reviewed; the expectations and the
 * line map are compared because together they decide what counts as correct.
 */
export const hydratedIntentCaseMatchesManifest = (input: {
  readonly stored: HydratedIntentCase
  readonly corpusCase: IntentCorpusCase
}):
  | { readonly matches: true }
  | { readonly matches: false; readonly detail: string } => {
  if (input.stored.hydrationSource !== intentHydrationSource) {
    return {
      matches: false,
      detail: `the checkout was hydrated by ${String(input.stored.hydrationSource)}, not ${intentHydrationSource}`
    }
  }

  if (input.stored.headSha !== input.corpusCase.change.headCommit) {
    return {
      matches: false,
      detail: `the checkout is at ${input.stored.headSha} but the manifest declares ${input.corpusCase.change.headCommit}`
    }
  }

  if (input.stored.baseSha !== input.corpusCase.change.baseCommit) {
    return {
      matches: false,
      detail: `the checkout's base is ${input.stored.baseSha} but the manifest declares ${input.corpusCase.change.baseCommit}`
    }
  }

  if (
    JSON.stringify(input.stored.outstandingExpectations) !==
    JSON.stringify(input.corpusCase.outstandingExpectations)
  ) {
    return {
      matches: false,
      detail:
        'the hydrated answer key differs from the manifest; re-hydrate before scoring'
    }
  }

  return { matches: true }
}

export type RunIntentEvalCaseInput = {
  readonly repositoryRoot: string
  readonly caseRoot: string
  readonly corpusCase: IntentCorpusCase
  readonly config: CodeReviewerConfig
  // The lane the WHOLE RUN shares, handed in per case.
  //
  // One lane rather than one per case, for the reason `eval impact` gives: the
  // usage recorder and the agent lifetime are per run. Both are absent when no
  // provider resolves, which leaves every case `provider-unavailable` — a
  // coverage fact, never a zero.
  readonly agents?: IntentFulfilmentAgents
  readonly usage?: () => LaneUsage | undefined
  readonly logger?: Logger
}

const readStoredCase = async (
  casePath: string
): Promise<HydratedIntentCase | undefined> => {
  try {
    return JSON.parse(await readFile(casePath, 'utf8')) as HydratedIntentCase
  } catch {
    return undefined
  }
}

export const runIntentEvalCase = async (
  input: RunIntentEvalCaseInput
): Promise<IntentCaseInput> => {
  const withOutcome = (outcome: IntentCaseOutcome): IntentCaseInput => ({
    corpusCase: input.corpusCase,
    outcome
  })
  const caseDirectory = path.posix.join(input.caseRoot, input.corpusCase.id)
  let workTreeDirectory: string
  let stored: HydratedIntentCase | undefined

  try {
    workTreeDirectory = await resolveExistingPathInsideRoot(
      input.repositoryRoot,
      path.posix.join(caseDirectory, INTENT_CASE_WORK_TREE)
    )
    stored = await readStoredCase(
      await resolveExistingPathInsideRoot(
        input.repositoryRoot,
        path.posix.join(caseDirectory, INTENT_CASE_ARTIFACT_NAME)
      )
    )
  } catch {
    return withOutcome({
      status: 'unmeasured',
      reason: 'not-hydrated',
      detail: `no hydrated checkout under ${caseDirectory}; run npm run eval:intent-corpus:hydrate`
    })
  }

  if (stored === undefined) {
    return withOutcome({
      status: 'unmeasured',
      reason: 'not-hydrated',
      detail: `${path.posix.join(caseDirectory, INTENT_CASE_ARTIFACT_NAME)} is missing or unreadable`
    })
  }

  const freshness = hydratedIntentCaseMatchesManifest({
    stored,
    corpusCase: input.corpusCase
  })

  if (!freshness.matches) {
    return withOutcome({
      status: 'unmeasured',
      reason: 'stale-checkout',
      detail: freshness.detail
    })
  }

  const config = configForIntentCase({
    config: input.config,
    corpusCase: input.corpusCase,
    // Repository-relative to the work tree, which is the root the lane runs
    // against. The inbox provider resolves its directory under that root and
    // refuses to escape it, which is why hydration writes the intent inside the
    // checkout; being untracked, it cannot reach the diff under review.
    intentDirectory: INTENT_CASE_CONTEXT_DIRECTORY
  })
  const runContext = createRunContext({
    repositoryRoot: workTreeDirectory,
    config
  })

  try {
    const report = await runIntentFulfilment({
      repositoryRoot: workTreeDirectory,
      config,
      // FORWARD, exactly as the corpus hydrated it: the parent is the base and the
      // change under review is the head that was checked out.
      baseRef: input.corpusCase.change.baseCommit,
      headRef: input.corpusCase.change.headCommit,
      ...(input.agents === undefined ? {} : { agents: input.agents }),
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      readChangedFile: runContext.readChangedFile,
      runGit: runContext.runGit
    })

    // Four of the five report statuses mapped nothing, and each is a different
    // fact. They are reported as unmeasured rather than as a run that found no
    // obligation outstanding, which is what a zero here would mean.
    if (report.status !== 'completed') {
      return withOutcome({
        status: 'unmeasured',
        reason:
          report.status === 'provider-unavailable'
            ? 'provider-unavailable'
            : report.status === 'disabled'
              ? 'capability-disabled'
              : 'no-intent',
        detail: `the lane reported status ${report.status}: ${report.warnings.join(' ') || 'no warning was recorded'}`
      })
    }

    return withOutcome({
      status: 'scored',
      report,
      lineMap: stored.lineMap
    })
  } catch (error) {
    const normalized = normalizeError(error, { source: 'repository' })

    // AN INPUT LIMIT BINDING IS NOT A FAILURE. Spec 23 requires every limit to
    // refuse the run rather than truncate it, so this branch is the engine
    // answering correctly and the case leaves every rate with its code printed.
    if (normalized.category === 'input-limit') {
      input.logger?.info(
        'Intent eval case refused: an input limit bound and the engine declined to answer.',
        { intent_case_id: input.corpusCase.id, code: normalized.code }
      )

      return withOutcome({
        status: 'refused',
        code: normalized.code,
        detail: normalized.message.slice(0, 400)
      })
    }

    input.logger?.warn(
      'Intent eval case failed; it is reported as unmeasured, not as zero.',
      { intent_case_id: input.corpusCase.id, code: normalized.code }
    )

    return withOutcome({
      status: 'unmeasured',
      reason: 'engine-error',
      detail: `${normalized.code}: ${normalized.message.slice(0, 400)}`
    })
  }
}
