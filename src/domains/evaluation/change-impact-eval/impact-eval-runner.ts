// Runs `impact check`'s engine over one hydrated change-impact case and shapes the
// result into a scorer input. Extracted from the CLI handler for the same reason
// `eval-case-runner.ts` is: the command handler stays thin, and the per-case
// failure policy lives in one readable place.
//
// It lives beside the corpus schema and the scorer it feeds rather than in
// `src/cli/`, because what it holds is the corpus's failure policy — the same
// answer-key freshness and coverage rules the scorer beside it applies — and not
// anything about parsing a command line.
//
// THE FAILURE POLICY IS THE POINT OF THIS FILE. A case that did not hydrate, a
// checkout that no longer matches the manifest it was built from, and an engine
// that threw are three different facts, and NONE of them is a score. Each returns
// an `unmeasured` outcome carrying its reason; the scorer keeps them out of every
// numerator and denominator and reports them as coverage. Scoring any of them as
// zero recall would publish a failure of the harness as a failure of the engine.

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { stableJsonDigest } from '../../../shared/json/stable-json-digest.js'
import {
  runChangeImpact,
  type ChangeImpactAgents
} from '../../change-impact/index.js'
// Sibling modules by path rather than through `evaluation`'s own barrel: a module
// inside a domain that imports its domain's barrel makes the barrel depend on
// itself through every other entry on it.
import type {
  ChangeImpactCaseInput,
  ChangeImpactCaseOutcome
} from './change-impact-scoring.js'
import type { ChangeImpactCorpusCase } from './change-impact-corpus.schema.js'
import { resolveExistingPathInsideRoot } from '../../../platform/path-service.js'
import { createRunContext } from '../../run-context/index.js'
import { normalizeError } from '../../../shared/errors/error-normalizer.js'
import type { Logger } from '../../observability/index.js'
import type { CodeReviewerConfig } from '../../../shared/contracts/index.js'

export const CHANGE_IMPACT_CASE_ARTIFACT_NAME = 'case.json'
export const CHANGE_IMPACT_CASE_WORK_TREE = 'repo'

// Accepted range for `eval impact --max-adjudication-calls`, which overrides
// `changeImpact.adjudication.maxCalls` for a measurement run.
//
// It MUST equal the config schema's own range: a flag range below it would reject
// a value the config allows, and one above it would be accepted by the parser and
// then rejected by config validation, after the run had already started. The
// schema lives in another domain's contract, so `impact-eval-runner.test.ts`
// probes the schema at both ends rather than trusting this copy.
export const changeImpactAdjudicationCallBounds = { min: 1, max: 500 } as const

// The reviewed surface P for one case: the change's own files, minus the paths the
// manifest deliberately excludes from review.
//
// Excluding them is not tidiness. A manifest records, for instance, that the
// updated unit tests "spell out the new anchoring convention the change
// introduces, which states the moved contract in assertions" — showing the engine
// those files would hand it the answer key, and the resulting recall figure would
// measure the leak rather than the capability. Deriving the exclusion from the
// manifest keeps the measured P identical to the declared P.
export const configForCase = (input: {
  readonly config: CodeReviewerConfig
  readonly corpusCase: ChangeImpactCorpusCase
}): CodeReviewerConfig => ({
  ...input.config,
  paths: {
    ...input.config.paths,
    exclude: [
      ...input.config.paths.exclude,
      ...input.corpusCase.excludedPaths
    ]
  }
})

// A hydrated case carries a copy of the case definition. Editing the manifest
// leaves every existing checkout describing the previous one, and spec 17 records
// what happens without this check: a published recall figure scored against an
// answer key that had since changed underneath it, which had to be voided.
//
// The commits are compared because they decide which bytes were reviewed; the
// answer key is compared because it decides what counts as correct. Nothing else
// is: a case gaining a tag or a note changes neither.
export const hydratedCaseMatchesManifest = (input: {
  readonly stored: Record<string, unknown>
  readonly corpusCase: ChangeImpactCorpusCase
}): { readonly matches: true } | { readonly matches: false; readonly detail: string } => {
  if (input.stored.headSha !== input.corpusCase.introducingCommit) {
    return {
      matches: false,
      detail: `the checkout is at ${String(input.stored.headSha)} but the manifest declares ${input.corpusCase.introducingCommit}`
    }
  }

  if (input.stored.baseSha !== input.corpusCase.parentCommit) {
    return {
      matches: false,
      detail: `the checkout's base is ${String(input.stored.baseSha)} but the manifest declares ${input.corpusCase.parentCommit}`
    }
  }

  const storedDigest = stableJsonDigest(input.stored.expectedImpact)
  const manifestDigest = stableJsonDigest(input.corpusCase.expectedImpact)

  if (storedDigest !== manifestDigest) {
    return {
      matches: false,
      detail:
        'the hydrated answer key differs from the manifest; re-hydrate before scoring'
    }
  }

  return { matches: true }
}

export type RunChangeImpactEvalCaseInput = {
  readonly repositoryRoot: string
  // Repository-relative root the corpus hydrated into.
  readonly caseRoot: string
  readonly corpusCase: ChangeImpactCorpusCase
  readonly config: CodeReviewerConfig
  readonly agents?: ChangeImpactAgents
  readonly logger?: Logger
}

const readStoredCase = async (
  casePath: string
): Promise<Record<string, unknown> | undefined> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(casePath, 'utf8'))

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export const runChangeImpactEvalCase = async (
  input: RunChangeImpactEvalCaseInput
): Promise<ChangeImpactCaseInput> => {
  const withOutcome = (
    outcome: ChangeImpactCaseOutcome
  ): ChangeImpactCaseInput => ({ corpusCase: input.corpusCase, outcome })
  const caseDirectory = path.posix.join(input.caseRoot, input.corpusCase.id)
  let workTreeDirectory: string
  let stored: Record<string, unknown> | undefined

  try {
    workTreeDirectory = await resolveExistingPathInsideRoot(
      input.repositoryRoot,
      path.posix.join(caseDirectory, CHANGE_IMPACT_CASE_WORK_TREE)
    )
    stored = await readStoredCase(
      await resolveExistingPathInsideRoot(
        input.repositoryRoot,
        path.posix.join(caseDirectory, CHANGE_IMPACT_CASE_ARTIFACT_NAME)
      )
    )
  } catch {
    return withOutcome({
      status: 'unmeasured',
      reason: 'not-hydrated',
      detail: `no hydrated checkout under ${caseDirectory}; run npm run eval:impact-corpus:hydrate`
    })
  }

  if (stored === undefined) {
    return withOutcome({
      status: 'unmeasured',
      reason: 'not-hydrated',
      detail: `${path.posix.join(caseDirectory, CHANGE_IMPACT_CASE_ARTIFACT_NAME)} is missing or unreadable`
    })
  }

  const freshness = hydratedCaseMatchesManifest({
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

  const config = configForCase({
    config: input.config,
    corpusCase: input.corpusCase
  })
  // The same mediated seam `impact check` supplies, from the same builder:
  // containment, the eligibility gate and redaction all apply, and the
  // change-impact domain still opens no file of its own.
  const runContext = createRunContext({
    repositoryRoot: workTreeDirectory,
    config
  })

  try {
    const report = await runChangeImpact({
      repositoryRoot: workTreeDirectory,
      config,
      // FORWARD, exactly as the corpus hydrated it: the parent is the base and the
      // introducing commit is the head. Reversing them would review the change
      // backwards and every expected line range would point at the wrong revision.
      baseRef: input.corpusCase.parentCommit,
      headRef: input.corpusCase.introducingCommit,
      ...(input.agents === undefined ? {} : { agents: input.agents }),
      readChangedFile: runContext.readChangedFile
    })

    return withOutcome({ status: 'scored', report })
  } catch (error) {
    const normalized = normalizeError(error, { source: 'repository' })

    input.logger?.warn(
      'Change-impact eval case failed; it is reported as unmeasured, not as zero.',
      { impact_case_id: input.corpusCase.id, code: normalized.code }
    )

    return withOutcome({
      status: 'unmeasured',
      reason: 'engine-error',
      detail: `${normalized.code}: ${normalized.message.slice(0, 400)}`
    })
  }
}
