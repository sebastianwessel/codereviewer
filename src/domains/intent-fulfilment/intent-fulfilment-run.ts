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
//
// The run is ONE SEQUENCE OF STAGES, each written below as its own function
// returning the value it produced together with the warnings it produced. The
// warnings are order-sensitive output — tests assert them and reports render them
// — so the composing `runIntentFulfilment` at the bottom is the single place that
// concatenates them, in stage order, and no stage can reach into another's list.

import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import {
  gatherContextFragments,
  type ContextFragment
} from '../context-ingestion/index.js'
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
  type IntentCitation,
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
  type ExtractedObligation,
  type ObligationExtractionRunner
} from './obligation-extraction.js'
import {
  resolveIntentCitation,
  toIntentSources,
  type IntentSource
} from './intent-sources.js'

export type IntentFulfilmentAgents = {
  readonly extractObligations: ObligationExtractionRunner
  readonly judge: FulfilmentJudgementRunner
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

// The stated intent arrived already cut, and every list in the report is therefore
// a floor. Named as such where a reader will see it: the ceiling that bound is the
// PROVIDER's `maxFileBytes`, not `intentFulfilment.maxIntentBytes`, and pointing at
// the second knob would send someone to raise a limit that was never reached.
const providerCutIntentWarning = (origins: readonly string[]): string =>
  `The stated intent was cut before this command saw it: a contextSources ` +
  `provider trimmed ${origins.length} source(s) to its maxFileBytes cap ` +
  `(${origins.join(', ')}). Anything those sources state past the cut was never ` +
  `read, so the obligations below are what the visible part asks for and not ` +
  `necessarily all the intent asks for. Raise maxFileBytes on the provider that ` +
  `supplied them (up to 1000000) and re-run to check the change against the whole ` +
  `of it.`

// What one stage produced, and the warnings it produced producing it.
//
// Every stage returns its warnings rather than appending to a run-wide array,
// because the ORDER of that array is observable output. With one accumulator
// passed around, warning order is a property of where each stage happens to push;
// with this, it is a property of the composition, which is stated in one place and
// can be read at a glance.
type StageResult<T> = {
  readonly value: T
  readonly warnings: readonly string[]
}

// The change under review, read through the intake domain, which owns and
// validates every git invocation.
const collectIntake = async (
  input: RunIntentFulfilmentInput,
  baseRef: string,
  headRef: string
): Promise<RepositoryIntake> =>
  collectRepositoryIntake({
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

const diffMapsByPath = (
  intake: RepositoryIntake
): ReadonlyMap<string, DiffMap> =>
  new Map(intake.diffMaps.map((diffMap) => [diffMap.path, diffMap] as const))

/** The changed files the obligations will be checked against. */
type ChangeSourceFiles = {
  readonly files: readonly ChangeSurfaceSourceFile[]
  readonly unreadableFileCount: number
  readonly unmappedFileCount: number
}

// Reads the head side of every changed file through the caller's mediated reader,
// and pairs it with the lines the change REMOVED.
//
// The removed lines come from the raw diff intake already holds, so no extra git
// subcommand and no second filesystem read is needed. They matter because spec
// 23's 2026-07-30 amendment lets an evidenced obligation cite a removed line:
// without them a deletion is unprovable, and every "remove X" obligation on a
// real revert commit came back wrong.
const collectSourceFiles = async (
  intake: RepositoryIntake,
  readChangedFile: RunIntentFulfilmentInput['readChangedFile']
): Promise<StageResult<ChangeSourceFiles>> => {
  const byPath = diffMapsByPath(intake)
  const removedByPath = parseRemovedLines(intake.rawDiff)
  const files: ChangeSurfaceSourceFile[] = []
  let unreadableFileCount = 0
  let unmappedFileCount = 0

  // Every read is independent of every other, so they are issued together and
  // folded back IN FILE ORDER below. The fold, not the issue order, is what fixes
  // `files` and both counters, so the result is identical to reading them one at
  // a time.
  const reads = await Promise.all(
    intake.changedFiles.map(async (changedFile) => {
      const diffMap = byPath.get(changedFile.path)

      if (diffMap === undefined) {
        return { path: changedFile.path, unmapped: true as const }
      }

      return {
        path: changedFile.path,
        unmapped: false as const,
        diffMap,
        content: await readChangedFile(changedFile.path)
      }
    })
  )

  for (const read of reads) {
    if (read.unmapped) {
      // Counted, not just skipped. Its neighbour below has counted unreadable
      // files from the start; this branch dropped a changed file from the whole
      // report — it contributes no citable line AND no extra-scope row — so a
      // file the change touched was absent from every list with nothing saying
      // why. Rare (a file intake recorded but the diff parser did not map), and
      // rare is exactly when a silent hole is hardest to notice.
      unmappedFileCount += 1
      continue
    }

    if (read.content === undefined) {
      unreadableFileCount += 1
      continue
    }

    const removedLines = removedByPath.get(read.path) ?? []

    files.push({
      path: read.path,
      content: read.content,
      hunks: read.diffMap.hunks,
      ...(removedLines.length === 0 ? {} : { removedLines }),
      isNewFile: read.diffMap.changeKind === 'new'
    })
  }

  const warnings: string[] = []

  if (unreadableFileCount > 0) {
    warnings.push(
      `${unreadableFileCount} changed file(s) could not be read and were left out of the change the obligations are checked against.`
    )
  }

  // Worded apart from the unreadable case above because the causes differ: that
  // one is a file the filesystem would not give up, this one is a file the diff
  // parser produced no hunks for. Both leave the file out of every list in the
  // report, which is the part a reader needs told.
  if (unmappedFileCount > 0) {
    warnings.push(
      `${unmappedFileCount} changed file(s) had no mapped diff hunks and were left out of the change the obligations are checked against. They appear in no obligation's evidence and in no extra-scope row.`
    )
  }

  return {
    value: { files, unreadableFileCount, unmappedFileCount },
    warnings
  }
}

// Spec 11's ingestion, called once for the stated intent. A provider that failed
// is reported rather than absorbed: the run continues on what the others gathered,
// and a reader is told which source is missing from it.
const gatherIntentFragments = async (input: {
  readonly config: CodeReviewerConfig
  readonly repositoryRoot: string
  readonly files: readonly ChangeSurfaceSourceFile[]
  readonly signal: AbortSignal | undefined
}): Promise<StageResult<readonly ContextFragment[]>> => {
  const contextSources = input.config.contextSources
  const { fragments, providerMetrics } = await gatherContextFragments({
    // A disabled `contextSources` block runs no provider at all rather than
    // running the configured ones anyway: the block is the user's statement about
    // whether external context may be read, and this command does not get its own
    // opinion about that.
    providers: contextSources.enabled ? contextSources.providers : [],
    repositoryRoot: input.repositoryRoot,
    changedFiles: input.files.map((file) => ({
      path: file.path,
      content: file.content
    })),
    redact: createRedactor().redact,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })

  return {
    value: fragments,
    warnings: providerMetrics
      .filter((candidate) => candidate.failed)
      .map(
        (metric) =>
          `External change-intent provider "${metric.id}" failed and was skipped.`
      )
  }
}

/** The line-addressed intent, and whether somebody else had already cut it. */
type GatheredIntent = {
  readonly sources: readonly IntentSource[]
  readonly intentCutByProvider: boolean
}

// The truncation policy, in the one place that can apply it.
const resolveIntentSources = (
  fragments: readonly ContextFragment[],
  maxIntentBytes: number
): StageResult<GatheredIntent> => {
  const {
    sources,
    truncated: intentTruncated,
    providerTruncatedOrigins
  } = toIntentSources(fragments, maxIntentBytes)
  // The OTHER way the stated intent can be partial, and the only one that can reach
  // a report: a `contextSources` provider cut the body at its own `maxFileBytes`
  // before this domain was handed it. Nothing here can measure that — the cut is
  // what makes the body fit every budget downstream — so it is read off the
  // fragment. Disclosed rather than refused, because that cap defaults BELOW
  // `maxIntentBytes` and is not this capability's to set; see `intent-limits.ts`.
  const intentCutByProvider = providerTruncatedOrigins.length > 0

  // REFUSE rather than extract obligations from part of a ticket: the checklist
  // would silently omit requirements the intent states. See `intent-limits.ts`.
  if (intentTruncated) {
    throw intentTooLargeError({
      intentBytes: fragments.reduce(
        (total, fragment) => total + Buffer.byteLength(fragment.body, 'utf8'),
        0
      ),
      maxIntentBytes,
      // The sum above is taken over the bodies that arrived, and a body a provider
      // already cut is smaller than the intent it stands for.
      intentBytesIsLowerBound: intentCutByProvider
    })
  }

  const warnings: string[] = []

  if (intentCutByProvider) {
    warnings.push(providerCutIntentWarning(providerTruncatedOrigins))
  }

  return { value: { sources, intentCutByProvider }, warnings }
}

// The extraction call. Returns `undefined` when it did not complete, which the
// composition reports as unusable intent with its own warning: an extraction
// failure is not an empty intent, and it is never fatal — spec 23's command exits
// 0 whatever happens to it.
const extractObligations = async (
  extract: ObligationExtractionRunner,
  sources: readonly IntentSource[],
  maxObligations: number,
  signal: AbortSignal | undefined
): Promise<readonly ExtractedObligation[] | undefined> => {
  try {
    return await extract(
      obligationExtractionInputFor(sources, maxObligations),
      signal
    )
  } catch {
    return undefined
  }
}

/** An obligation whose citation resolved to a line of the stated intent. */
type CitedObligation = {
  readonly statement: string
  readonly source: IntentCitation
}

type CitedObligations = {
  readonly cited: readonly CitedObligation[]
  readonly uncitedObligationCount: number
}

// Citation resolution is the gate spec 23's "every obligation MUST cite where in
// the stated intent it came from" is enforced at: an obligation whose origin and
// line do not resolve to a line of a gathered fragment is DROPPED, not reported
// with a weaker citation. The resolved text comes from the fragment, never from
// the model's answer, so a reported source line is the author's own words.
const resolveCitedObligations = (
  sources: readonly IntentSource[],
  extracted: readonly ExtractedObligation[],
  maxObligations: number
): StageResult<CitedObligations> => {
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

  const warnings: string[] = []

  if (uncitedObligationCount > 0) {
    warnings.push(
      `${uncitedObligationCount} proposed obligation(s) did not cite a line of the stated intent and were not reported.`
    )
  }

  return { value: { cited, uncitedObligationCount }, warnings }
}

const buildChangeSurface = (
  files: readonly ChangeSurfaceSourceFile[],
  maxChangeLines: number
): ChangeSurface => {
  const surface = collectChangeSurface({ files, maxChangeLines })

  // REFUSE rather than judge against part of the change. A judgement that cannot
  // see the evidence reports the obligation not-evidenced, which is a wrong answer
  // on this command's only question — see `intent-limits.ts`.
  if (surface.truncated) {
    throw intentChangeTooLargeError({
      changedLineCount: surface.changedLineCount,
      maxChangeLines
    })
  }

  return surface
}

type JudgedObligations = {
  readonly obligations: readonly Obligation[]
  readonly unverifiedEvidenceClaimCount: number
}

// Sequential, one call per obligation. Each call is its own session, so no
// judgement opens holding the answer of the one before it: a verdict must follow
// from the obligation in front of the model, and a conversation carrying six
// previous "not-evidenced" answers is a reason to give a seventh.
const judgeObligations = async (input: {
  readonly judge: FulfilmentJudgementRunner
  readonly surface: ChangeSurface
  readonly cited: readonly CitedObligation[]
  readonly wholeChangeVisible: boolean
  readonly signal: AbortSignal | undefined
}): Promise<StageResult<JudgedObligations>> => {
  const obligations: Obligation[] = []
  let unverifiedEvidenceClaimCount = 0
  let unsupportedAbsenceClaimCount = 0
  let failedJudgementCount = 0

  for (const [index, entry] of input.cited.entries()) {
    let judged: FulfilmentJudgement

    try {
      judged = await input.judge(
        fulfilmentJudgementInputFor(input.surface, entry.statement),
        input.signal
      )
    } catch {
      // A provider failure is not a verdict. The obligation is still reported, as
      // undetermined: dropping it would hide an obligation the intent does state.
      failedJudgementCount += 1
      judged = { status: 'undetermined' }
    }

    const verified = verifyJudgement(judged, input.surface, {
      wholeChangeVisible: input.wholeChangeVisible
    })

    // The false-satisfied guard firing: the model said `evidenced` and not one of
    // its citations was a line the change touched. Spec 23 makes the rate of
    // wrongly-certified obligations the metric that decides whether this
    // capability is safe to show anyone, so the downgrade is counted rather than
    // absorbed into the undetermined total without trace.
    if (judged.status === 'evidenced' && verified.status !== 'evidenced') {
      unverifiedEvidenceClaimCount += 1
    }

    // The same guard for the other answer that claims something about the change:
    // "nothing here goes against it" over a change part of which was never read is
    // a reassurance drawn from material nobody saw.
    if (
      judged.status === 'not-contradicted' &&
      verified.status !== 'not-contradicted'
    ) {
      unsupportedAbsenceClaimCount += 1
    }

    // ONE CALL PER OBLIGATION, and no second one. A citation-aptness stage used to
    // run here on every `evidenced` verdict; it was measured and removed. See spec
    // 23's rejected-design record for the numbers.
    obligations.push({
      id: `obl_${index + 1}`,
      source: entry.source,
      statement: entry.statement,
      ...(verified.status === 'evidenced'
        ? { status: 'evidenced' as const, evidence: [...verified.evidence] }
        : { status: verified.status })
    })
  }

  const warnings: string[] = []

  if (failedJudgementCount > 0) {
    warnings.push(
      `${failedJudgementCount} judgement call(s) did not complete; those obligations are reported as undetermined.`
    )
  }

  if (unsupportedAbsenceClaimCount > 0) {
    warnings.push(
      `${unsupportedAbsenceClaimCount} obligation(s) answered as not contradicted by this change are reported as undetermined instead, because part of the change was left out of the lines the judgement saw. Nothing can conclude that a change contains no violation of an obligation while part of it was never read.`
    )
  }

  return { value: { obligations, unverifiedEvidenceClaimCount }, warnings }
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
      obligation.status === 'evidenced'
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

// A failure here costs the prose and nothing else.
const explainFulfilment = async (
  explain: FulfilmentExplanationRunner,
  obligations: readonly Obligation[],
  extraScope: readonly ExtraScopeEntry[],
  signal: AbortSignal | undefined
): Promise<StageResult<string | undefined>> => {
  try {
    return {
      value: await explain(
        fulfilmentExplanationInputFor(obligations, extraScope),
        signal
      ),
      warnings: []
    }
  } catch {
    return {
      value: undefined,
      warnings: [
        'The explanation call did not complete; the mapping is reported without it.'
      ]
    }
  }
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
  // Carried onto the empty reports too. A run that gathered a cut ticket and then
  // read no obligation out of it reports `unusable-intent`, and "nothing checkable
  // in this text" is a very different statement when part of the text was missing.
  readonly intentTruncated?: boolean
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
      intentOrigins: input.intentOrigins ?? [],
      intentTruncated: input.intentTruncated ?? false
    },
    summary: {
      intentFragmentCount: input.intentFragmentCount ?? 0,
      obligationCount: 0,
      evidencedCount: 0,
      notEvidencedStatusCount: 0,
      undeterminedCount: 0,
      obligationsTruncated: false,
      uncitedObligationCount: input.uncitedObligationCount ?? 0,
      unverifiedEvidenceClaimCount: 0,
      notContradictedCount: 0,
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

type CompletedReportInput = {
  readonly baseRef: string
  readonly headRef: string
  readonly generatedAt: Date
  readonly mergeBaseRef: string | undefined
  readonly changedFileCount: number
  readonly changedLineCount: number
  readonly intentOrigins: readonly string[]
  readonly intentCutByProvider: boolean
  readonly intentFragmentCount: number
  readonly obligations: readonly Obligation[]
  readonly extraScope: readonly ExtraScopeEntry[]
  readonly uncitedObligationCount: number
  readonly unverifiedEvidenceClaimCount: number
  readonly explanation: string | undefined
  readonly warnings: readonly string[]
  readonly usage: LaneUsage | undefined
}

// The one outcome that produces a mapping.
const completedReport = (input: CompletedReportInput): IntentFulfilmentReport => {
  const countOf = (status: Obligation['status']): number =>
    input.obligations.filter((obligation) => obligation.status === status).length

  return IntentFulfilmentReportSchema.parse({
    schemaVersion: '1.0',
    status: 'completed',
    generatedAt: input.generatedAt.toISOString(),
    scope: {
      baseRef: input.baseRef,
      headRef: input.headRef,
      ...(input.mergeBaseRef === undefined
        ? {}
        : { mergeBaseRef: input.mergeBaseRef }),
      changedFileCount: input.changedFileCount,
      changedLineCount: input.changedLineCount,
      intentOrigins: input.intentOrigins,
      // The value reaching a report is always the provider's cut: the
      // `maxIntentBytes` cause refuses in `resolveIntentSources` and produces no
      // report at all. Before the fragment carried its own flag this field could
      // only ever be written `false`, so a ticket clipped to 64 KB was published as
      // intent read whole — a denied loss rather than a disclosed one.
      intentTruncated: input.intentCutByProvider
    },
    summary: {
      intentFragmentCount: input.intentFragmentCount,
      obligationCount: input.obligations.length,
      evidencedCount: countOf('evidenced'),
      notEvidencedStatusCount: countOf('not-evidenced'),
      // Counted apart and kept OFF the headline below. An obligation honoured by
      // changing nothing has no line to cite however completely it is honoured, so
      // while it was counted as unevidenced the report raised the same false alarm
      // on every run — 39.8% of this lane's classified false positives.
      notContradictedCount: countOf('not-contradicted'),
      undeterminedCount: countOf('undetermined'),
      // ALWAYS FALSE: a run the cap would have bound throws in
      // `resolveCitedObligations` rather than reporting a short checklist. The flag
      // previously fired on a condition that essentially cannot occur — the cap is
      // passed INTO the extraction prompt, so a compliant model never overruns it —
      // and 24 of 28 runs on the 2026-08-01 corpus returned exactly the cap while
      // every one reported no truncation.
      obligationsTruncated: false,
      uncitedObligationCount: input.uncitedObligationCount,
      unverifiedEvidenceClaimCount: input.unverifiedEvidenceClaimCount,
      // Everything the run found no evidence for: `not-evidenced` plus
      // `undetermined`, and nothing else. Neither an `evidenced` nor a
      // `not-contradicted` obligation is ever on this list — the third term that
      // once put doubted-evidence verdicts here went with the aptness stage, and
      // 18.1% of this lane's false positives were that term firing on verdicts that
      // were already correct.
      notEvidencedCount: countOf('not-evidenced') + countOf('undetermined'),
      extraScopeFileCount: input.extraScope.length
    },
    obligations: input.obligations,
    extraScope: input.extraScope,
    ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
    warnings: input.warnings,
    ...withUsage(input.usage)
  })
}

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

  const intake = await collectIntake(input, baseRef, headRef)
  const sourceFiles = await collectSourceFiles(intake, input.readChangedFile)
  // The run's warnings, concatenated in stage order and never written by a stage.
  const warnings: string[] = [...sourceFiles.warnings]
  const { files, unreadableFileCount, unmappedFileCount } = sourceFiles.value
  const gathered = await gatherIntentFragments({
    config: input.config,
    repositoryRoot: input.repositoryRoot,
    files,
    signal: input.signal
  })

  warnings.push(...gathered.warnings)

  const fragments = gathered.value

  if (fragments.length === 0) {
    const contextSources = input.config.contextSources

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
  const gatheredIntent = resolveIntentSources(
    fragments,
    input.config.intentFulfilment.maxIntentBytes
  )

  warnings.push(...gatheredIntent.warnings)

  const { sources, intentCutByProvider } = gatheredIntent.value
  // What every empty report from here on says about the intent it did gather. The
  // run got far enough to know all four, and an empty report that omitted them
  // would describe a run that never read the ticket.
  const gatheredScope = {
    baseRef,
    headRef,
    generatedAt,
    changedFileCount: intake.changedFiles.length,
    intentFragmentCount: fragments.length,
    intentOrigins,
    intentTruncated: intentCutByProvider
  }

  if (input.agents === undefined || sources.length === 0) {
    return emptyReport({
      ...gatheredScope,
      status: input.agents === undefined ? 'provider-unavailable' : 'unusable-intent',
      warnings: [
        ...warnings,
        input.agents === undefined ? NO_PROVIDER_WARNING : UNUSABLE_INTENT_WARNING
      ]
    })
  }

  const agents = input.agents
  const maxObligations = input.config.intentFulfilment.maxObligations
  const extracted = await extractObligations(
    agents.extractObligations,
    sources,
    maxObligations,
    input.signal
  )

  if (extracted === undefined) {
    return emptyReport({
      ...gatheredScope,
      status: 'unusable-intent',
      warnings: [...warnings, EXTRACTION_FAILED_WARNING],
      usage: input.usage?.()
    })
  }

  const citedObligations = resolveCitedObligations(
    sources,
    extracted,
    maxObligations
  )

  warnings.push(...citedObligations.warnings)

  const { cited, uncitedObligationCount } = citedObligations.value

  if (cited.length === 0) {
    return emptyReport({
      ...gatheredScope,
      status: 'unusable-intent',
      uncitedObligationCount,
      warnings: [...warnings, UNUSABLE_INTENT_WARNING],
      usage: input.usage?.()
    })
  }

  const surface = buildChangeSurface(
    files,
    input.config.intentFulfilment.maxChangeLines
  )
  const judged = await judgeObligations({
    judge: agents.judge,
    surface,
    cited,
    // A `not-contradicted` verdict is a search for a violation that came back
    // empty, so it is worth exactly what the searched surface was worth. Both
    // counts here are files that never reached it. `maxChangeLines` cannot
    // contribute — it refuses the run — so a complete file list is a complete
    // change.
    wholeChangeVisible: unreadableFileCount === 0 && unmappedFileCount === 0,
    signal: input.signal
  })

  warnings.push(...judged.warnings)

  const { obligations, unverifiedEvidenceClaimCount } = judged.value
  const extraScope = collectExtraScope(surface, obligations)

  // NO "a limit of OURS bound this run" WARNING EXISTS HERE, DELIBERATELY. All three
  // of this capability's limits refuse above rather than truncate, so a run that
  // reaches this point hit none of them, and a warning saying otherwise could never
  // fire — a branch that cannot fire is one nobody can trust. See `intent-limits.ts`
  // for why refusing is the whole point.
  //
  // The one bound that CAN have bound a run reaching here belongs to another domain:
  // a `contextSources` provider's `maxFileBytes`. That warning is pushed at the
  // point the fact is known, next to the refusal it is not.

  // The explanation is a SEPARATE call over the frozen mapping above, and it runs
  // last for that reason: everything it reads is already decided and it has no
  // field through which to change any of it.
  const explained = await explainFulfilment(
    agents.explain,
    obligations,
    extraScope,
    input.signal
  )

  warnings.push(...explained.warnings)

  return completedReport({
    baseRef,
    headRef,
    generatedAt,
    mergeBaseRef: intake.repositorySnapshot.mergeBaseRef,
    changedFileCount: intake.changedFiles.length,
    changedLineCount: surface.changedLineCount,
    intentOrigins,
    intentCutByProvider,
    intentFragmentCount: fragments.length,
    obligations,
    extraScope,
    uncitedObligationCount,
    unverifiedEvidenceClaimCount,
    explanation: explained.value,
    warnings,
    usage: input.usage?.()
  })
}
