import type { JsonValue, ModelAlias, ModelDefaults } from '@purista/harness'
import type { AdmittedFinding } from '../../shared/contracts/index.js'
import {
  createStructuredError,
  normalizeError
} from '../../shared/errors/error-normalizer.js'
import { redactText } from '../../shared/redaction/redactor.js'
import { z } from 'zod'
import type { EvalCase } from './eval-fixture.schema.js'

export const EVAL_PLAUSIBILITY_JUDGE_STAGE = 'eval_plausibility_judge'

// The plausibility judge must see the whole changed file the reviewer saw, not a
// narrow window: a judge given too little context under-credits real findings by
// answering "cannot confirm". The file is nevertheless bounded so a pathological
// input can never blow up the prompt. 64 KiB comfortably holds a real changed
// source file while capping adversarial input. This is a judgment call; the cap
// is deliberately generous, not tight.
export const EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP = 64_000

// A finding already credited as a real defect elsewhere in the SAME file, either
// because it matched an expected finding or because an earlier call in this same
// run already judged it a genuine unlisted-real defect. Given to the plausibility
// judge so it can recognise a restatement of a defect it already knows about,
// rather than judging every finding in total isolation. Deliberately just enough
// to compare "is this the same defect", never a path (the caller only ever builds
// this list from findings in the SAME file as the finding under review) and never
// an id (report-safe: the judge answers a yes/no question, it never needs to name
// which finding it is comparing against).
export type EvalAlreadyCountedFinding = {
  readonly title: string
  readonly description: string
  readonly line: number
}

// The plausibility judge input carries the finding AND the new-side file content
// the reviewer saw. Unlike the semantic-match judge (which never sees source),
// this judge must read code to decide whether a defect is genuinely present, so
// the file content is redacted before it is sent.
export type EvalPlausibilityJudgeInput = {
  readonly findingTitle: string
  readonly findingDescription: string
  readonly severity: string
  readonly category: string
  readonly path: string
  readonly line: number
  // Bounded and redacted new-side file content (see prepareEvalPlausibilitySource).
  readonly fileContent: string
  // Findings already credited as real defects in this same file, earlier in this
  // same run (see EvalAlreadyCountedFinding). Optional and typically absent for a
  // direct calibration call, which scores one finding in isolation and has no
  // "earlier in this run" to speak of; the judge must then answer
  // restatesAlreadyCounted=false, since there is nothing to restate.
  readonly alreadyCountedFindings?: readonly EvalAlreadyCountedFinding[]
}

export type EvalPlausibilityJudgeResult = {
  readonly plausible: boolean
  readonly reason: string
  // Whether the finding under review describes the SAME underlying defect as one
  // of the `alreadyCountedFindings` it was shown, merely restated at a different
  // location, rather than a distinct defect of its own. Optional so existing
  // scripted judges that only ever answered the plausible/reason question keep
  // compiling and behaving exactly as before: an absent answer is treated as "not
  // a restatement", which is what every judge that was never asked the question
  // implicitly meant.
  readonly restatesAlreadyCounted?: boolean
}

export type EvalPlausibilityJudge = (
  input: EvalPlausibilityJudgeInput
) => Promise<EvalPlausibilityJudgeResult>

const EvalPlausibilityJudgeResponseSchema = z.strictObject({
  plausible: z.boolean(),
  reason: z.string().min(1).max(500),
  restatesAlreadyCounted: z.boolean()
})

const evalPlausibilityJudgeJsonSchema: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['plausible', 'reason', 'restatesAlreadyCounted'],
  properties: {
    plausible: {
      type: 'boolean'
    },
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: 500
    },
    restatesAlreadyCounted: {
      type: 'boolean'
    }
  }
} as const

// Kept generic and language-neutral on purpose: it must read the same whether the
// finding is TypeScript, Go, Python, or anything else, and it must never gate on
// any expected/fixture list. Two sentences here exist ONLY to fix the restatement
// problem: a reviewer that finds one real defect and reports it again at a
// neighbouring line was previously judged once per report, each report
// individually true, so every restatement was separately counted as its own
// unlisted-real defect. Asking the SAME judge call to also compare against
// findings already counted in this file lets it recognise a restatement instead
// of manufacturing additional distinct defects out of one.
const plausibilityJudgeInstructions = [
  'You are auditing whether a code review finding describes a GENUINE defect that is actually present in the shown code.',
  'You are given the finding (title, description, severity, category, location) and the new-side content of the whole file the reviewer saw.',
  'Answer plausible=true only when the code shown actually contains the defect the finding describes.',
  'Answer plausible=false when the finding misreads the code, is a style or taste preference, or is not supported by what the code shows.',
  'Do not require the finding to match any expected list; decide only from the code in front of you.',
  'You may also be given a list of findings already counted as real defects earlier in this same review, each with its own title, description, and line number.',
  'When that list is non-empty, also decide whether the finding under review describes the SAME underlying defect as one of those already-counted findings, merely restated at a different location, as opposed to a distinct defect of its own.',
  'Answer restatesAlreadyCounted=true only when it is the identical underlying defect already counted; two distinct real defects that happen to sit near each other are NOT the same defect, so answer false in that case.',
  'When the already-counted list is empty or absent, always answer restatesAlreadyCounted=false.',
  'Return a plausible decision, a restatesAlreadyCounted decision, and a concise reason. Do not return numeric confidence.',
  'Return JSON only.'
].join(' ')

// Renders the list of findings already credited as real defects in this file, or
// an explicit "none" line when there is nothing to compare against. An explicit
// line is used instead of omitting the section so the judge is never left to
// guess whether the section was left out or the list is genuinely empty.
const alreadyCountedSummary = (
  alreadyCountedFindings: readonly EvalAlreadyCountedFinding[]
): string =>
  alreadyCountedFindings.length === 0
    ? 'None: no findings have been counted as real defects in this file yet in this review.'
    : alreadyCountedFindings
        .map(
          (counted, index) =>
            `${index + 1}. Line ${counted.line}: ${counted.title} -- ${counted.description}`
        )
        .join('\n')

const findingSummary = (input: EvalPlausibilityJudgeInput): string =>
  [
    `Finding title: ${input.findingTitle}`,
    `Finding description: ${input.findingDescription}`,
    `Severity: ${input.severity}`,
    `Category: ${input.category}`,
    `Location: ${input.path}:${input.line}`,
    'Findings already counted as real defects in this file earlier in this review:',
    alreadyCountedSummary(input.alreadyCountedFindings ?? []),
    'New-side file content:',
    input.fileContent
  ].join('\n')

// Bound and redact new-side source before it is sent to the plausibility judge.
// Redaction runs first so a secret can never survive by landing across the byte
// boundary; truncation then caps the redacted text. Reuses the shared redactor.
export const prepareEvalPlausibilitySource = (content: string): string => {
  const redacted = redactText(content)

  if (Buffer.byteLength(redacted, 'utf8') <= EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP) {
    return redacted
  }

  let low = 0
  let high = redacted.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (
      Buffer.byteLength(redacted.slice(0, mid), 'utf8') <=
      EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP
    ) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return redacted.slice(0, low)
}

// The plausibility judge is independent from the semantic-match judge but shares
// its reliability contract: deterministic sampling where the alias allows, and
// provider retry on. Temperature is pinned to 0 only when the alias already
// carries a temperature, so reasoning models that reject the parameter keep
// their defaults.
const deterministicDefaults = (
  defaults: ModelDefaults | undefined
): ModelDefaults | undefined =>
  defaults === undefined
    ? undefined
    : {
        ...defaults,
        ...(defaults.temperature === undefined ? {} : { temperature: 0 })
      }

export const createModelPlausibilityJudge = (
  input: {
    readonly modelAlias: ModelAlias
    readonly signal?: AbortSignal
  }
): EvalPlausibilityJudge => async (judgeInput): Promise<EvalPlausibilityJudgeResult> => {
  if (input.modelAlias.provider.object === undefined) {
    throw createStructuredError({
      code: 'provider_capability_missing',
      message:
        'Plausibility judge requires a provider with object output support.',
      category: 'config',
      recoverable: true,
      exitCode: 2
    })
  }

  const defaults = deterministicDefaults(input.modelAlias.defaults)

  try {
    const response = await input.modelAlias.provider.object({
      model: input.modelAlias.model,
      messages: [
        {
          role: 'system',
          content: plausibilityJudgeInstructions
        },
        {
          role: 'user',
          content: findingSummary(judgeInput)
        }
      ],
      schema: evalPlausibilityJudgeJsonSchema,
      schemaName: 'eval_plausibility',
      ...(defaults === undefined ? {} : { defaults }),
      call: {
        // Transient provider failures are retried under the configured provider
        // retry policy. A plausibility call that still fails fails closed (the
        // finding stays a genuine false positive), so retrying is strictly
        // cheaper than giving up early.
        retry: true
      },
      signal: input.signal ?? new AbortController().signal
    })
    const parsed = EvalPlausibilityJudgeResponseSchema.parse(response.object)

    return {
      plausible: parsed.plausible,
      reason: parsed.reason,
      restatesAlreadyCounted: parsed.restatesAlreadyCounted
    }
  } catch (error) {
    throw normalizeError(error, {
      source: 'provider',
      operation: EVAL_PLAUSIBILITY_JUDGE_STAGE
    })
  }
}

// Reads the new-side content the reviewer saw for a finding's file so the
// plausibility judge can decide whether an unmatched finding is genuine. Returns
// undefined when the file cannot be read; the judge then fails closed.
export type EvalCaseFileReader = (
  input: {
    readonly evalCase: EvalCase
    readonly path: string
  }
) => Promise<string | undefined>

// Report-safe provider issue raised by a plausibility call that could not be
// completed. Mirrors the matcher's judge-provider-issue shape so a failure stays
// visible as provider instability rather than silently changing scores.
export type EvalPlausibilityProviderIssue = {
  readonly code: string
  readonly stage: string
  readonly recovered: false
  readonly message?: string
}

// Per-finding plausibility outcome for one unmatched admitted finding.
export type EvalPlausibilityOutcome = {
  readonly findingId: string
  // The judge's affirmative decision, or false when the call could not be
  // completed (fail-closed): precision is only ever credited by an affirmative
  // plausible=true decision.
  readonly plausible: boolean
  readonly reason: string
  // False when the judgment could not be completed (provider error after
  // retries, or the source file could not be read). Such findings stay counted
  // as genuine false positives and are surfaced as a run warning.
  readonly judged: boolean
  // True when the judge decided this finding restates a defect already credited
  // in this file (a match, or an earlier unlisted-real credit in this same run)
  // rather than confirming a further, distinct defect. Always false when
  // `plausible` is false or the call could not be judged: only a genuinely real
  // finding can be a restatement of another real finding. A restatement is never
  // added to `unlistedRealFindingIds`, exactly like an exact-line duplicate is
  // never added to the matcher's false-positive set -- see eval-matcher.ts's
  // `isDuplicateOfMatchedFinding` for the sibling mechanism this extends
  // semantically to findings the raw line-overlap check cannot catch.
  readonly restatesAlreadyCounted: boolean
}

export type EvalPlausibilityResult = {
  readonly outcomes: readonly EvalPlausibilityOutcome[]
  // Findings the judge affirmatively deemed genuine but unlisted defects.
  readonly unlistedRealFindingIds: readonly string[]
  // Findings whose plausibility could not be decided (fail-closed): counted as
  // genuine false positives, never credited as real.
  readonly failClosedFindingIds: readonly string[]
  readonly providerIssues: readonly EvalPlausibilityProviderIssue[]
}

const emptyPlausibilityResult: EvalPlausibilityResult = {
  outcomes: [],
  unlistedRealFindingIds: [],
  failClosedFindingIds: [],
  providerIssues: []
}

// Findings already credited as real defects, grouped by path, so the judge can be
// shown only the entries from the SAME file as the finding it is currently
// deciding. A plain Map keyed by path is enough: this runs once per case, over
// the small number of findings one case ever produces.
type CreditedFindingsByPath = Map<string, EvalAlreadyCountedFinding[]>

const summarizeForCredit = (finding: AdmittedFinding): EvalAlreadyCountedFinding => ({
  title: finding.title,
  description: finding.description,
  line: finding.location.startLine
})

const addCredited = (
  creditedByPath: CreditedFindingsByPath,
  finding: AdmittedFinding
): void => {
  const path = finding.location.path
  const existing = creditedByPath.get(path) ?? []
  creditedByPath.set(path, [...existing, summarizeForCredit(finding)])
}

// Judge each unmatched (raw false-positive) actionable finding for plausibility.
// This never promotes a finding into recall or changes what the reviewer
// reported; it only reclassifies unmatched output for precision accounting.
//
// Fail-closed everywhere: with no judge (offline run) or no reader, no finding
// is credited as real and no warning is raised (there was nothing to attempt).
// A judge call or file read that fails leaves the finding a genuine false
// positive AND records a fail-closed warning plus a provider issue.
//
// Restatement collapsing. A precision audit found that a majority of a run's
// "unlisted-real" evidence was the SAME defect restated at a neighbouring line: a
// nil-dereference matched at kubernetes_http.go:592 was independently
// "confirmed" three more times at :593, because each unmatched finding used to be
// judged completely alone, with no visibility into what the case had already
// matched or already credited. Every restatement was individually true, so every
// one was individually credited -- one real defect became four counted defects,
// and adjustedPrecision absorbed the verbosity instead of penalising it. This
// function now threads a running "already counted" pool per file through the
// loop: seeded from the case's matched findings, and grown with every finding
// this same run affirmatively credits as unlisted-real, so a second and third
// restatement of a defect the fixture never listed at all also collapse, not
// just restatements of something matched. A finding the judge recognises as
// restating an already-counted defect is never added to `unlistedRealFindingIds`;
// it is not, however, quietly dropped -- it stays in the case's raw
// `falsePositiveFindingIds` (computed upstream by the matcher) and therefore
// still counts toward `genuineFalsePositiveCount`, exactly as it would if the
// judge had never been asked the restatement question at all. That is a
// deliberate choice, not an oversight: the finding is not a further, distinct
// real defect the fixture omitted, so crediting it as one is what inflated
// adjustedPrecision in the first place.
export const judgeUnmatchedFindingsPlausibility = async (
  input: {
    readonly evalCase: EvalCase
    readonly unmatchedFindings: readonly AdmittedFinding[]
    // Findings already matched to an expected finding in this case, across every
    // file. Seeds the per-file "already counted" pool so the very first
    // restatement of a MATCHED defect is recognised, not only the second
    // restatement of a defect nothing had credited yet.
    readonly matchedFindings: readonly AdmittedFinding[]
    readonly judge: EvalPlausibilityJudge | undefined
    readonly readFileContent: EvalCaseFileReader | undefined
  }
): Promise<EvalPlausibilityResult> => {
  if (
    input.judge === undefined ||
    input.readFileContent === undefined ||
    input.unmatchedFindings.length === 0
  ) {
    return emptyPlausibilityResult
  }

  const outcomes: EvalPlausibilityOutcome[] = []
  const unlistedRealFindingIds: string[] = []
  const failClosedFindingIds: string[] = []
  const providerIssues: EvalPlausibilityProviderIssue[] = []

  const creditedByPath: CreditedFindingsByPath = new Map()
  for (const matched of input.matchedFindings) {
    addCredited(creditedByPath, matched)
  }

  for (const finding of input.unmatchedFindings) {
    const rawContent = await input.readFileContent({
      evalCase: input.evalCase,
      path: finding.location.path
    }).catch(() => undefined)

    if (rawContent === undefined) {
      // Source could not be read: fail closed. The finding stays a genuine false
      // positive and the failure is surfaced.
      outcomes.push({
        findingId: finding.id,
        plausible: false,
        reason: 'Source file could not be read; failed closed.',
        judged: false,
        restatesAlreadyCounted: false
      })
      failClosedFindingIds.push(finding.id)
      providerIssues.push({
        code: 'plausibility_source_unavailable',
        stage: EVAL_PLAUSIBILITY_JUDGE_STAGE,
        recovered: false,
        message: 'The finding source file could not be read for plausibility judging.'
      })

      continue
    }

    try {
      const alreadyCountedFindings = creditedByPath.get(finding.location.path) ?? []
      const judged = await input.judge({
        findingTitle: finding.title,
        findingDescription: finding.description,
        severity: finding.severity,
        category: finding.category,
        path: finding.location.path,
        line: finding.location.startLine,
        fileContent: prepareEvalPlausibilitySource(rawContent),
        alreadyCountedFindings
      })
      // Only a finding the judge deems genuinely plausible can be a restatement:
      // a spurious finding never restates a real defect, it is simply wrong on
      // its own terms. An absent `restatesAlreadyCounted` (a scripted judge that
      // was never asked the question) is treated as "not a restatement".
      const isRestatement = judged.plausible && judged.restatesAlreadyCounted === true
      outcomes.push({
        findingId: finding.id,
        plausible: judged.plausible,
        reason: judged.reason,
        judged: true,
        restatesAlreadyCounted: isRestatement
      })
      if (judged.plausible && !isRestatement) {
        unlistedRealFindingIds.push(finding.id)
        // Credit this finding for the REST of the run so a further restatement of
        // this same never-listed defect also collapses, not just restatements of
        // something the fixture's answer key already matched.
        addCredited(creditedByPath, finding)
      }
    } catch (error) {
      const normalized = normalizeError(error, {
        source: 'provider',
        operation: EVAL_PLAUSIBILITY_JUDGE_STAGE
      })
      outcomes.push({
        findingId: finding.id,
        plausible: false,
        reason: 'Plausibility judge call failed; failed closed.',
        judged: false,
        restatesAlreadyCounted: false
      })
      failClosedFindingIds.push(finding.id)
      providerIssues.push({
        code: normalized.code,
        stage: EVAL_PLAUSIBILITY_JUDGE_STAGE,
        recovered: false,
        ...(normalized.message === undefined ? {} : { message: normalized.message })
      })
    }
  }

  return {
    outcomes,
    unlistedRealFindingIds,
    failClosedFindingIds,
    providerIssues
  }
}
