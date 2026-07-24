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
}

export type EvalPlausibilityJudgeResult = {
  readonly plausible: boolean
  readonly reason: string
}

export type EvalPlausibilityJudge = (
  input: EvalPlausibilityJudgeInput
) => Promise<EvalPlausibilityJudgeResult>

const EvalPlausibilityJudgeResponseSchema = z.strictObject({
  plausible: z.boolean(),
  reason: z.string().min(1).max(500)
})

const evalPlausibilityJudgeJsonSchema: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['plausible', 'reason'],
  properties: {
    plausible: {
      type: 'boolean'
    },
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: 500
    }
  }
} as const

const plausibilityJudgeInstructions = [
  'You are auditing whether a code review finding describes a GENUINE defect that is actually present in the shown code.',
  'You are given the finding (title, description, severity, category, location) and the new-side content of the whole file the reviewer saw.',
  'Answer plausible=true only when the code shown actually contains the defect the finding describes.',
  'Answer plausible=false when the finding misreads the code, is a style or taste preference, or is not supported by what the code shows.',
  'Do not require the finding to match any expected list; decide only from the code in front of you.',
  'Return a boolean plausible decision and a concise reason. Do not return numeric confidence.',
  'Return JSON only.'
].join(' ')

const findingSummary = (input: EvalPlausibilityJudgeInput): string =>
  [
    `Finding title: ${input.findingTitle}`,
    `Finding description: ${input.findingDescription}`,
    `Severity: ${input.severity}`,
    `Category: ${input.category}`,
    `Location: ${input.path}:${input.line}`,
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
      reason: parsed.reason
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

// Judge each unmatched (raw false-positive) actionable finding for plausibility.
// This never promotes a finding into recall or changes what the reviewer
// reported; it only reclassifies unmatched output for precision accounting.
//
// Fail-closed everywhere: with no judge (offline run) or no reader, no finding
// is credited as real and no warning is raised (there was nothing to attempt).
// A judge call or file read that fails leaves the finding a genuine false
// positive AND records a fail-closed warning plus a provider issue.
export const judgeUnmatchedFindingsPlausibility = async (
  input: {
    readonly evalCase: EvalCase
    readonly unmatchedFindings: readonly AdmittedFinding[]
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
        judged: false
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
      const judged = await input.judge({
        findingTitle: finding.title,
        findingDescription: finding.description,
        severity: finding.severity,
        category: finding.category,
        path: finding.location.path,
        line: finding.location.startLine,
        fileContent: prepareEvalPlausibilitySource(rawContent)
      })
      outcomes.push({
        findingId: finding.id,
        plausible: judged.plausible,
        reason: judged.reason,
        judged: true
      })
      if (judged.plausible) {
        unlistedRealFindingIds.push(finding.id)
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
        judged: false
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
