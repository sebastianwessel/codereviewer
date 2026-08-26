// Turns a response the provider cut short into a stated provider failure.
//
// WHY THIS EXISTS
//
// A response that hit the output-token ceiling comes back looking like an
// ordinary success: HTTP 200, a body, no error. The only thing separating it
// from a complete answer is `finishReason: 'length'`, which nothing in this
// engine read before this module. So a review that was cut off mid-answer
// parsed, scored, and reported exactly like a review that finished — the
// reviewer simply appeared to have found fewer defects.
//
// This is the same failure the holistic result contract already refuses one
// layer out, and that contract states the mechanism in as many words: the
// Responses API reports a truncated response as `status: 'incomplete'`, "which
// the adapter does not treat as a failure", and an empty body becomes `{}`.
// Requiring `findings` makes the EMPTY body fail validation. It cannot catch the
// PARTIAL body: `{"findings": [ ...three of the nine the model was writing ]}`
// is valid against a deliberately loose schema, so it is admitted as the whole
// answer. That is the case this guard covers, and it is the more dangerous of
// the two precisely because it looks plausible.
//
// WHY AT THE PROVIDER SEAM, AND WHY IN THIS DOMAIN
//
// `provider.maxOutputTokens` is turned into the adapter's `maxTokens` in
// `provider-resolution.ts`. The module that installs the ceiling is the right
// one to own detecting that the ceiling bit, and wrapping the provider here
// means every lane that resolves an alias — review, verification, change impact,
// intent fulfilment, the eval judges — is covered without a single call site
// having to opt in or even know about it.
//
// The check is deliberately NOT limited to runs that configured
// `maxOutputTokens`. A model's own default output ceiling truncates just as
// silently, and `finishReason: 'length'` means the response was cut short
// whoever set the limit. The configured value is reported in the error details
// when there is one, because "raise or unset the value you set" is a different
// remedy from "this model's default ceiling is too low for this packet".
//
// WHAT IT DOES NOT DO
//
// It does not repair, retry, or trim. A truncated answer cannot be completed by
// looking at it, and retrying an identical request against an identical ceiling
// truncates identically — it would only spend money to fail the same way. The
// value here is entirely in refusing to pass the response off as complete.
//
// It also does not decide what the loss COSTS. That is per-stage and belongs to
// the stage: discovery names this failure in its own failure policy (spec 05,
// *Truncated Discovery Responses*, 2026-08-17) so it costs one response
// and is surfaced as an UNRECOVERED provider issue, which fails the quality gate
// by default; refutation and semantic merge already treat any call failure that
// way. Every other lane still lets it propagate. What this module guarantees
// everywhere is only that the truncation is never silent.

import type {
  FinishReason,
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { createStructuredError } from '../../shared/errors/error-normalizer.js'
import { PROVIDER_OUTPUT_TRUNCATED_CODE } from '../../shared/errors/output-truncation.js'

// `'length'` is the harness's normalized "token budget reached", and it is the
// only finish reason this guard claims. Neighbouring values are deliberately left
// alone: `context_limit` is an INPUT overflow, and spec 26 routes that one by the
// classified `context_length_exceeded` model error into reactive splitting, so
// claiming it here would divert a case that already has a working recovery path
// into a hard failure. `content_filter`, `refusal`, and `malformed` are real
// failures too, but each means something different to a reader and none of them
// is the silent one — they are left for a change that can state what should
// happen for each.
const TRUNCATED_FINISH_REASON: FinishReason = 'length'

const assertNotTruncated = (input: {
  readonly finishReason: FinishReason
  readonly model: string
  readonly maxOutputTokens: number | undefined
  readonly outputTokens: number
}): void => {
  if (input.finishReason !== TRUNCATED_FINISH_REASON) {
    return
  }

  // A plain structured error object, matching how this domain already reports
  // provider setup failures. It is deliberately not a `ModelError` and not an
  // `OperationTimeoutError`: the harness classifies retries off exactly those two
  // types, so this shape is guaranteed to fail fast instead of buying three
  // identical truncations at three times the price.
  // The code is imported, not spelled here: the discovery call failure policy
  // (spec 05) recognises this exact error to decide that a truncated response
  // costs one response rather than the whole run, and a producer and consumer
  // holding separate copies of an error code fail silently in the direction that
  // restores the unbounded failure.
  throw createStructuredError({
    code: PROVIDER_OUTPUT_TRUNCATED_CODE,
    message:
      `Model "${input.model}" stopped at the output-token limit after ` +
      `${input.outputTokens} output tokens, so the response is incomplete. ` +
      // Naming the ceiling is not enough on its own: the two cases have
      // DIFFERENT remedies, and an operator who reads only "the limit bound"
      // cannot tell which knob is theirs to turn. A configured value is raised
      // or unset; a model default is not theirs at all, and the fix is a model
      // with more output room or a smaller review unit.
      (input.maxOutputTokens === undefined
        ? 'No provider.maxOutputTokens is configured, so this is the model or adapter default ceiling: choose a model with more output room, or review fewer files per call (review.maxFilesPerDiscoveryCall).'
        : `provider.maxOutputTokens is set to ${input.maxOutputTokens}: raise it, or remove it to use the model's own ceiling.`) +
      ' A truncated response is not treated as a complete answer, because a partial list of findings is indistinguishable from a short one.',
    category: 'provider',
    details: {
      model: input.model,
      finishReason: input.finishReason,
      outputTokens: input.outputTokens,
      ...(input.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: input.maxOutputTokens })
    }
  })
}

/**
 * Wraps a resolved provider so a `text`/`object` response that stopped at the
 * output-token ceiling raises `provider_output_truncated` instead of being
 * returned as a complete answer.
 *
 * Streaming methods are passed through untouched, matching what
 * `createProviderUsageRecorder` does with them and for the same reason: this
 * engine issues no streaming model calls, so a wrapper around them would be
 * untested code guarding a path nothing takes. Every agent in the review harness
 * declares an output schema, which routes it through `object`.
 *
 * Optional methods are re-attached only when the delegate actually has them.
 * Defining them unconditionally would advertise capabilities the underlying
 * provider does not implement.
 */
export const guardTruncatedProviderOutput = (
  input: {
    readonly provider: ModelProvider
    readonly model: string
    readonly maxOutputTokens: number | undefined
  }
): ModelProvider => {
  const provider = input.provider
  const check = (response: {
    readonly finishReason: FinishReason
    readonly usage: { readonly outputTokens: number }
  }): void => {
    if (response.finishReason !== TRUNCATED_FINISH_REASON) {
      return
    }

    // `usage` is required by the response contract, but it is read only on the
    // failure path and defensively even there. This guard sits in front of EVERY
    // model call in the engine, so a wrapper that could itself throw on a healthy
    // response would be a worse defect than the one it was added to fix.
    assertNotTruncated({
      finishReason: response.finishReason,
      model: input.model,
      maxOutputTokens: input.maxOutputTokens,
      outputTokens: response.usage?.outputTokens ?? 0
    })
  }

  return {
    ...provider,
    id: provider.id,
    genAiSystem: provider.genAiSystem,
    ...(provider.info === undefined ? {} : { info: provider.info }),
    ...(provider.text === undefined
      ? {}
      : {
          text: async (request) => {
            const response = await provider.text!(request)

            check(response)

            return response
          }
        }),
    ...(provider.object === undefined
      ? {}
      : {
          object: async <T extends JsonValue = JsonValue>(
            request: ObjectRequest<T>
          ): Promise<ObjectResponse<T>> => {
            const response = await provider.object!(request)

            check(response)

            return response
          }
        }),
    ...(provider.textStream === undefined
      ? {}
      : { textStream: provider.textStream.bind(provider) }),
    ...(provider.objectStream === undefined
      ? {}
      : { objectStream: provider.objectStream.bind(provider) }),
    ...(provider.embed === undefined
      ? {}
      : { embed: provider.embed.bind(provider) }),
    ...(provider.rerank === undefined
      ? {}
      : { rerank: provider.rerank.bind(provider) }),
    ...(provider.close === undefined
      ? {}
      : { close: provider.close.bind(provider) })
  }
}
