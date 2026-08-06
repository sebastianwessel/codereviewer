type NoContentAttributeValue = string | number | boolean | null

export type NoContentAttributes = Readonly<
  Record<string, NoContentAttributeValue | readonly NoContentAttributeValue[]>
>

export type NoContentRunEvent =
  | {
      readonly type: 'run-started'
      readonly at: string
      readonly attributes: NoContentAttributes
    }
  | {
      readonly type: 'step-started'
      readonly at: string
      readonly step: string
      readonly attributes: NoContentAttributes
    }
  | {
      readonly type: 'step-ended'
      readonly at: string
      readonly step: string
      readonly durationMs: number
      readonly attributes: NoContentAttributes
    }
  | {
      readonly type: 'step-failed'
      readonly at: string
      readonly step: string
      readonly durationMs: number
      readonly errorCode: string
      readonly attributes: NoContentAttributes
    }
  | {
      readonly type: 'task-event'
      readonly at: string
      readonly attributes: NoContentAttributes
    }
  | {
      readonly type: 'run-error'
      readonly at: string
      readonly errorCode: string
      readonly category: string
      readonly recoverable: boolean
    }

export type NoContentObservabilitySnapshot = {
  readonly events: readonly NoContentRunEvent[]
}

export type NoContentStep = {
  readonly end: (attributes?: NoContentAttributes) => void
  readonly fail: (errorCode: string, attributes?: NoContentAttributes) => void
}

export type NoContentEventRecorder = {
  readonly startRun: (attributes: NoContentAttributes) => void
  readonly startStep: (
    name: string,
    attributes?: NoContentAttributes
  ) => NoContentStep
  /**
   * Record a step that has ALREADY completed, with the duration its own caller
   * measured.
   *
   * `startStep` times the step from the moment it is opened, which only works when
   * the recorder is present while the work runs. Some steps are timed where they
   * happen and reported afterwards — one context provider inside the ingestion loop,
   * for instance, which measures each provider itself and hands back per-provider
   * metrics. Re-opening a step around the reporting would time the reporting, not
   * the work, so the measured duration is passed in instead of invented.
   */
  readonly recordCompletedStep: (input: {
    readonly name: string
    readonly durationMs: number
    readonly attributes?: NoContentAttributes
  }) => void
  readonly recordTaskEvent: (attributes: NoContentAttributes) => void
  readonly recordError: (input: {
    readonly code: string
    readonly category: string
    readonly recoverable: boolean
  }) => void
  readonly snapshot: () => NoContentObservabilitySnapshot
  readonly shutdown: () => Promise<void>
}

const forbiddenAttributeKeyPattern =
  /(?:content|prompt|source|snippet|raw|output|response|header|environment|env|secret|token|key|password|credential)/iu

// A short, explicit set of names the key pattern would otherwise refuse, whose
// value is a COUNT rather than the thing counted.
//
// This is not a loosening of the guard, and the distinction matters. The pattern
// asks "could this key name a place content hides?", which is the right question
// for a free-form name and the wrong one for `inputTokens`: a token count is a
// number, and a number of tokens discloses nothing about which tokens. Because
// the pattern could not tell those apart, `inputTokens` and `outputTokens` on the
// provider workflow step were dropped from EVERY run this recorder has ever
// written — the counts existed, were correct, and reached the run summary, while
// `observability.json` reported the step as having nothing to say.
//
// Two properties keep this safe, and both are load-bearing:
//   - membership is by EXACT key, never by pattern, so no new name is admitted
//     by resembling one of these;
//   - an allowed key still has to carry a number. A string parked under
//     `inputTokens` is refused exactly as before, so the exemption cannot become
//     a channel by changing the value's type.
const countAttributeKeysExemptFromKeyPattern: ReadonlySet<string> = new Set([
  'inputTokens',
  'outputTokens',
  'cachedInputTokens'
])

const isExemptCountAttribute = (key: string, value: unknown): boolean =>
  countAttributeKeysExemptFromKeyPattern.has(key) && typeof value === 'number'

const isSafeScalar = (value: unknown): value is NoContentAttributeValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'

const isSafeAttributeValue = (value: unknown): boolean =>
  Array.isArray(value) ? value.every(isSafeScalar) : isSafeScalar(value)

// What replaces a value this recorder refuses to carry. The KEY is kept and the
// value is replaced, rather than the pair being removed: a dropped pair used to
// vanish without trace, so a caller that named an attribute badly — `sourceCount`,
// say, which trips the key pattern for containing "source" — read the resulting
// event as one where the step simply had nothing to report. That is the same
// silent-absence shape this whole surface exists to prevent, applied to itself.
// Nothing about the value is disclosed, so the guarantee is unchanged.
const droppedByKeyName = '[dropped: attribute name is not no-content safe]'
const droppedByValueShape = '[dropped: value is not a bounded scalar]'

const keepSafeAttributes = (
  attributes: NoContentAttributes | undefined
): NoContentAttributes =>
  Object.fromEntries(
    Object.entries(attributes ?? {}).map(([key, value]) => {
      if (
        forbiddenAttributeKeyPattern.test(key) &&
        !isExemptCountAttribute(key, value)
      ) {
        return [key, droppedByKeyName]
      }

      return isSafeAttributeValue(value)
        ? [key, value]
        : [key, droppedByValueShape]
    })
  )

const nowIso = (): string => new Date().toISOString()

/**
 * Build a completed-step event with its attributes already stripped of anything
 * that could carry content.
 *
 * Exported because a step can also complete after the recorder's own run has ended
 * — the review-comment drafting of spec 13 runs in the artifact stage, once the run
 * snapshot is taken — and such a step must join the snapshot through the SAME
 * sanitizer rather than being appended as a hand-built object.
 */
export const createNoContentStepEvent = (input: {
  readonly name: string
  readonly durationMs: number
  readonly attributes?: NoContentAttributes
}): NoContentRunEvent => ({
  type: 'step-ended',
  at: nowIso(),
  step: input.name,
  durationMs: Math.max(0, input.durationMs),
  attributes: keepSafeAttributes(input.attributes)
})

export const createNoContentEventRecorder = (): NoContentEventRecorder => {
  const events: NoContentRunEvent[] = []

  return {
    startRun: (attributes) => {
      events.push({
        type: 'run-started',
        at: nowIso(),
        attributes: keepSafeAttributes(attributes)
      })
    },
    startStep: (name, attributes) => {
      const startedAt = Date.now()

      events.push({
        type: 'step-started',
        at: nowIso(),
        step: name,
        attributes: keepSafeAttributes(attributes)
      })

      return {
        end: (endAttributes) => {
          events.push({
            type: 'step-ended',
            at: nowIso(),
            step: name,
            durationMs: Math.max(0, Date.now() - startedAt),
            attributes: keepSafeAttributes(endAttributes)
          })
        },
        fail: (errorCode, failAttributes) => {
          events.push({
            type: 'step-failed',
            at: nowIso(),
            step: name,
            durationMs: Math.max(0, Date.now() - startedAt),
            errorCode,
            attributes: keepSafeAttributes(failAttributes)
          })
        }
      }
    },
    recordCompletedStep: (input) => {
      events.push(createNoContentStepEvent(input))
    },
    recordTaskEvent: (attributes) => {
      events.push({
        type: 'task-event',
        at: nowIso(),
        attributes: keepSafeAttributes(attributes)
      })
    },
    recordError: (input) => {
      events.push({
        type: 'run-error',
        at: nowIso(),
        errorCode: input.code,
        category: input.category,
        recoverable: input.recoverable
      })
    },
    snapshot: () => ({
      events: events.map((event) => ({ ...event }))
    }),
    shutdown: async () => {}
  }
}
