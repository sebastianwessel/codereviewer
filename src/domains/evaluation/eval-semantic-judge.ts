import type { JsonValue, ModelAlias } from '@purista/harness'
import { z } from 'zod'
import {
  createStructuredError,
  normalizeError
} from '../../shared/errors/error-normalizer.js'
import type {
  EvalSemanticJudge,
  EvalSemanticJudgeResult
} from './eval-matcher.js'

const EvalSemanticJudgeResponseSchema = z.strictObject({
  match: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(300).optional()
})

const evalSemanticJudgeJsonSchema: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['match', 'confidence'],
  properties: {
    match: {
      type: 'boolean'
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1
    },
    reasoning: {
      type: 'string',
      minLength: 1,
      maxLength: 300
    }
  }
} as const

const semanticJudgeInstructions = [
  'Determine whether the candidate finding identifies the same underlying code review issue as the expected finding.',
  'Different wording is acceptable when the issue, risk, or bug is the same.',
  'Do not require matching file paths or line numbers; those are handled by deterministic eval policy.',
  'Use only the provided summaries. Do not infer from missing source code.',
  'Return JSON only.'
].join(' ')

const candidateSummary = (
  input: Parameters<EvalSemanticJudge>[0]
): string =>
  [
    `Expected: ${input.expected.semanticSummary}`,
    `Candidate title: ${input.finding.title}`,
    `Candidate description: ${input.finding.description}`
  ].join('\n')

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
      recoverable: true,
      exitCode: 2
    })
  }

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
      ...(input.modelAlias.defaults === undefined
        ? {}
        : { defaults: input.modelAlias.defaults }),
      call: {
        retry: false
      },
      signal: input.signal ?? new AbortController().signal
    })
    const parsed = EvalSemanticJudgeResponseSchema.parse(response.object)

    return {
      match: parsed.match,
      confidence: parsed.confidence
    }
  } catch (error) {
    throw normalizeError(error, {
      source: 'provider',
      operation: 'eval_semantic_judge'
    })
  }
}
