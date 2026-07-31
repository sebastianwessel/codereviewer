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

const isSafeScalar = (value: unknown): value is NoContentAttributeValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'

const isSafeAttributeValue = (value: unknown): boolean =>
  Array.isArray(value) ? value.every(isSafeScalar) : isSafeScalar(value)

const keepSafeAttributes = (
  attributes: NoContentAttributes | undefined
): NoContentAttributes =>
  Object.fromEntries(
    Object.entries(attributes ?? {}).filter(
      ([key, value]) =>
        !forbiddenAttributeKeyPattern.test(key) && isSafeAttributeValue(value)
    )
  )

const nowIso = (): string => new Date().toISOString()

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
