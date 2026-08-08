import type { JsonValue, ModelAlias, ModelDefaults } from '@purista/harness'
import { z } from 'zod'
import {
  createStructuredError,
  normalizeError
} from '../../../shared/errors/error-normalizer.js'
import type {
  EvalSemanticJudge,
  EvalSemanticJudgeInput,
  EvalSemanticJudgeResult
} from './eval-matcher.js'

const EvalSemanticJudgeResponseSchema = z.strictObject({
  match: z.boolean(),
  reason: z.string().min(1).max(1000)
})

const evalSemanticJudgeJsonSchema: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['match', 'reason'],
  properties: {
    match: {
      type: 'boolean'
    },
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: 1000
    }
  }
} as const

const semanticJudgeInstructions = [
  'Determine whether the candidate finding identifies the same underlying code review issue as the expected finding.',
  'Different wording is acceptable when the issue, risk, or bug is the same.',
  'Shared vocabulary is not identity: two different defects in the same function share most of their words.',
  'Do not require matching file paths or line numbers; those are handled by deterministic eval policy.',
  'Use only the provided summaries. Do not infer from missing source code.',
  'Return a boolean match decision and a concise reason. Do not return numeric confidence.',
  'Return JSON only.'
].join(' ')

const candidateSummary = (input: EvalSemanticJudgeInput): string =>
  [
    `Expected: ${input.expectedSummary}`,
    `Candidate title: ${input.findingTitle}`,
    `Candidate description: ${input.findingDescription}`
  ].join('\n')

// The judge is the sole semantic authority, so its decisions must be as
// reproducible as the provider allows. Temperature is pinned to 0 only when the
// alias already carries a temperature: reasoning models that reject the
// parameter keep their alias defaults untouched.
const deterministicDefaults = (
  defaults: ModelDefaults | undefined
): ModelDefaults | undefined =>
  defaults === undefined
    ? undefined
    : {
        ...defaults,
        ...(defaults.temperature === undefined ? {} : { temperature: 0 })
      }

export const createModelSemanticJudge = (
  input: {
    readonly modelAlias: ModelAlias
    readonly signal?: AbortSignal
  }
): EvalSemanticJudge => async (judgeInput): Promise<EvalSemanticJudgeResult> => {
  if (input.modelAlias.provider.object === undefined) {
    throw createStructuredError({
      code: 'provider_capability_missing',
      message: 'Semantic judge requires a provider with object output support.',
      category: 'config',
    })
  }

  const defaults = deterministicDefaults(input.modelAlias.defaults)

  try {
    const response = await input.modelAlias.provider.object({
      model: input.modelAlias.model,
      messages: [
        {
          role: 'system',
          content: semanticJudgeInstructions
        },
        {
          role: 'user',
          content: candidateSummary(judgeInput)
        }
      ],
      schema: evalSemanticJudgeJsonSchema,
      schemaName: 'eval_semantic_match',
      ...(defaults === undefined ? {} : { defaults }),
      call: {
        // Transient provider failures are retried under the configured provider
        // retry policy. An undecided pair is inconclusive and leaves both recall
        // and precision denominators, so retrying is strictly cheaper than
        // dropping a pair.
        retry: true
      },
      signal: input.signal ?? new AbortController().signal
    })
    const parsed = EvalSemanticJudgeResponseSchema.parse(response.object)

    return {
      match: parsed.match,
      reason: parsed.reason
    }
  } catch (error) {
    throw normalizeError(error, {
      source: 'provider',
      operation: 'eval_semantic_judge'
    })
  }
}
