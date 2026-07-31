// Composition for one `intent check` run.
//
// It reuses repository intake, the mediated context retriever, and — this is the
// requirement, not a convenience — spec 11's change-intent ingestion. Spec 23:
// "The change-intent input already exists. Spec 11 ingests external context from
// bounded providers, redacts it, and injects it as a context-only `change-intent`
// document. That ingestion MUST be reused, not reimplemented." So the fragments
// below come from `gatherContextFragments`, the same call `review`'s change-intent
// document is built from, with the same providers and the same redaction. There is
// no provider composition and no redaction in this domain.
//
// What is deliberately NOT reused is the BRIEF. Spec 23 again: "Obligations MUST
// be extracted from the redacted change-intent fragments, not from the summarised
// brief. The brief is a paraphrase, and a citation into a paraphrase does not
// identify where in the stated intent an obligation came from."
//
// This domain performs no filesystem access, no git access and no provider call of
// its own: the caller supplies a mediated reader and the model runners, which is
// what the import-boundary test in this folder enforces.

import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { gatherContextFragments } from '../context-ingestion/index.js'
import type { LaneUsage } from '../costs/index.js'
import {
  collectRepositoryIntake,
  parseRemovedLines,
  type DiffMap,
  type GitCommandRunner,
  type RepositoryIntake
} from '../repository-intake/index.js'
import {
  intentChangeTooLargeError,
  intentTooLargeError,
  tooManyObligationsError
} from './intent-limits.js'
import {
  citationAptnessInputFor,
  isCitationConcern,
  type CitationAptness,
  type CitationAptnessRunner
} from './aptness.js'
import {
  collectChangeSurface,
  type ChangeSurface,
  type ChangeSurfaceSourceFile
} from './change-surface.js'
import {
  fulfilmentExplanationInputFor,
  type FulfilmentExplanationRunner
} from './explanation.js'
import {
  IntentFulfilmentReportSchema,
  type ExtraScopeEntry,
  type IntentFulfilmentReport,
  type Obligation
} from './intent-fulfilment-report.js'
import {
  fulfilmentJudgementInputFor,
  verifyJudgement,
  type FulfilmentJudgement,
  type FulfilmentJudgementRunner
} from './judgement.js'
import {
  obligationExtractionInputFor,
  type ObligationExtractionRunner
} from './obligation-extraction.js'
import { resolveIntentCitation, toIntentSources } from './intent-sources.js'

export type IntentFulfilmentAgents = {
  readonly extractObligations: ObligationExtractionRunner
  readonly judge: FulfilmentJudgementRunner
  // Spec 23's Second Amendment. REQUIRED, deliberately. It was optional for one
  // iteration and three separate wiring sites silently omitted it — the lane, the
  // CLI, and the run's own guard — so the stage never executed while every test
  // passed and the report claimed a clean `inaptCitationCount: 0`. An optional
  // stage on an agents contract is a stage that can be dropped without anything
  // failing; required makes each omission a compile error instead.
  readonly checkAptness: CitationAptnessRunner
  readonly explain: FulfilmentExplanationRunner
}

export type RunIntentFulfilmentInput = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly baseRef?: string
  readonly headRef?: string
  readonly generatedAt?: Date
  // Reads the head-side content of a changed file. Supplied by the caller so this
  // domain never opens a file handle; `intent check` passes the mediated context
  // retriever's read.
  readonly readChangedFile: (path: string) => Promise<string | undefined>
  // The three model seams. Absent runs no call at all and reports
  // `provider-unavailable`. A seam rather than a provider resolved in here,
  // because a composition that resolves its own provider cannot be driven
  // hermetically, and every control test for this layer has to be.
  readonly agents?: IntentFulfilmentAgents
  // Token usage and cost, read ONCE after the calls finish. Supplied by the same
  // wiring that supplies the agents, which owns the usage recorder and the price
  // table.
  readonly usage?: () => LaneUsage | undefined
  // Git seam, passed straight through to intake, which owns and validates every
  // git invocation. Present only so a test can drive this composition
  // hermetically; production leaves it unset. This domain never invokes git.
  readonly runGit?: GitCommandRunner
  readonly signal?: AbortSignal
}

const DISABLED_WARNING =
  'Intent-fulfilment review is disabled. Set intentFulfilment.enabled to true to run it.'

const NO_CONTEXT_SOURCES_WARNING =
  'No change-intent source is configured, so there is no stated intent to check the change against. Configure contextSources to supply one.'

const NO_INTENT_WARNING =
  'The configured change-intent sources produced no text, so there is no stated intent to check the change against.'

const NO_PROVIDER_WARNING =
  'Intent-fulfilment review is enabled but no model was available to read the stated intent; no obligations were extracted.'

const UNUSABLE_INTENT_WARNING =
  'No checkable obligation could be read from the stated intent. A short or purely descriptive intent is the ordinary reason.'

const EXTRACTION_FAILED_WARNING =
  'The obligation extraction call did not complete; no obligations were extracted.'

const diffMapsByPath = (
  intake: RepositoryIntake
): ReadonlyMap<string, DiffMap> =>
  new Map(intake.diffMaps.map((diffMap) => [diffMap.path, diffMap] as const))

// Reads the head side of every changed file through the caller's mediated reader,
// and pairs it with the lines the change REMOVED.
//
// The removed lines come from the raw diff intake already holds, so no extra git
// subcommand and no second filesystem read is needed. They matter because spec
// 23's 2026-07-30 amendment lets an addressed obligation cite a removed line:
// without them a deletion is unprovable, and every "remove X" obligation on a
// real revert commit came back wrong.
const collectSourceFiles = async (
  intake: RepositoryIntake,
  readChangedFile: RunIntentFulfilmentInput['readChangedFile']
): Promise<{
  readonly files: readonly ChangeSurfaceSourceFile[]
  readonly unreadableFileCount: number
}> => {
  const byPath = diffMapsByPath(intake)
  const removedByPath = parseRemovedLines(intake.rawDiff)
  const files: ChangeSurfaceSourceFile[] = []
  let unreadableFileCount = 0

  for (const changedFile of intake.changedFiles) {
    const diffMap = byPath.get(changedFile.path)

    if (diffMap === undefined) {
      continue
    }

    const content = await readChangedFile(changedFile.path)

    if (content === undefined) {
      unreadableFileCount += 1
      continue
    }

    const removedLines = removedByPath.get(changedFile.path) ?? []

    files.push({
      path: changedFile.path,
      content,
      hunks: diffMap.hunks,
      ...(removedLines.length === 0 ? {} : { removedLines }),
      isNewFile: diffMap.changeKind === 'new'
    })
  }

  return { files, unreadableFileCount }
}

// Changed files no obligation's evidence cites.
//
// Spec 23 requires extra scope to be reported NEUTRALLY: a change doing more than
// the ticket asked is normal and often desirable. So this is a set difference over
// paths and nothing more — there is no threshold, no judgement, and nowhere in
// `ExtraScopeEntrySchema` to record one.
const collectExtraScope = (
  surface: ChangeSurface,
  obligations: readonly Obligation[]
): readonly ExtraScopeEntry[] => {
  const cited = new Set(
    obligations.flatMap((obligation) =>
      obligation.status === 'addressed'
        ? obligation.evidence.map((citation) => citation.path)
        : []
    )
  )

  return surface.files
    .filter((file) => !cited.has(file.path))
    .map((file) => ({
      path: file.path,
      changedLineCount: file.changedLines.length
    }))
}

type EmptyReportInput = {
  readonly status: 'disabled' | 'no-intent' | 'unusable-intent' | 'provider-unavailable'
  readonly baseRef: string
  readonly headRef: string
  readonly generatedAt: Date
  readonly warnings: readonly string[]
  readonly changedFileCount?: number
  readonly intentFragmentCount?: number
  readonly intentOrigins?: readonly string[]
  readonly uncitedObligationCount?: number
  // Present on the paths reached AFTER the extraction call: it spent tokens even
  // though there is no mapping to show for them, and a run that cost money must
  // say so.
  readonly usage?: LaneUsage | undefined
}

// The four outcomes that produce no mapping. They are separate statuses rather
// than one empty `completed` report because spec 23 requires absent or unusable
// intent to be reported PLAINLY: "Most changes will have thin descriptions."
const emptyReport = (input: EmptyReportInput): IntentFulfilmentReport =>
  IntentFulfilmentReportSchema.parse({
    schemaVersion: '1.0',
    status: input.status,
    generatedAt: input.generatedAt.toISOString(),
    scope: {
      baseRef: input.baseRef,
      headRef: input.headRef,
      changedFileCount: input.changedFileCount ?? 0,
      changedLineCount: 0,
      changedLinesTruncated: false,
      intentOrigins: input.intentOrigins ?? [],
      intentTruncated: false
    },
    summary: {
      intentFragmentCount: input.intentFragmentCount ?? 0,
      obligationCount: 0,
      addressedCount: 0,
      unaddressedCount: 0,
      undeterminedCount: 0,
      obligationsTruncated: false,
      uncitedObligationCount: input.uncitedObligationCount ?? 0,
      unevidencedAddressedCount: 0,
      extraScopeFileCount: 0
    },
    obligations: [],
    extraScope: [],
    warnings: [...input.warnings],
    ...withUsage(input.usage)
  })

// Keeps `usage` absent rather than `undefined` when the lane reported none, so a
// report never carries an all-zero usage block that reads as "a provider ran and
// cost nothing".
const withUsage = (
  usage: LaneUsage | undefined
): { readonly usage?: LaneUsage } =>
  usage === undefined ? {} : { usage }

export const runIntentFulfilment = async (
  input: RunIntentFulfilmentInput
): Promise<IntentFulfilmentReport> => {
  const baseRef = input.baseRef ?? input.config.review.baseRef
  const headRef = input.headRef ?? input.config.review.headRef
  const generatedAt = input.generatedAt ?? new Date()

  if (!input.config.intentFulfilment.enabled) {
    return emptyReport({
      status: 'disabled',
      baseRef,
      headRef,
      generatedAt,
      warnings: [DISABLED_WARNING]
    })
  }

  const intake = await collectRepositoryIntake({
    repositoryRoot: input.repositoryRoot,
    baseRef,
    headRef,
    includePatterns: input.config.paths.include,
    excludePatterns: input.config.paths.exclude,
    maxFiles: input.config.review.maxFiles,
    maxFileBytes: input.config.review.maxFileBytes,
    ...(input.runGit === undefined ? {} : { runGit: input.runGit }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const { files, unreadableFileCount } = await collectSourceFiles(
    intake,
    input.readChangedFile
  )
  const warnings: string[] = []

  if (unreadableFileCount > 0) {
    warnings.push(
      `${unreadableFileCount} changed file(s) could not be read and were left out of the change the obligations are checked against.`
    )
  }

  const contextSources = input.config.contextSources
  const { fragments, providerMetrics } = await gatherContextFragments({
    // A disabled `contextSources` block runs no provider at all rather than
    // running the configured ones anyway: the block is the user's statement about
    // whether external context may be read, and this command does not get its own
    // opinion about that.
    providers: contextSources.enabled ? contextSources.providers : [],
    repositoryRoot: input.repositoryRoot,
    changedFiles: files.map((file) => ({
      path: file.path,
      content: file.content
    })),
    redact: createRedactor().redact,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })

  for (const metric of providerMetrics.filter((candidate) => candidate.failed)) {
    warnings.push(
      `External change-intent provider "${metric.id}" failed and was skipped.`
    )
  }

  if (fragments.length === 0) {
    return emptyReport({
      status: 'no-intent',
      baseRef,
      headRef,
      generatedAt,
      changedFileCount: intake.changedFiles.length,
      warnings: [
        ...warnings,
        contextSources.enabled && contextSources.providers.length > 0
          ? NO_INTENT_WARNING
          : NO_CONTEXT_SOURCES_WARNING
      ]
    })
  }

  const intentOrigins = fragments.map((fragment) => fragment.origin)
  const { sources, truncated: intentTruncated } = toIntentSources(
    fragments,
    input.config.intentFulfilment.maxIntentBytes
  )

  // REFUSE rather than extract obligations from part of a ticket: the checklist
  // would silently omit requirements the intent states. See `intent-limits.ts`.
  if (intentTruncated) {
    throw intentTooLargeError({
      intentBytes: fragments.reduce(
        (total, fragment) => total + Buffer.byteLength(fragment.body, 'utf8'),
        0
      ),
      maxIntentBytes: input.config.intentFulfilment.maxIntentBytes
    })
  }

  if (input.agents === undefined || sources.length === 0) {
    return emptyReport({
      status: input.agents === undefined ? 'provider-unavailable' : 'unusable-intent',
      baseRef,
      headRef,
      generatedAt,
      changedFileCount: intake.changedFiles.length,
      intentFragmentCount: fragments.length,
      intentOrigins,
      warnings: [
        ...warnings,
        input.agents === undefined ? NO_PROVIDER_WARNING : UNUSABLE_INTENT_WARNING
      ]
    })
  }

  const agents = input.agents
  const maxObligations = input.config.intentFulfilment.maxObligations
  let extracted

  try {
    extracted = await agents.extractObligations(
      obligationExtractionInputFor(sources, maxObligations),
      input.signal
    )
  } catch {
    // An extraction failure is not an empty intent. Reported as unusable with its
    // own warning, and never fatal: spec 23's command exits 0 whatever happens to
    // it.
    return emptyReport({
      status: 'unusable-intent',
      baseRef,
      headRef,
      generatedAt,
      changedFileCount: intake.changedFiles.length,
      intentFragmentCount: fragments.length,
      intentOrigins,
      warnings: [...warnings, EXTRACTION_FAILED_WARNING],
      usage: input.usage?.()
    })
  }

  // Citation resolution is the gate spec 23's "every obligation MUST cite where in
  // the stated intent it came from" is enforced at: an obligation whose origin and
  // line do not resolve to a line of a gathered fragment is DROPPED, not reported
  // with a weaker citation. The resolved text comes from the fragment, never from
  // the model's answer, so a reported source line is the author's own words.
  const cited = extracted.flatMap((obligation) => {
    const source = resolveIntentCitation(
      sources,
      obligation.origin,
      obligation.line
    )

    return source === undefined ? [] : [{ statement: obligation.statement, source }]
  })
  const uncitedObligationCount = extracted.length - cited.length
  // REFUSE rather than report a short checklist. Reporting the first
  // `maxObligations` under-reports what is left, which is the one direction this
  // command must not err in — see `intent-limits.ts`.
  if (cited.length >= maxObligations) {
    throw tooManyObligationsError({
      obligationCount: cited.length,
      maxObligations
    })
  }

  if (uncitedObligationCount > 0) {
    warnings.push(
      `${uncitedObligationCount} proposed obligation(s) did not cite a line of the stated intent and were not reported.`
    )
  }

  if (cited.length === 0) {
    return emptyReport({
      status: 'unusable-intent',
      baseRef,
      headRef,
      generatedAt,
      changedFileCount: intake.changedFiles.length,
      intentFragmentCount: fragments.length,
      intentOrigins,
      uncitedObligationCount,
      warnings: [...warnings, UNUSABLE_INTENT_WARNING],
      usage: input.usage?.()
    })
  }

  const surface = collectChangeSurface({
    files,
    maxChangeLines: input.config.intentFulfilment.maxChangeLines
  })

  // REFUSE rather than judge against part of the change. A judgement that cannot
  // see the evidence reports the obligation unaddressed, which is a wrong answer
  // on this command's only question — see `intent-limits.ts`.
  if (surface.truncated) {
    throw intentChangeTooLargeError({
      changedLineCount: surface.changedLineCount,
      maxChangeLines: input.config.intentFulfilment.maxChangeLines
    })
  }
  const obligations: Obligation[] = []
  let unevidencedAddressedCount = 0
  // Spec 23's Second Amendment: `addressed` obligations carrying an evidence
  // concern. It changes no verdict — see `aptness.ts` for why demoting was measured
  // and rejected twice — so this is a count of annotations, not of suppressions.
  let evidenceConcernCount = 0
  let failedJudgementCount = 0

  // Sequential, one call per obligation. Each call is its own session, so no
  // judgement opens holding the answer of the one before it: a verdict must follow
  // from the obligation in front of the model, and a conversation carrying six
  // previous "unaddressed" answers is a reason to give a seventh.
  for (const [index, entry] of cited.entries()) {
    let judged: FulfilmentJudgement

    try {
      judged = await agents.judge(
        fulfilmentJudgementInputFor(surface, entry.statement),
        input.signal
      )
    } catch {
      // A provider failure is not a verdict. The obligation is still reported, as
      // undetermined: dropping it would hide an obligation the intent does state.
      failedJudgementCount += 1
      judged = { status: 'undetermined' }
    }

    const verified = verifyJudgement(judged, surface)
    let evidenceConcern = false

    // The false-satisfied guard firing: the model said `addressed` and not one of
    // its citations was a line the change touched. Spec 23 makes the rate of
    // wrongly-certified obligations the metric that decides whether this
    // capability is safe to show anyone, so the downgrade is counted rather than
    // absorbed into the undetermined total without trace.
    if (judged.status === 'addressed' && verified.status !== 'addressed') {
      unevidencedAddressedCount += 1
    }

    // Spec 23's Second Amendment. Runs on every `addressed` verdict, because it
    // cannot demote one: the worst an aptness failure can do is fail to annotate.
    // Demoting was measured and rejected twice — see `aptness.ts`.
    if (verified.status === 'addressed') {
      let aptness: CitationAptness = 'undetermined'

      try {
        aptness = await agents.checkAptness(
          citationAptnessInputFor(entry.statement, verified.evidence),
          input.signal
        )
      } catch {
        aptness = 'undetermined'
      }

      evidenceConcern = isCitationConcern(verified, aptness)

      if (evidenceConcern) {
        evidenceConcernCount += 1
      }
    }

    obligations.push({
      id: `obl_${index + 1}`,
      source: entry.source,
      statement: entry.statement,
      ...(verified.status === 'addressed'
        ? {
            status: 'addressed' as const,
            evidence: [...verified.evidence],
            ...(evidenceConcern ? { evidenceConcern: true as const } : {})
          }
        : { status: verified.status })
    })
  }

  const extraScope = collectExtraScope(surface, obligations)
  const countOf = (status: Obligation['status']): number =>
    obligations.filter((obligation) => obligation.status === status).length

  if (failedJudgementCount > 0) {
    warnings.push(
      `${failedJudgementCount} judgement call(s) did not complete; those obligations are reported as undetermined.`
    )
  }

  // NO "a limit bound this run" WARNING EXISTS HERE, DELIBERATELY. All three limits
  // refuse above rather than truncate, so a run that reaches this point hit none of
  // them. A warning describing a bounded intent or a bounded checklist could
  // therefore never fire, and a branch that cannot fire is one nobody can trust.
  // See `intent-limits.ts` for why refusing is the whole point.

  // The explanation is a SEPARATE call over the frozen mapping above, and it runs
  // last for that reason: everything it reads is already decided and it has no
  // field through which to change any of it. A failure here costs the prose and
  // nothing else.
  let explanation: string | undefined

  try {
    explanation = await agents.explain(
      fulfilmentExplanationInputFor(obligations, extraScope),
      input.signal
    )
  } catch {
    warnings.push(
      'The explanation call did not complete; the mapping is reported without it.'
    )
  }

  return IntentFulfilmentReportSchema.parse({
    schemaVersion: '1.0',
    status: 'completed',
    generatedAt: generatedAt.toISOString(),
    scope: {
      baseRef,
      headRef,
      ...(intake.repositorySnapshot.mergeBaseRef === undefined
        ? {}
        : { mergeBaseRef: intake.repositorySnapshot.mergeBaseRef }),
      changedFileCount: intake.changedFiles.length,
      changedLineCount: surface.changedLineCount,
      changedLinesTruncated: surface.truncated,
      intentOrigins,
      intentTruncated
    },
    summary: {
      intentFragmentCount: fragments.length,
      obligationCount: obligations.length,
      addressedCount: countOf('addressed'),
      unaddressedCount: countOf('unaddressed'),
      undeterminedCount: countOf('undetermined'),
      // ALWAYS FALSE: a run the cap would have bound throws above rather than
      // reporting a short checklist. The flag previously fired on a condition that
      // essentially cannot occur — the cap is passed INTO the extraction prompt, so
      // a compliant model never overruns it — and 24 of 28 runs on the 2026-08-01
      // corpus returned exactly the cap while every one reported no truncation.
      obligationsTruncated: false,
      uncitedObligationCount,
      unevidencedAddressedCount,
      evidenceConcernCount,
      // Everything the run could not confirm. An evidence concern counts here even
      // though its verdict stayed `addressed`: doubtful evidence is exactly the
      // case a reviewer should still check, and putting it on this list costs a
      // longer list rather than a suppressed verdict.
      outstandingCount:
        countOf('unaddressed') + countOf('undetermined') + evidenceConcernCount,
      extraScopeFileCount: extraScope.length
    },
    obligations,
    extraScope,
    ...(explanation === undefined ? {} : { explanation }),
    warnings,
    ...withUsage(input.usage?.())
  })
}
