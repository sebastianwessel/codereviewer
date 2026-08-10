import { z } from 'zod'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { ContextLedgerIdSchema } from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'

// The ledger answers one question: which bytes reached the model, and which were
// held back. A kind that nothing writes therefore means one of two things, and
// they get opposite treatment.
//
// `symbol` and `prior-artifact` were removed. Symbol facts are ledgered, inside
// the `support-signal-output` entry that carries them, so a second kind for the
// same bytes would double-count them. `prior-artifact` described reading a
// previous invocation's artifacts back in — a persistence layer this engine
// deliberately does not have; each run reads the repository, not its own history.
//
// `diff` was NOT removed, because its absence was a DEFECT and is now fixed. The
// reviewed diff text goes into every discovery packet and was never ledgered, so
// the accounting silently omitted one of the largest inputs the model sees and
// any "how much context did this run send" answer read low.
export const ContextLedgerKindSchema = z.enum([
  'file',
  'diff',
  'instruction',
  'skill',
  'support-signal-output',
  'tool-result'
])

export type ContextLedgerKind = z.infer<typeof ContextLedgerKindSchema>

export const ContextLedgerDecisionSchema = z.enum([
  'included',
  'skipped',
  'truncated',
  'summarized'
])

export type ContextLedgerDecision = z.infer<typeof ContextLedgerDecisionSchema>

export const ContextLedgerEntrySchema = z.strictObject({
  id: ContextLedgerIdSchema,
  kind: ContextLedgerKindSchema,
  path: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  sourceLedgerEntryId: z.string().min(1).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  decision: ContextLedgerDecisionSchema,
  reason: z.string().min(1),
  bytesConsidered: z.int().min(0),
  bytesIncluded: z.int().min(0)
})

// Derived from the schema rather than restated: the schema is what actually
// validates a ledger entry, so a hand-written mirror can only ever drift from it.
export type ContextLedgerEntry = Readonly<z.infer<typeof ContextLedgerEntrySchema>>

type CreateContextLedgerEntryOptions = {
  readonly kind: ContextLedgerKind
  readonly decision: ContextLedgerDecision
  readonly reason: string
  readonly bytesConsidered: number
  readonly bytesIncluded: number
  readonly path?: string
  readonly taskId?: string
  readonly sourceLedgerEntryId?: string
  readonly content?: string | Buffer
}

type CreateTextContextLedgerEntryOptions = {
  readonly kind: ContextLedgerKind
  readonly path?: string
  readonly reason: string
  readonly text: string
  readonly maxBytes: number
}

const assertNonNegativeInteger = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be an integer greater than or equal to 0.`)
  }
}

const createStableId = (
  entry: Omit<ContextLedgerEntry, 'id'>
): string => {
  const hash = sha256(
    JSON.stringify({
      kind: entry.kind,
      path: entry.path,
      taskId: entry.taskId,
      sourceLedgerEntryId: entry.sourceLedgerEntryId,
      contentHash: entry.contentHash,
      decision: entry.decision,
      reason: entry.reason,
      bytesConsidered: entry.bytesConsidered,
      bytesIncluded: entry.bytesIncluded
    })
  ).slice(0, 24)

  return `ctx_${hash}`
}

export const createContextLedgerEntry = (
  options: CreateContextLedgerEntryOptions
): ContextLedgerEntry => {
  assertNonNegativeInteger(options.bytesConsidered, 'bytesConsidered')
  assertNonNegativeInteger(options.bytesIncluded, 'bytesIncluded')

  if (options.bytesIncluded > options.bytesConsidered) {
    throw new TypeError('bytesIncluded must not exceed bytesConsidered.')
  }

  const path =
    options.path === undefined
      ? undefined
      : normalizeRepositoryRelativePath(options.path)
  const contentHash =
    options.content === undefined ? undefined : sha256(options.content)
  const entryWithoutId: Omit<ContextLedgerEntry, 'id'> = {
    kind: options.kind,
    ...(path === undefined ? {} : { path }),
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.sourceLedgerEntryId === undefined
      ? {}
      : { sourceLedgerEntryId: options.sourceLedgerEntryId }),
    ...(contentHash === undefined ? {} : { contentHash }),
    decision: options.decision,
    reason: options.reason,
    bytesConsidered: options.bytesConsidered,
    bytesIncluded: options.bytesIncluded
  }

  return {
    id: createStableId(entryWithoutId),
    ...entryWithoutId
  }
}

export const createTextContextLedgerEntry = (
  options: CreateTextContextLedgerEntryOptions
): ContextLedgerEntry => {
  assertNonNegativeInteger(options.maxBytes, 'maxBytes')

  const content = Buffer.from(options.text)
  const bytesConsidered = content.byteLength
  const bytesIncluded = Math.min(bytesConsidered, options.maxBytes)

  return createContextLedgerEntry({
    kind: options.kind,
    ...(options.path === undefined ? {} : { path: options.path }),
    reason: options.reason,
    decision: bytesIncluded < bytesConsidered ? 'truncated' : 'included',
    bytesConsidered,
    bytesIncluded,
    content
  })
}
